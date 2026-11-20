// 自分で出たことを知らせる（design §11.2、§11.4 の S5〜S12、§11.5-11 の S18〜S22・S24）。
// leave を受けた段階ごとの扱い：waiting は席を空ける、setup・result は待機に戻す、reveal・battle は席を残して left を立てる。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createRoom, holdArmy, loneArcherArmy, setupPair, shieldWallArmy, sleep, startServer, testRoute } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8809 });
});
afterAll(async () => {
  await server?.stop();
});

const LEAVE = { type: 'leave' };

/** 守備どうしの短い1戦を終えて、両方に result が届くまで進める（成績を 0 でなくするため） */
async function playDraw(A, B) {
  A.send({ type: 'ready', army: holdArmy() });
  B.send({ type: 'ready', army: holdArmy() });
  await Promise.all([A.waitMsg((m) => m.type === 'result', { ms: 20_000 }), B.waitMsg((m) => m.type === 'result', { ms: 20_000 })]);
  await Promise.all([A.waitRoom((r) => r.phase === 'result'), B.waitRoom((r) => r.phase === 'result')]);
}

/** 長めに続く戦い（A は弓兵1、B は盾の壁。時間切れまで決着しない）を始め、両方に snap が届くまで進める */
async function startLongBattle(timing) {
  const p = await setupPair(server.base, { setupMs: 30_000, revealMs: 200, tickMs: 20, ...timing });
  p.A.send({ type: 'ready', army: loneArcherArmy() });
  p.B.send({ type: 'ready', army: shieldWallArmy() });
  await Promise.all([p.A.waitMsg((m) => m.type === 'snap'), p.B.waitMsg((m) => m.type === 'snap')]);
  return p;
}

/** 出た人の接続が server から閉じられた（手元の開発サーバーでは close の知らせが届ききらないことがあるので null も許す） */
async function expectClosedByServer(c) {
  expect([1000, null]).toContain((await c.waitClosed()).code);
}

describe('配置と結果の途中で出る', () => {
  it('S5・S12 setup で片方が leave：残った人に waiting・opponentLeft・成績 0 がすぐ届く。新しい相手が入ると opponentLeft は false に戻る', async () => {
    const { A, B, code } = await setupPair(server.base, { tickMs: 10, revealMs: 200, maxTicks: 60, setupMs: 30_000 });
    await playDraw(A, B);
    A.send({ type: 'rematch', battleNo: A.room.battleNo });
    B.send({ type: 'rematch', battleNo: B.room.battleNo });
    await Promise.all([A.waitRoom((r) => r.phase === 'setup'), B.waitRoom((r) => r.phase === 'setup')]);
    expect(B.room.score).toEqual([0, 0, 1]);
    await sleep(200);
    const t0 = Date.now();
    const seenByA = A.messages.length;
    A.send(LEAVE);
    const r = await B.waitRoom((x) => x.phase === 'waiting', 5000, 'waiting');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.opponentLeft).toBe(true);
    expect(r.score).toEqual([0, 0, 0]);
    expect(r.seats[0]).toBeNull();
    expect(r.seats[1].name).toBe('B');
    expect(r.deadlines.setup).toBeNull();
    await expectClosedByServer(A);
    // 出た人には、出たあとの room は届かない
    expect(A.messages.slice(seenByA).some((m) => m.type === 'room')).toBe(false);

    // S12：新しい相手が入ると setup に入り、opponentLeft は false に戻る
    const C = new Client(server.base, code, { name: 'C' });
    await C.connect();
    const r2 = await B.waitRoom((x) => x.phase === 'setup', 5000, 'setup with C');
    expect(r2.opponentLeft).toBe(false);
    const rc = await C.waitRoom((x) => x.phase === 'setup', 5000, 'C setup');
    expect(rc.opponentLeft).toBe(false);
    expect(rc.you).toBe(0);
    B.close();
    C.close();
  });

  it('S6 result で片方が leave：S5 と同じく、すぐ waiting・opponentLeft・成績 0', async () => {
    const { A, B } = await setupPair(server.base, { tickMs: 10, revealMs: 200, maxTicks: 60, setupMs: 30_000 });
    await playDraw(A, B);
    expect(A.room.score).toEqual([0, 0, 1]);
    B.send(LEAVE);
    const r = await A.waitRoom((x) => x.phase === 'waiting', 5000, 'waiting');
    expect(r.opponentLeft).toBe(true);
    expect(r.score).toEqual([0, 0, 0]);
    expect(r.seats[1]).toBeNull();
    await expectClosedByServer(B);
    A.close();
  });

  it('S10 waiting で1人が leave：席が空き、別の人がそのコードで入れる', async () => {
    const A = new Client(server.base, '', { name: 'A' });
    A.code = await createRoom(server.base, A.pid);
    await A.connect();
    await A.waitRoom((r) => r.phase === 'waiting');
    A.send(LEAVE);
    await expectClosedByServer(A);
    const C = new Client(server.base, A.code, { name: 'C' });
    await C.connect();
    const r = await C.waitMsg((m) => m.type === 'room' || m.type === 'error');
    expect(r.type).toBe('room');
    expect(r.phase).toBe('waiting');
    expect(r.you).toBe(0);
    expect(r.seats[1]).toBeNull();
    // 部屋に誰もいなくなったので、opponentLeft は立てない
    expect(r.opponentLeft).toBe(false);
    const D = new Client(server.base, A.code, { name: 'D' });
    await D.connect();
    await Promise.all([C.waitRoom((x) => x.phase === 'setup'), D.waitRoom((x) => x.phase === 'setup')]);
    C.close();
    D.close();
  });

  it('S24 配置の途中で相手が leave し、別の人が入る：残った人の配置は始め直され、期限が新しく、前の確定が持ち越されない', async () => {
    const { A, B, code } = await setupPair(server.base, { setupMs: 30_000 });
    // B は確定し、A はまだ。A が出る
    B.send({ type: 'ready', army: holdArmy() });
    await B.waitRoom((r) => r.seats[1].ready === true);
    const before = B.room.deadlines.setup;
    const battleNoBefore = B.room.battleNo;
    expect(B.room.myArmy).not.toBeNull();
    A.send(LEAVE);
    await B.waitRoom((r) => r.phase === 'waiting' && r.opponentLeft === true, 5000, 'waiting');
    await sleep(50);
    const C = new Client(server.base, code, { name: 'C' });
    await C.connect();
    const r = await B.waitRoom((x) => x.phase === 'setup', 5000, 'setup');
    expect(r.seats[1].ready).toBe(false);
    expect(r.seats[0].ready).toBe(false);
    // 対戦の番号が進んでいる（公開の前から開いたままの古い画面でも、新しい配置だと分かるように。古い画面は、
    // 「コード + 番号」が同じだと、前の「完了」を送り直す）
    expect(r.battleNo).toBe(battleNoBefore + 1);
    expect(r.seats[0].name).toBe('C');
    expect(r.myArmy).toBeNull();
    expect(r.deadlines.setup).toBeGreaterThan(before);
    // C が確定しただけでは公開に進まない（B の前の確定が残っていない）
    C.send({ type: 'ready', army: holdArmy() });
    await B.waitRoom((x) => x.seats[0].ready === true);
    await sleep(300);
    expect(B.room.phase).toBe('setup');
    B.close();
    C.close();
  });
});

describe('戦闘の途中で出る', () => {
  it('S7 battle で片方が leave：戦闘は続き、相手の席は connected false・left true。決着のあと rematch ですぐ waiting', async () => {
    const { A, B } = await startLongBattle({ maxTicks: 150 });
    A.send(LEAVE);
    const r = await B.waitRoom((x) => x.seats[0]?.left === true, 5000, 'A left');
    expect(r.phase).toBe('battle');
    expect(r.seats[0].connected).toBe(false);
    expect(r.opponentLeft).toBe(false);
    await expectClosedByServer(A);
    const tick = B.last('snap').tick;
    await B.waitMsg((m) => m.type === 'snap' && m.tick > tick + 10);
    const res = await B.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    expect(res.summary.reason).toBe('timeout');
    await B.waitRoom((x) => x.phase === 'result');
    expect(B.room.seats[0].left).toBe(true);
    const t0 = Date.now();
    B.send({ type: 'rematch', battleNo: B.room.battleNo });
    const w = await B.waitRoom((x) => x.phase === 'waiting', 5000, 'waiting');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(w.opponentLeft).toBe(true);
    expect(w.seats[0]).toBeNull();
    expect(w.score).toEqual([0, 0, 0]);
    B.close();
  });

  it('S8 S7 で rematch を送らない：結果に入ってから leftMs たつと waiting・opponentLeft', async () => {
    const { A, B, code } = await startLongBattle({ maxTicks: 100, leftMs: 1500 });
    A.send(LEAVE);
    await B.waitRoom((x) => x.seats[0]?.left === true, 5000, 'A left');
    await B.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    // 期限は server が結果に入った時刻から数える。受け取った時刻から測ると、届くのが遅れただけで落ちるので、
    // server が持っている期限（deadlines.left。同じ機械の時計）と比べる
    const before = await testRoute(server.base, code, 'state');
    const w = await B.waitRoom((x) => x.phase === 'waiting', 10_000, 'waiting');
    if (before.phase === 'result') {
      expect(typeof before.deadlines.left).toBe('number');
      expect(Date.now()).toBeGreaterThanOrEqual(before.deadlines.left);
    }
    expect(w.opponentLeft).toBe(true);
    expect(w.seats[0]).toBeNull();
    const st = await testRoute(server.base, code, 'state');
    expect(st.phase).toBe('waiting');
    expect(st.deadlines.left).toBeUndefined();
    expect(st.counts.skippedPastAlarm).toBe(0);
    B.close();
  });

  it('S9 battle で leave した人が同じコードで入り直す：席に戻り、left false、号令が出せる', async () => {
    const { A, B, code } = await startLongBattle({ maxTicks: 400 });
    A.send(LEAVE);
    await B.waitRoom((x) => x.seats[0]?.left === true, 5000, 'A left');
    await expectClosedByServer(A);
    // 出た人の席も「席にいる」と答える（入り直せるので、入室の回数に数えない。design §11.2）
    const seated = await (await fetch(`${server.base}/api/rooms/${code}/test/seated?pid=${A.pid}`, { method: 'POST' })).json();
    expect(seated.seated).toBe(true);
    const A2 = new Client(server.base, code, { pid: A.pid, name: 'A' });
    await A2.connect();
    const room = await A2.waitMsg((m) => m.type === 'room');
    expect(room.phase).toBe('battle');
    expect(room.you).toBe(0);
    expect(room.seats[0].left).toBe(false);
    expect(room.seats[0].connected).toBe(true);
    await B.waitRoom((x) => x.seats[0]?.left === false && x.seats[0].connected === true, 5000, 'A back');
    await A2.waitMsg((m) => m.type === 'snap');
    A2.send({ type: 'order', battleNo: room.battleNo, target: 'all', kind: 'charge' });
    await A2.waitMsg((m) => m.type === 'snap' && m.ordersLeft[0] === 2);
    A2.close();
    B.close();
  });

  it('S18 reveal の途中で leave：battle と同じく、席を残して戦いを最後まで進める', async () => {
    const { A, B } = await setupPair(server.base, { setupMs: 30_000, revealMs: 1500, tickMs: 20, maxTicks: 100 });
    A.send({ type: 'ready', army: loneArcherArmy() });
    B.send({ type: 'ready', army: shieldWallArmy() });
    await B.waitRoom((r) => r.phase === 'reveal');
    A.send(LEAVE);
    const r = await B.waitRoom((x) => x.seats[0]?.left === true, 5000, 'A left');
    expect(r.phase).toBe('reveal');
    await B.waitRoom((x) => x.phase === 'battle', 5000, 'battle');
    await B.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    expect(B.room.seats[0].left).toBe(true);
    B.close();
  });

  it('S19 2人とも leave：戦いは最後まで進み、left の期限は置かず、片付けに任せる', async () => {
    // 片付けの期限（idle）は、誰もつながっていなくなった時刻から数える（いまの作り）。結果を見てから片付くよう、戦い（2秒）より長くする
    const { A, B, code } = await startLongBattle({ maxTicks: 100, cleanupMs: 5000 });
    A.send(LEAVE);
    B.send(LEAVE);
    await expectClosedByServer(A);
    await expectClosedByServer(B);
    let st;
    for (let i = 0; i < 100; i++) {
      st = await testRoute(server.base, code, 'state');
      if (st.phase !== 'battle') break;
      await sleep(100);
    }
    expect(st.phase).toBe('result');
    expect(st.deadlines.left).toBeUndefined();
    expect(st.deadlines.idle).toBeGreaterThan(0);
    // 誰もつながっていないので、cleanupMs で片付けられる
    for (let i = 0; i < 100 && st.phase !== null; i++) {
      await sleep(100);
      st = await testRoute(server.base, code, 'state');
    }
    expect(st.phase).toBeNull();
    expect(st.keys).toBe(0);
  });

  it('S20 片方が left、もう片方が切れている：leftMs で left の席を空けて待機へ。切れていた人は戻ると、opponentLeft を見る', async () => {
    const { A, B, code } = await startLongBattle({ maxTicks: 100, leftMs: 1000 });
    A.send(LEAVE);
    await B.waitRoom((x) => x.seats[0]?.left === true, 5000, 'A left');
    B.close();
    let st;
    for (let i = 0; i < 150; i++) {
      st = await testRoute(server.base, code, 'state');
      if (st.phase === 'waiting') break;
      await sleep(100);
    }
    expect(st.phase).toBe('waiting');
    expect(st.counts.skippedPastAlarm).toBe(0);
    const B2 = new Client(server.base, code, { pid: B.pid, name: 'B' });
    await B2.connect();
    const r = await B2.waitMsg((m) => m.type === 'room');
    expect(r.phase).toBe('waiting');
    expect(r.you).toBe(1);
    expect(r.seats[0]).toBeNull();
    expect(r.opponentLeft).toBe(true);
    B2.close();
  });

  it('S21 退出から awayMs より長く戦闘が続いても、結果のあと leftMs は待つ', async () => {
    // awayMs（0.3秒）より長く戦い（100 刻み × 20ms = 2秒）が続いたあとでも、結果は leftMs（2秒）見せる
    const { A, B, code } = await startLongBattle({ maxTicks: 100, awayMs: 300, leftMs: 2000 });
    A.send(LEAVE);
    await B.waitRoom((x) => x.seats[0]?.left === true, 5000, 'A left');
    await B.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    // S8 と同じく、server が持っている期限と比べる。awayMs（0.3秒）はとうに過ぎているので、
    // 不在の扱いが left の席に当たっていたら、state を読む前に待機へ戻っている
    const before = await testRoute(server.base, code, 'state');
    expect(before.phase).toBe('result');
    expect(typeof before.deadlines.left).toBe('number');
    const w = await B.waitRoom((x) => x.phase === 'waiting', 10_000, 'waiting');
    expect(Date.now()).toBeGreaterThanOrEqual(before.deadlines.left);
    expect(w.opponentLeft).toBe(true);
    expect((await testRoute(server.base, code, 'state')).counts.skippedPastAlarm).toBe(0);
    B.close();
  });

  it('S22 結果の画面で、left の人が入り直す：ふつうの入り直しになり、leftMs を過ぎても待機に戻らない', async () => {
    const { A, B, code } = await startLongBattle({ maxTicks: 100, leftMs: 1500 });
    A.send(LEAVE);
    await B.waitRoom((x) => x.seats[0]?.left === true, 5000, 'A left');
    await B.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    const A2 = new Client(server.base, code, { pid: A.pid, name: 'A' });
    await A2.connect();
    const room = await A2.waitMsg((m) => m.type === 'room');
    expect(room.phase).toBe('result');
    expect(room.seats[0].left).toBe(false);
    await A2.waitMsg((m) => m.type === 'result');
    await B.waitRoom((x) => x.seats[0]?.left === false && x.seats[0].connected === true, 5000, 'A back');
    expect((await testRoute(server.base, code, 'state')).deadlines.left).toBeUndefined();
    await sleep(2000);
    expect(B.room.phase).toBe('result');
    // ふつうに、もう一戦できる
    A2.send({ type: 'rematch', battleNo: room.battleNo });
    B.send({ type: 'rematch', battleNo: room.battleNo });
    await Promise.all([A2.waitRoom((x) => x.phase === 'setup'), B.waitRoom((x) => x.phase === 'setup')]);
    expect(B.room.opponentLeft).toBe(false);
    A2.close();
    B.close();
  });
});

describe('ただ切れただけ', () => {
  it('S11 leave を送らずに切れた：left は false のまま、結果の awayMs で席が空き、opponentLeft は false', async () => {
    const { A, B } = await setupPair(server.base, { tickMs: 10, revealMs: 200, maxTicks: 60, setupMs: 30_000, awayMs: 1000 });
    await playDraw(A, B);
    B.close();
    const r = await A.waitRoom((x) => x.seats[1]?.connected === false, 5000, 'B gone');
    expect(r.seats[1].left).toBe(false);
    const w = await A.waitRoom((x) => x.phase === 'waiting', 10_000, 'waiting');
    expect(w.seats[1]).toBeNull();
    expect(w.opponentLeft).toBe(false);
    A.close();
  });
});
