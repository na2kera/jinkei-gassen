// 切断と復帰、同じ pid の二重接続、不在（結果の段階で60秒いない席）、予約の期限、片付け。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createRoom, holdArmy, randomPid, setupPair, sleep, startServer, testRoute } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8802 });
});
afterAll(async () => {
  await server?.stop();
});

describe('切断と復帰', () => {
  it('戦闘中に片方が切れても進み、同じ pid で戻るとその時点の場面と残りの号令が届く。二重接続は古いほうが閉じる', async () => {
    const { A, B, code } = await setupPair(server.base, { tickMs: 20, revealMs: 300, maxTicks: 700, setupMs: 30_000 });
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await B.waitMsg((m) => m.type === 'snap');
    const battleNo = B.room.battleNo;
    // B が号令を1つ使ってから切れる
    B.send({ type: 'order', battleNo, target: 'all', kind: 'brace' });
    await B.waitMsg((m) => m.type === 'snap' && m.ordersLeft[1] === 2);
    B.close();
    await A.waitRoom((r) => r.seats[1].connected === false, 5000, 'B disconnected');
    const tickAtLeave = A.last('snap').tick;
    // 切れている間も戦闘は進む
    await A.waitMsg((m) => m.type === 'snap' && m.tick >= tickAtLeave + 40);
    expect(A.room.phase).toBe('battle');

    // 同じ pid で戻る：room と、その時点の snap が届く
    const B2 = new Client(server.base, code, { pid: B.pid, name: 'B' });
    await B2.connect();
    const room = await B2.waitMsg((m) => m.type === 'room');
    expect(room.phase).toBe('battle');
    expect(room.you).toBe(1);
    expect(room.battleNo).toBe(battleNo);
    const snap = await B2.waitMsg((m) => m.type === 'snap');
    expect(B2.messages.indexOf(room)).toBeLessThan(B2.messages.indexOf(snap));
    expect(snap.tick).toBeGreaterThan(tickAtLeave);
    expect(snap.ordersLeft).toEqual([3, 2]);
    expect(snap.units.length).toBe(holdArmy().length * 2);
    await A.waitRoom((r) => r.seats[1].connected === true, 5000, 'B back');
    // 戻った人は号令を出せる
    B2.send({ type: 'order', battleNo, target: 'center', kind: 'brace' });
    await B2.waitMsg((m) => m.type === 'snap' && m.ordersLeft[1] === 1);

    // 同じ pid でもう1つつなぐ：古い接続（B2）が閉じ、新しい接続（B3）が有効になる
    const B3 = new Client(server.base, code, { pid: B.pid, name: 'B' });
    await B3.connect();
    await B3.waitMsg((m) => m.type === 'snap');
    expect([4001, null]).toContain((await B2.waitClosed()).code);
    // 古い接続の「切れた」は無視される：B はつながったまま
    await sleep(300);
    expect(A.room.seats[1].connected).toBe(true);
    const n = B2.of('snap').length;
    await sleep(300);
    expect(B2.of('snap').length).toBe(n);
    expect(B3.of('snap').length).toBeGreaterThan(0);
    A.close();
    B3.close();
  });
});

describe('不在', () => {
  it('結果の段階で awayMs いない席は空き、成績を消して waiting に戻る', async () => {
    const { A, B } = await setupPair(server.base, { tickMs: 10, revealMs: 200, maxTicks: 60, setupMs: 30_000, awayMs: 1500 });
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    await A.waitRoom((r) => r.phase === 'result');
    expect(A.room.score).toEqual([0, 0, 1]);
    const t0 = Date.now();
    B.close();
    await A.waitRoom((r) => r.seats[1]?.connected === false, 5000, 'B gone');
    // awayMs の前は、まだ席がある
    await sleep(700);
    expect(A.room.phase).toBe('result');
    const back = await A.waitRoom((r) => r.phase === 'waiting', 10_000, 'waiting');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
    expect(back.seats[1]).toBeNull();
    expect(back.seats[0].name).toBe('A');
    expect(back.score).toEqual([0, 0, 0]);
    // 空いた席には別の人が入れ、また setup から始まる
    const C = new Client(server.base, A.code, { name: 'C' });
    await C.connect();
    await Promise.all([A.waitRoom((r) => r.phase === 'setup'), C.waitRoom((r) => r.phase === 'setup')]);
    expect(C.room.you).toBe(1);
    // 前の B は、もう戻れない（席がない。満員）
    const Bx = new Client(server.base, A.code, { pid: B.pid, name: 'B' });
    await Bx.connect();
    expect((await Bx.waitMsg((m) => m.type === 'error')).reason).toBe('full');
    A.close();
    C.close();
  });

  it('result に入った時点ですでに awayMs を過ぎた席も空く', async () => {
    const { A, B } = await setupPair(server.base, { tickMs: 20, revealMs: 200, maxTicks: 150, setupMs: 30_000, awayMs: 800 });
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitRoom((r) => r.phase === 'battle', 10_000, 'battle');
    B.close();
    // 戦闘は 150 × 20ms = 3秒。そのあいだに awayMs（0.8秒）を過ぎる
    const r = await A.waitRoom((x) => x.phase === 'waiting', 15_000, 'waiting');
    expect(A.of('result').length).toBe(1);
    expect(r.seats[1]).toBeNull();
    expect(r.score).toEqual([0, 0, 0]);
    A.close();
  });
});

describe('予約と片付け', () => {
  it('作った人が来ないまま予約が切れると empty に戻り、入れない', async () => {
    const pid = randomPid();
    const code = await createRoom(server.base, pid, { reserveMs: 500 });
    await sleep(1200);
    const A = new Client(server.base, code, { pid, name: 'A' });
    await A.connect();
    expect((await A.waitMsg((m) => m.type === 'error')).reason).toBe('not_found');
    // 空いたコードは、また作れる
    const again = await createRoom(server.base, randomPid(), undefined, [code]);
    expect(again).toBe(code);
  });

  it('誰もつながっていない状態が cleanupMs 続くと片付けられ、同じ pid でも戻れない', async () => {
    const { A, B, code } = await setupPair(server.base, { cleanupMs: 1000, setupMs: 60_000 });
    A.close();
    B.close();
    await sleep(500);
    expect((await testRoute(server.base, code, 'state')).phase).toBe('setup');
    await sleep(1500);
    const st = await testRoute(server.base, code, 'state');
    expect(st.phase).toBe('empty');
    expect(st.score).toEqual([0, 0, 0]);
    const A2 = new Client(server.base, code, { pid: A.pid, name: 'A' });
    await A2.connect();
    expect((await A2.waitMsg((m) => m.type === 'error')).reason).toBe('not_found');
  });
});
