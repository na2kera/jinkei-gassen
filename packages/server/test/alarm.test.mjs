// アラームが2回（以上）呼ばれても、段階の移り変わりと成績の加算は1回だけ。期限の前に呼んでも何も進まない。
// アラームを自動では鳴らさない（testAlarmLagMs で大きく遅らせる）ことで、期限が過ぎたあとにテストから続けて呼ぶ。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdArmy, scoreDelta, setupPair, sleep, startServer, testRoute } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8804 });
});
afterAll(async () => {
  await server?.stop();
});

describe('アラームの2回呼び出し', () => {
  it('setup → reveal → battle → result の各段階で、2回呼んでも1回分しか進まない', async () => {
    const timing = { tickMs: 20, setupMs: 400, revealMs: 400, maxTicks: 100, testAlarmLagMs: 600_000 };
    const { A, B, code } = await setupPair(server.base, timing);
    A.send({ type: 'draft', army: holdArmy() });
    // 期限の前に呼んでも何も進まず、アラームは入れ直される
    await testRoute(server.base, code, 'alarm');
    let st = await testRoute(server.base, code, 'state');
    expect(st.phase).toBe('setup');
    expect(st.alarm).not.toBeNull();
    expect(st.alarm).toBeGreaterThan(Date.now() + 500_000);

    // 期限を過ぎてもアラームは鳴らない（遅らせてある）
    await sleep(600);
    expect((await testRoute(server.base, code, 'state')).phase).toBe('setup');
    // 2回続けて（同時に）呼ぶ
    await Promise.all([testRoute(server.base, code, 'alarm'), testRoute(server.base, code, 'alarm')]);
    await testRoute(server.base, code, 'alarm');
    st = await testRoute(server.base, code, 'state');
    expect(st.phase).toBe('reveal');
    expect(st.battleNo).toBe(1);
    await sleep(200);
    expect(A.of('reveal').length).toBe(1);
    expect(B.of('reveal').length).toBe(1);

    await sleep(500);
    await Promise.all([testRoute(server.base, code, 'alarm'), testRoute(server.base, code, 'alarm')]);
    st = await testRoute(server.base, code, 'state');
    expect(st.phase).toBe('battle');
    expect(st.battleNo).toBe(1);
    // 戦闘中に見張りを何度呼んでも、刻みの速さは変わらない（setInterval が二重に動かない）
    await testRoute(server.base, code, 'alarm');
    await testRoute(server.base, code, 'alarm');
    await A.waitMsg((m) => m.type === 'snap');
    const t0 = Date.now();
    const tick0 = A.last('snap').tick;
    await sleep(1000);
    const rate = (A.last('snap').tick - tick0) / ((Date.now() - t0) / 20);
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(1.3);

    const res = await A.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    // B は配置を送っていないので既定の編成（横陣）で戦う。勝ち負けは問わず、勝者のぶんが1回だけ足される
    const want = scoreDelta(res.winner);
    await Promise.all([testRoute(server.base, code, 'alarm'), testRoute(server.base, code, 'alarm')]);
    st = await testRoute(server.base, code, 'state');
    expect(st.phase).toBe('result');
    expect(st.score).toEqual(want);
    await sleep(200);
    expect(A.of('result').length).toBe(1);
    expect(A.room.score).toEqual(want);
    // 公開と開戦は1回ずつ
    expect(A.of('room').filter((r) => r.phase === 'reveal').length).toBe(1);
    expect(A.of('room').filter((r) => r.phase === 'battle').length).toBe(1);
    A.close();
    B.close();
  });
});
