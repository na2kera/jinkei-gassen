// 通しのテストの道具。手元の開発サーバー（wrangler dev）を起動し、Node の WebSocket で2人ぶんをつなぐ。
// Node 22.12 以上（wrangler 4.162.0 の要件）。Node 22 ではグローバルの WebSocket が使える。

import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_JS = join(SERVER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 開発サーバーを起動する。persistDir を渡すと、止めて起動し直しても同じ保存領域を使う */
export async function startServer({ port, persistDir } = {}) {
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
    '--var',
    'JINKEI_TEST_MODE:1',
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

/** 部屋を作る。{ status, body } を返す */
export async function postRoom(base, body) {
  const r = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

export async function createRoom(base, pid, timing, codes) {
  const body = { pid };
  if (timing !== undefined) body.timing = timing;
  if (codes !== undefined) body.codes = codes;
  const r = await postRoom(base, body);
  if (r.status !== 201) throw new Error(`createRoom failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.code;
}

/** テスト用の経路を呼ぶ */
export async function testRoute(base, code, name) {
  const r = await fetch(`${base}/api/rooms/${code}/test/${name}`, { method: 'POST' });
  if (r.status !== 200) throw new Error(`test/${name}: ${r.status}`);
  return r.json();
}

/** テスト用のクライアント。届いたメッセージをすべて記録する */
export class Client {
  constructor(base, code, opts = {}) {
    this.base = base;
    this.code = code;
    this.pid = opts.pid ?? randomPid();
    this.name = opts.name ?? 'player';
    this.messages = [];
    this.raw = [];
    this.closed = null;
    this.waiters = [];
    this.room = null;
  }

  get url() {
    const q = new URLSearchParams({ pid: this.pid, name: this.name });
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
export async function setupPair(base, timing, { names = ['A', 'B'] } = {}) {
  const A = new Client(base, '', { name: names[0] });
  const code = await createRoom(base, A.pid, timing);
  A.code = code;
  const B = new Client(base, code, { name: names[1] });
  await A.connect();
  await A.waitRoom((r) => r.phase === 'waiting');
  await B.connect();
  await Promise.all([A.waitRoom((r) => r.phase === 'setup'), B.waitRoom((r) => r.phase === 'setup')]);
  return { code, A, B };
}

/**
 * 「自分が下」の座標の配置を作る。下側の6行（行 10〜15）に置く。
 * cells は [kind, col, row, stance] の並び。
 */
export function army(cells) {
  return cells.map(([kind, col, row, stance]) => ({ kind, col, row, stance }));
}

/** 全部隊が守備の軍（必ず時間切れの引き分けになる、design §3.9 A11）。予算 36 以内 */
export function holdArmy() {
  return army([
    ['hq', 5, 15, 'hold'],
    ['shield', 3, 11, 'hold'],
    ['shield', 5, 11, 'hold'],
    ['shield', 7, 11, 'hold'],
    ['infantry', 2, 12, 'hold'],
    ['infantry', 4, 12, 'hold'],
    ['infantry', 6, 12, 'hold'],
    ['infantry', 8, 12, 'hold'],
    ['archer', 4, 13, 'hold'],
    ['archer', 6, 13, 'hold'],
  ]);
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
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
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
