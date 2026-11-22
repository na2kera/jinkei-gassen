// 通しのテストの道具。手元の開発サーバー（wrangler dev）を起動し、Node の WebSocket で2人ぶんをつなぐ。
// Node 22.12 以上（wrangler 4.162.0 の要件）。Node 22 ではグローバルの WebSocket が使える。

import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pvpField } from '@jinkei/engine';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_JS = join(SERVER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 開発サーバーを起動する。persistDir を渡すと、止めて起動し直しても同じ保存領域を使う。
 * testMode: false なら JINKEI_TEST_MODE を渡さない（本番と同じ設定で起動する）
 */
export async function startServer({ port, persistDir, testMode = true } = {}) {
  const dir = persistDir ?? mkdtempSync(join(tmpdir(), 'jinkei-e2e-'));
  const args = [
    WRANGLER_JS,
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--inspector-port',
    String(port + 1000),
    '--persist-to',
    dir,
    '--show-interactive-dev-session=false',
    ...(testMode ? ['--var', 'JINKEI_TEST_MODE:1'] : []),
  ];
  const child = spawn(process.execPath, args, {
    cwd: SERVER_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`wrangler exited early:\n${log}`);
    try {
      const r = await fetch(`${base}/api/ping`);
      if (r.status === 404) break;
    } catch {
      // まだ起動中
    }
    if (Date.now() - started > 60_000) {
      killGroup(child, 'SIGKILL');
      throw new Error(`wrangler did not start:\n${log}`);
    }
    await sleep(300);
  }
  return {
    base,
    port,
    persistDir: dir,
    log: () => log,
    async stop({ keep = false } = {}) {
      killGroup(child, 'SIGTERM');
      for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
      if (child.exitCode === null && child.signalCode === null) {
        killGroup(child, 'SIGKILL');
        await sleep(300);
      }
      if (!keep) rmSync(dir, { recursive: true, force: true });
    },
  };
}

function killGroup(child, sig) {
  try {
    process.kill(-child.pid, sig);
  } catch {}
}

export function randomPid() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString('hex');
}

/** 回数の上限の鍵（テストのときだけ効く）。ふだんは呼び出しごとに別の鍵にして、上限に当たらないようにする */
export function randomKey() {
  return randomPid().slice(0, 12);
}

/** 部屋を作る。{ status, body } を返す。rlKey を渡すと、その鍵で回数を数える */
export async function postRoom(base, body, { rlKey = randomKey() } = {}) {
  const r = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-Rl-Key': rlKey },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

/** 部屋を作る。map は選ぶ戦場（既定は平原に固定して、テストの結果がぶれないようにする。null ならランダム） */
export async function createRoom(base, pid, timing, codes, map = 'plain', seed = undefined) {
  const body = { pid };
  if (map !== null) body.map = map;
  if (timing !== undefined) body.timing = timing;
  if (codes !== undefined) body.codes = codes;
  if (seed !== undefined) body.seed = seed;
  const r = await postRoom(base, body);
  if (r.status !== 201) throw new Error(`createRoom failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.code;
}

/** 刻みを n 回進める（timing.testManualTicks が 1 の部屋だけ）。進めたあとの刻みを返す */
export async function stepTicks(base, code, n = 1) {
  const r = await fetch(`${base}/api/rooms/${code}/test/step?n=${n}`, { method: 'POST' });
  if (r.status !== 200) throw new Error(`test/step: ${r.status}`);
  return (await r.json()).tick;
}

/** テスト用の経路を呼ぶ */
export async function testRoute(base, code, name) {
  const r = await fetch(`${base}/api/rooms/${code}/test/${name}`, { method: 'POST' });
  if (r.status !== 200) throw new Error(`test/${name}: ${r.status}`);
  return r.json();
}

/** いまの client の版（client の CLIENT_VERSION と同じ。server の MIN_CLIENT_VERSION 以上） */
export const CURRENT_CV = 3;

/** テスト用のクライアント。届いたメッセージをすべて記録する */
export class Client {
  constructor(base, code, opts = {}) {
    this.base = base;
    this.code = code;
    this.pid = opts.pid ?? randomPid();
    this.name = opts.name ?? 'player';
    this.rlKey = opts.rlKey ?? randomKey();
    this.messages = [];
    this.raw = [];
    this.closed = null;
    this.waiters = [];
    this.room = null;
    /**
     * client の版（接続の URL の cv）。渡さなければ、いまの版（3）。{ cv: undefined } と明示したときだけ付けない
     * （版のない古い画面。server は 1 として扱い、outdated で断る。design §13.6）
     */
    this.cv = 'cv' in opts ? opts.cv : CURRENT_CV;
  }

  get url() {
    const q = new URLSearchParams({ pid: this.pid, name: this.name, rlkey: this.rlKey });
    if (this.cv !== undefined) q.set('cv', String(this.cv));
    return `${this.base.replace(/^http/, 'ws')}/api/rooms/${this.code}/ws?${q}`;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      this.closed = null;
      ws.onopen = () => {
        // 超富豪のテストと同じく、数百 ms ごとに "ping" を送る（server は自動で "pong" を返す）。
        // 手元の開発サーバーでは、server から閉じた知らせが、client から何か送るまで届ききらないことがあるため
        this.pinger = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 300);
        resolve();
      };
      ws.onerror = () => reject(new Error(`websocket error ${this.url}`));
      ws.onclose = (e) => {
        clearInterval(this.pinger);
        this.closed = { code: e.code, reason: e.reason };
        this.notify();
      };
      ws.onmessage = (e) => this.onMessage(e.data);
    });
  }

  onMessage(data) {
    if (data === 'pong') return;
    this.raw.push(data);
    const msg = JSON.parse(data);
    msg.receivedAt = Date.now();
    this.messages.push(msg);
    if (msg.type === 'room') this.room = msg;
    this.notify();
  }

  notify() {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) if (!w()) this.waiters.push(w);
  }

  send(obj) {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  of(type) {
    return this.messages.filter((m) => m.type === type);
  }

  last(type) {
    const l = this.of(type);
    return l[l.length - 1];
  }

  /** 条件を満たすメッセージを待つ。from より後に届いたものだけを見る */
  waitMsg(pred, { ms = 30_000, from = 0, label = 'message' } = {}) {
    return this.waitFor(() => this.messages.slice(from).find(pred), ms, label);
  }

  waitRoom(pred, ms = 30_000, label = 'room') {
    return this.waitFor(() => (this.room !== null && pred(this.room) ? this.room : undefined), ms, label);
  }

  /**
   * server が閉じるのを待つ。close の知らせが届けば { code, reason }。
   * 手元の開発サーバー（wrangler dev の中継）では、server が閉じる知らせ（Close フレーム）は届いて CLOSING になるのに、
   * 接続の後始末が終わらず close の知らせが来ないことがある。そのときは CLOSING が1秒続いたら { code: null } を返す
   * （server から閉じたことは確か。閉じた理由は、直前に届く error の reason で確かめる）。
   */
  async waitClosed(ms = 10_000) {
    const started = Date.now();
    let closingSince = null;
    while (Date.now() - started < ms) {
      if (this.closed) return this.closed;
      if (this.ws.readyState === WebSocket.CLOSING) {
        closingSince ??= Date.now();
        if (Date.now() - closingSince >= 1000) return { code: null, reason: null };
      }
      await sleep(50);
    }
    throw new Error(`timeout waiting for close (${this.name})`);
  }

  waitFor(check, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${label} (${this.name})`)), ms);
      const w = () => {
        const v = check();
        if (v !== undefined) {
          clearTimeout(t);
          resolve(v);
          return true;
        }
        return false;
      };
      if (!w()) this.waiters.push(w);
    });
  }

  close() {
    clearInterval(this.pinger);
    try {
      this.ws.close();
    } catch {}
  }
}

/** 部屋を作り、2人を入れて setup まで進める */
export async function setupPair(base, timing, { names = ['A', 'B'], map = 'plain', cv = [CURRENT_CV, CURRENT_CV], seed = undefined } = {}) {
  const A = new Client(base, '', { name: names[0], cv: cv[0] });
  const code = await createRoom(base, A.pid, timing, undefined, map, seed);
  A.code = code;
  const B = new Client(base, code, { name: names[1], cv: cv[1] });
  await A.connect();
  await A.waitRoom((r) => r.phase === 'waiting');
  await B.connect();
  await Promise.all([A.waitRoom((r) => r.phase === 'setup'), B.waitRoom((r) => r.phase === 'setup')]);
  return { code, A, B };
}

/**
 * 「自分が下」の座標の配置を作る。cells は [kind, col, row, stance] の並び（戦場の列と行）。
 */
export function army(cells) {
  return cells.map(([kind, col, row, stance]) => ({ kind, col, row, stance }));
}

/**
 * 「自分が下」の配置エリア（平原の戦場の zones[0]。通り道の列を含まない。design §13.2・§13.6）。
 * テストの軍は、行や列を直書きせず、このエリアから作る
 */
export const ZONE = pvpField('plain').zones[0];
/** エリアの最前列と最後列の行（戦場の行） */
export const FRONT = ZONE.row;
export const BACK = ZONE.row + ZONE.height - 1;
/** エリアの中の列（0 がエリアの左端）を、戦場の列に直す */
export const zc = (i) => ZONE.col + i;
/** エリアのまん中の列（戦場の列） */
export const MID = zc(Math.floor(ZONE.width / 2));

/**
 * エリアの左上を原点にした [kind, 列, 行, stance] の並びから、「自分が下」の座標の配置を作る
 */
export function zoneArmy(cells) {
  return cells.map(([kind, c, r, stance]) => ({ kind, col: zc(c), row: FRONT + r, stance }));
}

/**
 * 全部隊が守備の軍（値段 20・9 部隊。どの遊軍（値段 4 まで）を足しても予算 24 に収まる）。この軍どうしは、だれも攻めず動かないので、開戦から 10 秒（100 刻み）で膠着の引き分けになる
 * （design §3.6.4、§3.9 A11）。maxTicks が 100 以下なら時間切れの引き分け。
 * 新しい盤（10×12、通り道つき）でも、engine で種 400 個を流して、すべて 100 刻みの膠着になることを確かめた（design §13.6）
 */
export function holdArmy() {
  const back = ZONE.height - 1;
  return zoneArmy([
    ['hq', 4, back, 'hold'],
    ['shield', 2, 0, 'hold'],
    ['shield', 4, 0, 'hold'],
    ['shield', 6, 0, 'hold'],
    ['infantry', 1, 1, 'hold'],
    ['infantry', 3, 1, 'hold'],
    ['infantry', 5, 1, 'hold'],
    ['infantry', 7, 1, 'hold'],
    ['archer', 4, 2, 'hold'],
  ]);
}

/**
 * 勝ち負けが付く、動きのある配置（前進と本陣狙い）。騎兵はエリアの両端の列（通り道のすぐ内側）に置く
 */
export function attackArmy() {
  const back = ZONE.height - 1;
  return zoneArmy([
    ['hq', 4, back, 'hold'],
    ['infantry', 1, 0, 'advance'],
    ['infantry', 3, 0, 'advance'],
    ['infantry', 5, 0, 'advance'],
    ['infantry', 7, 0, 'advance'],
    ['cavalry', 0, 1, 'hunt'],
    ['cavalry', ZONE.width - 1, 1, 'hunt'],
    ['archer', 4, 2, 'advance'],
  ]);
}

/**
 * 攻撃が続いて時間切れになる組（design §3.9 の「この決まりで意味が変わる、いまあるテストと集計」）。
 * 盾の壁（本陣と、配置エリアの最前列いっぱいの盾兵。全部隊が守備）を、本陣と弓兵1（前進）の軍が端から1部隊ずつ撃ち続ける。弓兵は盾兵の近接の距離に入らず、
 * 盾兵は撃たれても持ち場を離れないので、毎刻みだれかが撃つか動こうとしていて膠着にならず、3分では決着しない。
 * engine で種400個を流して、すべて 1800 刻みの時間切れ（弓兵の側の勝ち）になることを確かめた（盾の壁の側が翼ごとに堅守を3回出しても同じ）。
 * 新しい盤（盾兵 8、値段 24）でも、種 400 個がすべて時間切れになることを確かめた（堅守の号令の場合は、測り直していない）
 */
export function shieldWallArmy() {
  return zoneArmy([['hq', 4, ZONE.height - 1, 'hold'], ...Array.from({ length: ZONE.width }, (_, c) => ['shield', c, 0, 'hold'])]);
}
export function loneArcherArmy() {
  return zoneArmy([['hq', 4, ZONE.height - 1, 'hold'], ['archer', 4, 0, 'advance']]);
}

/** 部隊を名前つきの形に戻す（PackedUnit の並び、protocol.ts） */
export function unpack(u) {
  const [id, side, kind, wing, x, y, fx, fy, men, maxMen, morale, status, order, attacking, stance] = u;
  return { id, side, kind, wing, x, y, fx, fy, men, maxMen, morale, status, order, attacking, stance };
}

/** 結果の勝者から、成績の増え方を出す */
export function scoreDelta(winner) {
  return winner === 0 ? [1, 0, 0] : winner === 1 ? [0, 1, 0] : [0, 0, 1];
}

/** WebSocket の upgrade を生の HTTP で送り、応答の状態コードを返す（fetch は Upgrade の見出しを送れないため） */
export function upgradeStatus(base, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
    const req = request({
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'X-Test-Rl-Key': randomKey(),
        ...headers,
      },
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(101);
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * snap の出来事を通し番号つきで集める。番号が重なるもの（作り直しのあとに送り直されたもの）は中身が同じかを確かめ、
 * { byIndex, mismatches, gaps } を返す。gaps は、1つの接続の中で evBase が「前の evBase + 前の件数」から飛んだ回数
 */
export function collectEvents(clients) {
  const byIndex = new Map();
  const mismatches = [];
  let gaps = 0;
  for (const c of clients) {
    let next = null;
    for (const s of c.of('snap')) {
      if (next !== null && s.evBase > next) gaps += 1;
      s.events.forEach((e, i) => {
        const k = s.evBase + i;
        const j = JSON.stringify(e);
        if (byIndex.has(k) && byIndex.get(k) !== j) mismatches.push({ index: k, a: byIndex.get(k), b: j });
        byIndex.set(k, j);
      });
      next = Math.max(next ?? 0, s.evBase + s.events.length);
    }
  }
  return { byIndex, mismatches, gaps };
}

/**
 * 回数の上限の窓の番号。手元の開発サーバー（miniflare）の上限は、時計の1分ごとに区切った窓で数える
 * （floor(いま / 60秒)。どの鍵も同じ瞬間に数え直しになる）
 */
export function limitWindow() {
  return Math.floor(Date.now() / 60_000);
}

/** いまの窓の残りが needMs より短ければ、次の窓の始めまで待つ（上限を数えるテストが、窓をまたいで数え直しに当たらないように） */
export async function freshWindow(needMs) {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < needMs) await sleep(left + 200);
}

/**
 * fn(鍵) を、1つの窓の中で走らせる。走っているあいだに窓をまたいだら（失敗していても）、新しい鍵でもう1度だけ走らせる
 * （2回目は窓の始めのほうから走るので、1分かからない fn なら、またがない）。fn の返した値を返す
 */
export async function inOneWindow(fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const w = limitWindow();
    let out;
    let err = null;
    try {
      out = await fn(randomKey());
    } catch (e) {
      err = e;
    }
    if (limitWindow() === w) {
      if (err !== null) throw err;
      return out;
    }
    console.log('crossed a rate limit window; retrying with a new key');
  }
  throw new Error('crossed the rate limit window twice');
}
