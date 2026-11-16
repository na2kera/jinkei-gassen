// Worker の入口（design §4.1）。/api/* だけを扱い、それ以外は client の静的ファイルに任せる
// （開発時は client の vite.config.ts の run_worker_first、本番は wrangler deploy の assets）。
//
//   POST /api/rooms              部屋を作る。本文 { pid } → 201 { code }。コードが取れなければ 503 { error: 'busy' }
//   GET  /api/rooms/:code/ws     WebSocket（?pid=…&name=…）。部屋がない・満員は、つないだあと error を送って閉じる
//
// テストのときだけ（開発サーバーに --var JINKEI_TEST_MODE:1 を渡したとき）:
//   POST /api/rooms の本文に { timing: {...} } を付けて秒数を差し替え、{ codes: [...] } で試すコードの順を決められる
//   POST /api/rooms/:code/test/alarm     アラームの処理をいま実行する（2回鳴った場合の確認）
//   POST /api/rooms/:code/test/abort     Durable Object を作り直させる（再開の確認）
//   POST /api/rooms/:code/test/state     保存した段階・成績・刻みと、インスタンスの識別子を返す

import { DEFAULT_TIMING, parseTimingOverride, type Timing } from './timing.ts';
import type { CreateRoomResponse } from './protocol.ts';
import { originAllowed } from './origin.ts';
import { isPid, isRoomCode, normalizeName } from './validate.ts';

export { Room } from './room.ts';

/** コードを選び直す回数（design §4.3） */
const MAX_CODE_TRIES = 8;
const MAX_BODY_BYTES = 2048;

/** テスト用の機能を有効にするか。wrangler.jsonc の vars には入れない（デプロイされるため） */
function isTestMode(env: Env): boolean {
  return (env as unknown as Record<string, unknown>)['JINKEI_TEST_MODE'] === '1';
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
  const allowed = isTestMode(env) ? ['pid', 'timing', 'codes'] : ['pid'];
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
  const tries = codes ?? Array.from({ length: MAX_CODE_TRIES }, randomCode);
  for (const code of tries) {
    const stub = env.ROOM.getByName(code);
    if (await stub.create(code, pid, timing)) {
      const res: CreateRoomResponse = { code };
      return json(res, 201);
    }
  }
  return json({ error: 'busy' }, 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === '/api/rooms') {
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
        if (!originAllowed(request.headers.get('Origin'), url)) return json({ error: 'forbidden origin' }, 403);
        return await createRoom(request, env);
      }
      const m = /^\/api\/rooms\/([^/]+)\/(ws|test\/alarm|test\/abort|test\/state)$/.exec(path);
      if (m !== null) {
        const code = m[1] ?? '';
        if (!isRoomCode(code)) return json({ error: 'room not found' }, 404);
        const stub = env.ROOM.getByName(code);
        if (m[2] === 'ws') {
          if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
          if (!originAllowed(request.headers.get('Origin'), url)) return json({ error: 'forbidden origin' }, 403);
          if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected websocket' }, 426);
          if (!isPid(url.searchParams.get('pid')) || normalizeName(url.searchParams.get('name')) === null) {
            return json({ error: 'bad pid or name' }, 400);
          }
          return await stub.fetch(request);
        }
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
        return json(await stub.debugState());
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error('worker failed', e);
      return json({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
