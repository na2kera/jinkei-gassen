// 再開：戦闘中に Durable Object が作り直されても、保存した刻みから続き（追いかけない）、決着まで進み、成績が1回だけ足される。
// 作り直し方は2つ。(1) テスト用の経路から ctx.abort() を呼ぶ（見張りのアラームだけで再開することを見る）。
// (2) 開発サーバーを止めて起動し直す（メモリ・接続・setInterval がすべて消える。超富豪の restart.test.mjs と同じ）。

import { afterAll, describe, expect, it } from 'vitest';
import { Client, holdArmy, setupPair, sleep, startServer, testRoute } from './helpers.mjs';

const PORT = 8803;
let server;
afterAll(async () => {
  await server?.stop();
});

/** つながっていなければ、同じ pid でつなぎ直す */
async function ensureConnected(base, c) {
  if (c.ws.readyState === WebSocket.OPEN) return c;
  const again = new Client(base, c.code, { pid: c.pid, name: c.name });
  await again.connect();
  return again;
}

describe('再開', () => {
  it('ctx.abort() で作り直されると、見張りのアラームで保存した刻みから続き、成績は1回だけ足される', async () => {
    server = await startServer({ port: PORT });
    const timing = { tickMs: 20, revealMs: 200, maxTicks: 700, setupMs: 30_000, watchdogMs: 1000 };
    const { A, B, code } = await setupPair(server.base, timing);
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitMsg((m) => m.type === 'snap' && m.tick >= 100, { ms: 20_000 });
    // 号令を1つ使っておく（作り直されても、使った回数が巻き戻らない）
    A.send({ type: 'order', battleNo: A.room.battleNo, target: 'all', kind: 'brace' });
    await A.waitMsg((m) => m.type === 'snap' && m.ordersLeft[0] === 2);
    const before = await testRoute(server.base, code, 'state');
    expect(before.running).toBe(true);

    const lastTickBefore = A.last('snap').tick;
    await testRoute(server.base, code, 'abort');
    const abortedAt = Date.now();
    // 誰も Durable Object に触らずに待つ。見張りのアラーム（1秒）が鳴って再開するはず
    await sleep(2500);
    const after = await testRoute(server.base, code, 'state');
    expect(after.instance).not.toBe(before.instance);
    expect(after.phase).toBe('battle');
    expect(after.running).toBe(true);

    // 作り直されたあとの最初の場面：保存した刻みから続けるので、止まっていた2.5秒（約125刻み）を追いかけていない
    let a = A;
    let b = B;
    a = await ensureConnected(server.base, a);
    b = await ensureConnected(server.base, b);
    const firstAfter = await a.waitMsg((m) => m.type === 'snap' && m.receivedAt > abortedAt, { ms: 10_000 });
    expect(firstAfter.tick).toBeGreaterThanOrEqual(lastTickBefore - SAVE_SLACK);
    // state の呼び出しより前に、見張りのアラームで再開して進んでいた（呼び出しで起こしただけなら、ほとんど進んでいない）
    const sinceResume = after.liveTick - lastTickBefore;
    expect(sinceResume).toBeGreaterThan(20);
    expect(sinceResume).toBeLessThan(125);
    expect(firstAfter.ordersLeft[0]).toBe(2);

    const [ra, rb] = await Promise.all([a.waitMsg((m) => m.type === 'result', { ms: 30_000 }), b.waitMsg((m) => m.type === 'result', { ms: 30_000 })]);
    expect(ra.winner).toBe('draw');
    expect(ra.score).toEqual([0, 0, 1]);
    expect(rb.score).toEqual([0, 0, 1]);
    // アラームがさらに呼ばれても、成績は増えない
    await testRoute(server.base, code, 'alarm');
    await testRoute(server.base, code, 'alarm');
    const fin = await testRoute(server.base, code, 'state');
    expect(fin.score).toEqual([0, 0, 1]);
    expect(fin.phase).toBe('result');
    expect(a.of('result').length).toBe(1);
    a.close();
    b.close();
  });

  it('開発サーバーを起動し直しても、入り直した人の接続で保存した刻みから続き、成績は1回だけ足される', async () => {
    const timing = { tickMs: 20, revealMs: 200, maxTicks: 700, setupMs: 30_000, watchdogMs: 1000 };
    const { A, B, code } = await setupPair(server.base, timing);
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitMsg((m) => m.type === 'snap' && m.tick >= 100, { ms: 20_000 });
    const lastTickBefore = A.last('snap').tick;
    const dir = server.persistDir;
    await server.stop({ keep: true });
    await Promise.all([A.waitClosed(15_000), B.waitClosed(15_000)]);
    server = await startServer({ port: PORT, persistDir: dir });
    const A2 = new Client(server.base, code, { pid: A.pid, name: 'A' });
    const B2 = new Client(server.base, code, { pid: B.pid, name: 'B' });
    await A2.connect();
    await B2.connect();
    const room = await A2.waitMsg((m) => m.type === 'room');
    expect(room.phase).toBe('battle');
    expect(room.seats.map((s) => s.name)).toEqual(['A', 'B']);
    const first = await A2.waitMsg((m) => m.type === 'snap');
    // 保存は20刻みごとなので、少し前の刻みから続く。止まっていた間は追いかけない
    expect(first.tick).toBeGreaterThanOrEqual(lastTickBefore - SAVE_SLACK);
    expect(first.tick).toBeLessThanOrEqual(lastTickBefore + 30);
    const r = await A2.waitMsg((m) => m.type === 'result', { ms: 30_000 });
    expect(r.score).toEqual([0, 0, 1]);
    await sleep(300);
    expect((await testRoute(server.base, code, 'state')).score).toEqual([0, 0, 1]);
    A2.close();
    B2.close();
  });
});

/** 保存は20刻みごと（timing.ts の SAVE_EVERY_TICKS）。最後に届いた snap より、最大でこれだけ前の刻みから続くことがある */
const SAVE_SLACK = 22;
