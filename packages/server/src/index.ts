// Worker の入口（design §4.1）。/api/* だけを扱い、それ以外は client の静的ファイルに任せる
// （開発時は client の vite.config.ts の run_worker_first、本番は wrangler deploy の assets）。
//
//   POST /api/rooms              部屋を作る。本文 { pid } → 201 { code }。コードが取れなければ 503 { error: 'busy' }
//   GET  /api/rooms/:code/ws     WebSocket（?pid=…&name=…&cv=…）。部屋がない・満員・古い版（cv が 3 より小さい）は、
//                                つないだあと error を送って閉じる（古い版は部屋が断る。入室の回数の数え方は変わらない）
//
// 送信元（IP）ごとに、部屋の作成は1分に60回、席にいない人の入室の試みは1分に120回、ws の頼みは全部で1分に600回まで
// （wrangler.jsonc の ratelimits）。超えたら 429。
// 4桁のコードの総当たりで友達より先に空席を取られることと、作成の連打で予約と Durable Object の呼び出しを起こされることを抑える。
// すでにその部屋の席にいる人のつなぎ直しは、入室の回数に数えない（会場の Wi-Fi が一瞬切れて、同じ送信元の全員が一斉に
// つなぎ直しても締め出されないように。decisions §20、design §11.1）。席にいるかは部屋（Durable Object）に聞く。
//
// テストのときだけ（開発サーバーに --var JINKEI_TEST_MODE:1 を渡したとき）:
//   POST /api/rooms の本文に { timing: {...} } を付けて秒数を差し替え、{ codes: [...] } で試すコードの順を、{ map } で戦場を、
//   { seed } で戦いの乱数の種を決められる
//   POST /api/rooms/:code/test/alarm     アラームの処理をいま実行する（2回鳴った場合の確認）
//   POST /api/rooms/:code/test/abort     Durable Object を作り直させる（再開の確認）
//   POST /api/rooms/:code/test/state     保存した段階・成績・刻みと、インスタンスの識別子を返す
//   POST /api/rooms/:code/test/step?n=…  刻みを n 回進める（timing.testManualTicks が 1 の部屋だけ）。{ tick } を返す
//   POST /api/rooms/:code/test/seated?pid=…  部屋の isSeated(pid) の答えを { seated } で返す（何も書き換えないことの確認）
//   POST /api/rooms/:code/test/version?v=…  保存した部屋の形の版を v に書き換える（盤が変わる前の部屋の片付けの確認。{ ok }）
//   回数の上限の鍵を、見出し X-Test-Rl-Key か、入室の ?rlkey= で差し替える（テストごとに別の送信元として数えるため）

import { DEFAULT_TIMING, parseTimingOverride, type Timing } from './timing.ts';
import type { CreateRoomResponse } from './protocol.ts';
import { originAllowed } from './origin.ts';
import { isPid, isRoomCode, normalizeName } from './validate.ts';
import { isMapId } from './maps.ts';
import type { Room } from './room.ts';

export { Room } from './room.ts';

/** コードを選び直す回数（design §4.3） */
const MAX_CODE_TRIES = 8;
const MAX_BODY_BYTES = 2048;

/** テスト用の機能を有効にするか。wrangler.jsonc の vars には入れない（デプロイされるため） */
function isTestMode(env: Env): boolean {
  return (env as unknown as Record<string, unknown>)['JINKEI_TEST_MODE'] === '1';
}

/** 回数の上限を数える鍵。ふつうは送信元の IP。テストのときだけ差し替えられる */
function limitKey(request: Request, url: URL, env: Env): string {
  if (isTestMode(env)) {
    const k = request.headers.get('X-Test-Rl-Key') ?? url.searchParams.get('rlkey');
    if (k !== null && k !== '') return `test:${k.slice(0, 64)}`;
  }
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/** 上限の内か。数える仕組みが失敗したときは通す（遊べなくなるより、制限が一時的に効かないほうがよい） */
async function withinLimit(limiter: RateLimit, key: string): Promise<boolean> {
  try {
    return (await limiter.limit({ key })).success;
  } catch (e) {
    console.error('rate limiter failed', e);
    return true;
  }
}

/**
 * その pid が、いまその部屋の席にいるか。聞けなかったときは、席にいるものとして扱う（入室の回数に数えずに通す）。
 * 数える側に倒すと、入室の上限を使い切っているあいだ、席にいる人のつなぎ直しまで断ってしまう。通しても、
 * 手前の WS_LIMITER が効いていて、席があるかは部屋が入室のときに決め直す
 */
async function seatedIn(stub: DurableObjectStub<Room>, pid: string): Promise<boolean> {
  try {
    return await stub.isSeated(pid);
  } catch (e) {
    console.error('isSeated failed', e);
    return true;
  }
}

function randomCode(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String((a[0] ?? 0) % 10_000).padStart(4, '0');
}

/** 本文を上限つきで読む。上限を超えた時点で読むのをやめて null を返す（Content-Length だけには頼らない） */
async function readBodyLimited(request: Request, limit: number): Promise<string | null> {
  const len = request.headers.get('Content-Length');
  if (len !== null && Number(len) > limit) return null;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    buf.set(c, pos);
    pos += c.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  const text = await readBodyLimited(request, MAX_BODY_BYTES);
  if (text === null) return json({ error: 'bad body' }, 400);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ error: 'body must be an object' }, 400);
  const b = body as Record<string, unknown>;
  const allowed = isTestMode(env) ? ['pid', 'timing', 'codes', 'map', 'seed'] : ['pid'];
  if (Object.keys(b).some((k) => !allowed.includes(k))) return json({ error: 'unknown fields' }, 400);
  const pid = b['pid'];
  if (!isPid(pid)) return json({ error: 'pid must be 32 lowercase hex characters' }, 400);
  let timing: Timing = { ...DEFAULT_TIMING };
  if (b['timing'] !== undefined) {
    const t = parseTimingOverride(b['timing']);
    if (t === null) return json({ error: 'invalid timing' }, 400);
    timing = t;
  }
  // テストでは、試すコードを決めて取り合いを起こす。決めた分を使い切ったら、それ以上は試さない
  let codes: string[] | null = null;
  if (b['codes'] !== undefined) {
    const c = b['codes'];
    if (!Array.isArray(c) || c.length < 1 || c.length > MAX_CODE_TRIES || !c.every(isRoomCode)) return json({ error: 'invalid codes' }, 400);
    codes = c;
  }
  // テストでは、選ぶ戦場を決めておける
  let map: string | null = null;
  if (b['map'] !== undefined) {
    if (!isMapId(b['map'])) return json({ error: 'invalid map' }, 400);
    map = b['map'];
  }
  // テストでは、戦いの乱数の種を決めておける（同じ戦いを部屋をまたいで比べるため）
  let seed: number | null = null;
  if (b['seed'] !== undefined) {
    const v = b['seed'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 0xffffffff) return json({ error: 'invalid seed' }, 400);
    seed = v;
  }
  const tries = codes ?? Array.from({ length: MAX_CODE_TRIES }, randomCode);
  for (const code of tries) {
    const stub = env.ROOM.getByName(code);
    if (await stub.create(code, pid, timing, map, seed)) {
      const res: CreateRoomResponse = { code };
      return json(res, 201);
    }
  }
  return json({ error: 'busy' }, 503);
}

/**
 * 入室（GET /api/rooms/:code/ws）。順番（design §11.1・§11.5-6）：
 *   Origin → WS_LIMITER（すべての ws の頼み）→ コードの形（違えば JOIN_LIMITER で数えてから 404）→ Upgrade → pid と名前の形
 *   → 部屋に「席にいるか」を聞く → 席にいなければ JOIN_LIMITER → 部屋へ渡す。
 * WS_LIMITER を先に置くのは、席にいるかを聞くこと自体が部屋（Durable Object）を起こすため（総当たりで起こせる部屋を1分に600までにする）。
 * 2つの上限は同じ鍵（limitKey）で数える
 */
async function joinRoom(request: Request, url: URL, env: Env, code: string): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  if (!originAllowed(request.headers.get('Origin'), url)) return json({ error: 'forbidden origin' }, 403);
  const key = limitKey(request, url, env);
  if (!(await withinLimit(env.WS_LIMITER, key))) return json({ error: 'rate_limited' }, 429);
  // 形の違うコードの試みも、入室の回数に数える（総当たりを抑えるため。いままでどおり、上限を超えていれば 404 より先に 429）
  if (!isRoomCode(code)) {
    if (!(await withinLimit(env.JOIN_LIMITER, key))) return json({ error: 'rate_limited' }, 429);
    return json({ error: 'room not found' }, 404);
  }
  // WebSocket でない頼みは、部屋に聞く前に断る（部屋を起こさない）
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected websocket' }, 426);
  const pid = url.searchParams.get('pid');
  if (!isPid(pid) || normalizeName(url.searchParams.get('name')) === null) return json({ error: 'bad pid or name' }, 400);
  const stub = env.ROOM.getByName(code);
  // 席にいる人のつなぎ直しは数えない。聞いてから入るまでのあいだに席を失った人が、数えられずに入り直すことはあるが許す
  // （席は入室のときに決め直すので、満員の席は奪えない。design §11.5-6）
  if (!(await seatedIn(stub, pid)) && !(await withinLimit(env.JOIN_LIMITER, key))) return json({ error: 'rate_limited' }, 429);
  return await stub.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === '/api/rooms') {
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
        if (!originAllowed(request.headers.get('Origin'), url)) return json({ error: 'forbidden origin' }, 403);
        if (!(await withinLimit(env.CREATE_LIMITER, limitKey(request, url, env)))) return json({ error: 'rate_limited' }, 429);
        return await createRoom(request, env);
      }
      const m = /^\/api\/rooms\/([^/]+)\/(ws|test\/alarm|test\/abort|test\/state|test\/step|test\/seated|test\/version)$/.exec(path);
      if (m !== null) {
        const code = m[1] ?? '';
        if (m[2] === 'ws') return await joinRoom(request, url, env, code);
        if (!isRoomCode(code)) return json({ error: 'room not found' }, 404);
        const stub = env.ROOM.getByName(code);
        if (!isTestMode(env) || request.method !== 'POST') return json({ error: 'not found' }, 404);
        if (m[2] === 'test/alarm') {
          await stub.runAlarmNow();
          return json({ ok: true });
        }
        if (m[2] === 'test/abort') {
          // abort は呼んだ側にも例外として返る（作り直しが起きた印）
          try {
            await stub.abortNow();
          } catch {
            // 期待どおり
          }
          return json({ ok: true });
        }
        if (m[2] === 'test/seated') {
          const pid = url.searchParams.get('pid');
          if (!isPid(pid)) return json({ error: 'bad pid' }, 400);
          return json({ seated: await stub.isSeated(pid) });
        }
        if (m[2] === 'test/version') {
          const v = Number(url.searchParams.get('v'));
          if (!Number.isInteger(v) || v < 0 || v > 99) return json({ error: 'invalid v' }, 400);
          return json({ ok: await stub.setSavedVersionNow(v) });
        }
        if (m[2] === 'test/step') {
          const n = Number(url.searchParams.get('n') ?? '1');
          if (!Number.isInteger(n) || n < 1 || n > 100) return json({ error: 'invalid n' }, 400);
          return json({ tick: await stub.stepNow(n) });
        }
        return json(await stub.debugState());
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error('worker failed', e);
      return json({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
