// 1戦の通し：部屋を作る → 2人が入る → 配置を確定 → reveal → 戦闘 → result → もう一戦 → 次の setup。
// あわせて、配置の期限切れ、不正な配置、号令、隠す情報、座標の返し、部屋のコードの取り合い・満員・存在しない部屋。

import { applyTemplate, plainField, PVP_RULES } from '@jinkei/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, army, attackArmy, BACK, createRoom, FRONT, holdArmy, MID, ZONE, zc, postRoom, randomPid, scoreDelta, setupPair, sleep, startServer, unpack, upgradeStatus } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8801 });
});
afterAll(async () => {
  await server?.stop();
});

const FAST = { tickMs: 10, revealMs: 300, maxTicks: 300 };

describe('1戦の通し', () => {
  it('作成から次の setup まで進み、成績が正しく足される', async () => {
    const { A, B, code } = await setupPair(server.base, { ...FAST, setupMs: 30_000 });
    expect(code).toMatch(/^\d{4}$/);
    expect(A.room.you).toBe(0);
    expect(B.room.you).toBe(1);
    expect(A.room.seats.map((s) => s.name)).toEqual(['A', 'B']);
    expect(A.room.deadlines.setup).toBeGreaterThan(Date.now());
    expect(A.room.rules.budget).toBe(PVP_RULES.budget);
    expect(A.room.map).toBe('plain');

    A.send({ type: 'draft', army: holdArmy() });
    A.send({ type: 'ready' });
    await B.waitRoom((r) => r.seats[0].ready === true);
    expect(B.room.seats[1].ready).toBe(false);
    B.send({ type: 'ready', army: holdArmy() });

    const [revA, revB] = await Promise.all([A.waitMsg((m) => m.type === 'reveal'), B.waitMsg((m) => m.type === 'reveal')]);
    expect(revA.battleNo).toBe(1);
    expect(revA.armies[0]).toHaveLength(holdArmy().length);
    expect(revA.startsAt).toBeGreaterThan(revA.serverTime - 1000);
    // 公開の段階では、相手の方針を送らない
    expect(revA.armies[1].every((u) => !('stance' in u))).toBe(true);
    expect(revA.armies[0].every((u) => u.stance === 'hold')).toBe(true);
    expect(revB.armies[0].every((u) => !('stance' in u))).toBe(true);

    await A.waitRoom((r) => r.phase === 'battle', 5000, 'battle');
    const [resA, resB] = await Promise.all([A.waitMsg((m) => m.type === 'result', { ms: 20_000 }), B.waitMsg((m) => m.type === 'result', { ms: 20_000 })]);
    // 全部隊が守備どうしは、開戦から 10 秒（100 刻み）で膠着の引き分け（design §3.6.4）
    expect(resA.winner).toBe('draw');
    expect(resA.reason).toBe('stalemate');
    expect(resA.summary.seconds).toBe(10);
    expect(resA.score).toEqual([0, 0, 1]);
    expect(resB.score).toEqual([0, 0, 1]);
    expect(resA.battleNo).toBe(1);
    // 決着の刻みの snap が result より前に届く
    const lastSnap = A.last('snap');
    expect(lastSnap.outcome).not.toBeNull();
    expect(lastSnap.tick).toBe(100);
    expect(lastSnap.events.some((e) => e.type === 'end')).toBe(true);
    // snap の刻みは前に進むだけ。間隔はふつう2刻み（遅れを取り戻す呼び出しでは最大5刻み）
    const ticks = A.of('snap').map((s) => s.tick);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    expect(ticks.length).toBeGreaterThan(100 / 6);
    await A.waitRoom((r) => r.phase === 'result');

    // 違う battleNo の rematch は効かない
    A.send({ type: 'rematch', battleNo: 0 });
    await sleep(200);
    expect(A.room.rematch).toEqual([false, false]);
    A.send({ type: 'rematch', battleNo: 1 });
    await B.waitRoom((r) => r.rematch[0] === true);
    B.send({ type: 'rematch', battleNo: 1 });
    await Promise.all([A.waitRoom((r) => r.phase === 'setup'), B.waitRoom((r) => r.phase === 'setup')]);
    expect(A.room.score).toEqual([0, 0, 1]);
    expect(A.room.battleNo).toBe(1);
    expect(A.room.seats.map((s) => s.ready)).toEqual([false, false]);
    expect(A.room.myArmy).toBeNull();

    // 2戦目：勝ち負けが付く配置（陣営0は前進と本陣狙い、陣営1は守備）。成績は勝者に足される
    const attack = attackArmy();
    A.send({ type: 'ready', army: attack });
    B.send({ type: 'ready', army: holdArmy() });
    const from = A.messages.length;
    const r2 = await A.waitMsg((m) => m.type === 'result', { from, ms: 30_000 });
    expect(r2.battleNo).toBe(2);
    const d = scoreDelta(r2.winner);
    expect(r2.score).toEqual([d[0], d[1], 1 + d[2]]);
    expect(r2.summary.units.length).toBe(attack.length + holdArmy().length);
    A.close();
    B.close();
  });
});

describe('配置の期限切れと検査', () => {
  it('確定しなかった人は最後に検査を通った下書き、なければ既定の編成で始まる。不正な配置は断られる', async () => {
    const { A, B } = await setupPair(server.base, { ...FAST, setupMs: 1500 });
    const good = holdArmy();
    A.send({ type: 'draft', army: good });
    await sleep(100);
    // 本陣が2つの下書き：保存はされるが、検査を通らないので「最後に検査を通った下書き」は変わらない
    const twoHq = [...good, { kind: 'hq', col: zc(0), row: BACK, stance: 'hold' }];
    A.send({ type: 'draft', army: twoHq });
    // 不正な配置での確定は断られる
    A.send({ type: 'ready' });
    const err = await A.waitMsg((m) => m.type === 'error');
    expect(err.reason).toBe('invalid_army');
    expect(err.armyErrors.some((e) => e.code === 'hq_count')).toBe(true);
    // エリア外・予算超過も断られる
    A.send({ type: 'ready', army: army([['hq', MID, FRONT - 5, 'hold'], ['infantry', MID - 1, FRONT, 'advance']]) });
    const err2 = await A.waitMsg((m) => m.type === 'error' && m !== err);
    expect(err2.armyErrors.some((e) => e.code === 'out_of_zone')).toBe(true);
    // 予算を超える騎兵（エリアの中に2行で並べる。部隊数は上限の中）
    const nCav = Math.floor(PVP_RULES.budget / PVP_RULES.costs.cavalry) + 1;
    expect(nCav).toBeLessThanOrEqual(PVP_RULES.maxUnits);
    const rich = army([['hq', MID, BACK, 'hold'], ...Array.from({ length: nCav }, (_, i) => ['cavalry', zc(i % ZONE.width), FRONT + Math.floor(i / ZONE.width), 'flank'])]);
    A.send({ type: 'ready', army: rich });
    const err3 = await A.waitMsg((m) => m.type === 'error' && m !== err && m !== err2);
    expect(err3.armyErrors.some((e) => e.code === 'over_budget')).toBe(true);
    // 通り道の列（戦場の両端の列）に置いた配置の確定は、invalid_army（out_of_zone）で断られる（design §13.2 の 1）
    for (const lane of [0, ZONE.col + ZONE.width]) {
      const from = A.messages.length;
      A.send({ type: 'ready', army: [...good.slice(0, -1), { kind: 'infantry', col: lane, row: FRONT, stance: 'hold' }] });
      const e = await A.waitMsg((m) => m.type === 'error', { from });
      expect(e.reason).toBe('invalid_army');
      expect(e.armyErrors.some((x) => x.code === 'out_of_zone')).toBe(true);
    }
    await sleep(100);
    expect(B.room.seats[0].ready).toBe(false);
    // 形の違うメッセージは黙って捨てる
    A.send('not json');
    A.send({ type: 'draft', army: 'x' });
    A.send({ type: 'draft', army: good, extra: 1 });

    const [revA, revB] = await Promise.all([A.waitMsg((m) => m.type === 'reveal', { ms: 10_000 }), B.waitMsg((m) => m.type === 'reveal', { ms: 10_000 })]);
    // A は最後に検査を通った下書き
    expect(revA.armies[0]).toEqual(good);
    // B は既定の編成（PVP_RULES.standardRoster を横陣で）。自分が下の座標では、陣営0のひな形と同じ形になる
    const field = plainField();
    const expected = applyTemplate('line', PVP_RULES.standardRoster, field.zones[0], 0);
    expect(revB.armies[1]).toEqual(expected);
    // A から見た B の配置は、上下左右を返した位置で、方針なし
    expect(revA.armies[1]).toEqual(expected.map((p) => ({ kind: p.kind, col: field.width - 1 - p.col, row: field.height - 1 - p.row })));
    A.close();
    B.close();
  });
});

describe('号令', () => {
  it('受け付けられると両者の snap に出来事が出て残りが減る。4回目・battleNo 違い・戦闘以外では効かない', async () => {
    const { A, B } = await setupPair(server.base, { tickMs: 20, revealMs: 300, maxTicks: 600, setupMs: 30_000 });
    // 戦闘の前の号令は効かない（段階が違う）
    A.send({ type: 'order', battleNo: 0, target: 'all', kind: 'brace' });
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitRoom((r) => r.phase === 'battle', 10_000, 'battle');
    await A.waitMsg((m) => m.type === 'snap');
    const battleNo = A.room.battleNo;
    expect(battleNo).toBe(1);
    // battleNo が違う号令は黙って捨てる
    A.send({ type: 'order', battleNo: battleNo + 1, target: 'all', kind: 'brace' });
    await sleep(200);
    expect(A.last('snap').ordersLeft).toEqual([3, 3]);
    expect(A.of('error')).toEqual([]);

    const fromA = A.messages.length;
    const fromB = B.messages.length;
    A.send({ type: 'order', battleNo, target: 'center', kind: 'brace' });
    const orderEvent = (m) => m.type === 'snap' && m.events.some((e) => e.type === 'order' && e.side === 0);
    const [sa, sb] = await Promise.all([A.waitMsg(orderEvent, { from: fromA }), B.waitMsg(orderEvent, { from: fromB })]);
    for (const s of [sa, sb]) {
      expect(s.events.find((e) => e.type === 'order')).toMatchObject({ side: 0, target: 'center', kind: 'brace' });
      expect(s.ordersLeft).toEqual([2, 3]);
    }
    // 中央の部隊にだけ堅守がかかる
    const mine = sa.units.map(unpack).filter((u) => u.side === 0);
    expect(mine.filter((u) => u.wing === 'center').every((u) => u.order === 'brace')).toBe(true);
    expect(mine.filter((u) => u.wing !== 'center').every((u) => u.order === null)).toBe(true);

    // 続けて3回送る：2回は受け付けられ、まだ step に渡っていない分も数えるので、4回目は断られる
    // 突撃だと戦いが早く決着しうるので、動かない堅守と後退で数える
    A.send({ type: 'order', battleNo, target: 'all', kind: 'brace' });
    A.send({ type: 'order', battleNo, target: 'left', kind: 'brace' });
    A.send({ type: 'order', battleNo, target: 'right', kind: 'brace' });
    const err = await A.waitMsg((m) => m.type === 'error');
    expect(err.reason).toBe('invalid_order');
    await A.waitMsg((m) => m.type === 'snap' && m.ordersLeft[0] === 0);
    await sleep(300);
    expect(A.last('snap').ordersLeft[0]).toBe(0);
    const orders = A.of('snap').flatMap((s) => s.events).filter((e) => e.type === 'order' && e.side === 0);
    expect(orders.map((e) => e.target)).toEqual(['center', 'all', 'left']);
    // 出来事は一度だけ届く（前の snap のあとの分だけを送る）
    const fromB2 = B.of('snap').flatMap((s) => s.events).filter((e) => e.type === 'order' && e.side === 0);
    expect(fromB2.map((e) => e.target)).toEqual(['center', 'all', 'left']);
    // 号令を使い切ったあとも断られる（まだ戦闘中であることを確かめてから）
    expect(A.room.phase).toBe('battle');
    A.send({ type: 'order', battleNo, target: 'all', kind: 'brace' });
    await A.waitMsg((m) => m.type === 'error' && m !== err, { label: 'error after orders used up' });
    await A.waitMsg((m) => m.type === 'result', { ms: 30_000 });
    // 結果の段階の号令は効かない（黙って捨てる）
    const nErr = A.of('error').length;
    A.send({ type: 'order', battleNo, target: 'all', kind: 'brace' });
    await sleep(200);
    expect(A.of('error').length).toBe(nErr);
    A.close();
    B.close();
  });
});

describe('隠す情報と座標の返し', () => {
  it('相手の方針と pid は届かず、陣営1の配置は陣営1には下、陣営0には上に見える', async () => {
    const { A, B } = await setupPair(server.base, { tickMs: 20, revealMs: 300, maxTicks: 200, setupMs: 30_000 });
    // 両者の方針が重ならないようにする（陣営0は hold と hunt、陣営1は advance と flank）
    const armyA = army([
      ['hq', MID, BACK, 'hold'],
      ['cavalry', zc(0), FRONT + 2, 'hunt'],
      ['cavalry', zc(ZONE.width - 1), FRONT + 2, 'hunt'],
      ['shield', MID, FRONT + 1, 'hold'],
    ]);
    // 陣営1：自分から見て左の3分の1（戦場の列 0〜2。左翼）に騎兵、本陣はエリアの左下の隅
    const armyB = army([
      ['hq', zc(0), BACK, 'advance'],
      ['cavalry', zc(0), FRONT + 2, 'flank'],
      ['infantry', zc(1), FRONT + 2, 'advance'],
      ['infantry', zc(ZONE.width - 1), FRONT + 2, 'advance'],
    ]);
    const field = plainField();
    const third = field.width / 3;
    A.send({ type: 'ready', army: armyA });
    B.send({ type: 'ready', army: armyB });
    const revB = await B.waitMsg((m) => m.type === 'reveal');
    const revA = await A.waitMsg((m) => m.type === 'reveal');
    expect(revB.armies[1]).toEqual(armyB);
    expect(revA.armies[1]).toEqual(armyB.map((p) => ({ kind: p.kind, col: field.width - 1 - p.col, row: field.height - 1 - p.row })));

    const snapB = await B.waitMsg((m) => m.type === 'snap');
    const snapA = await A.waitMsg((m) => m.type === 'snap' && m.tick === snapB.tick);
    const hqB = (s) => s.units.map(unpack).find((u) => u.side === 1 && u.kind === 'hq');
    // 陣営1の人には、自分の本陣が左下に見える（エリアの左下の隅のマスの中心）。前は上（fy が負）
    expect(hqB(snapB).x).toBeCloseTo(zc(0) + 0.5, 0);
    expect(hqB(snapB).y).toBeGreaterThan(BACK);
    expect(hqB(snapB).fy).toBeLessThan(0);
    // 陣営0の人には、同じ部隊が右上に見える。前は下（fy が正）
    expect(hqB(snapA).x).toBeCloseTo(field.width - zc(0) - 0.5, 0);
    expect(hqB(snapA).y).toBeLessThan(field.height - BACK);
    expect(hqB(snapA).fy).toBeGreaterThan(0);
    // 翼は返さない：陣営1が自分から見て左に置いた部隊は 'left'（号令の target と同じ基準）
    const cavB = snapB.units.map(unpack).find((u) => u.side === 1 && u.kind === 'cavalry');
    expect(cavB.wing).toBe('left');
    expect(cavB.x).toBeLessThan(third);
    // 陣営1が自分から見た左翼へ号令を出すと、その部隊にかかる
    B.send({ type: 'order', battleNo: B.room.battleNo, target: 'left', kind: 'brace' });
    const withOrder = await B.waitMsg((m) => m.type === 'snap' && m.events.some((e) => e.type === 'order' && e.side === 1));
    const leftUnits = withOrder.units.map(unpack).filter((u) => u.side === 1 && u.wing === 'left');
    expect(leftUnits.length).toBeGreaterThan(0);
    expect(leftUnits.every((u) => u.order === 'brace' && u.x < third)).toBe(true);
    // 自軍の stance は届き、敵軍は null
    expect(snapB.units.map(unpack).filter((u) => u.side === 1).every((u) => u.stance !== null)).toBe(true);
    expect(snapB.units.map(unpack).filter((u) => u.side === 0).every((u) => u.stance === null)).toBe(true);

    await Promise.all([A.waitMsg((m) => m.type === 'result', { ms: 20_000 }), B.waitMsg((m) => m.type === 'result', { ms: 20_000 })]);
    // 届いた全メッセージを調べる
    for (const raw of B.raw) {
      expect(raw).not.toContain('"hunt"');
      expect(raw).not.toContain(A.pid);
    }
    for (const raw of A.raw) {
      expect(raw).not.toContain('"flank"');
      expect(raw).not.toContain(B.pid);
    }
    // 自分の方針は自分には届いている（検査が空振りしていない）
    expect(A.raw.some((r) => r.includes('"hunt"'))).toBe(true);
    expect(B.raw.some((r) => r.includes('"flank"'))).toBe(true);
    // 狙い・持ち場などの内部の項目も届かない
    for (const raw of [...A.raw, ...B.raw]) expect(raw).not.toMatch(/"(home|rng|flankPhase|flankEdgeX|runup|huntMoves|slideSign|pid|draft|lastValid|goneSince)"/);
    A.close();
    B.close();
  });
});

describe('部屋のコード・満員・存在しない部屋・Origin', () => {
  it('同じコードの取り合いは1つだけが取り、次のコードに移る。取れなければ busy', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => postRoom(server.base, { pid: randomPid(), codes: ['4321'] })),
    );
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(results.filter((r) => r.status === 503).every((r) => r.body.error === 'busy')).toBe(true);
    const next = await postRoom(server.base, { pid: randomPid(), codes: ['4321', '4322'] });
    expect(next).toEqual({ status: 201, body: { code: '4322' } });
    // 本文の検査
    expect((await postRoom(server.base, { pid: 'short' })).status).toBe(400);
    expect((await postRoom(server.base, { pid: randomPid(), extra: 1 })).status).toBe(400);
  });

  it('予約は作った人だけが使え、満員の部屋と存在しない部屋は error を送って閉じる', async () => {
    const owner = randomPid();
    const code = await createRoom(server.base, owner, FAST);
    // 予約中に別の人が来ても入れない
    const early = new Client(server.base, code, { name: 'early' });
    await early.connect();
    expect((await early.waitMsg((m) => m.type === 'error')).reason).toBe('not_found');
    expect([4003, null]).toContain((await early.waitClosed()).code);

    const A = new Client(server.base, code, { pid: owner, name: 'A' });
    const B = new Client(server.base, code, { name: 'B' });
    await A.connect();
    await B.connect();
    await A.waitRoom((r) => r.phase === 'setup');
    const C = new Client(server.base, code, { name: 'C' });
    await C.connect();
    const e = await C.waitMsg((m) => m.type === 'error');
    expect(e.reason).toBe('full');
    expect([4002, null]).toContain((await C.waitClosed()).code);
    expect(C.messages.some((m) => m.type === 'room')).toBe(false);

    const X = new Client(server.base, '9999', { name: 'X' });
    await X.connect();
    expect((await X.waitMsg((m) => m.type === 'error')).reason).toBe('not_found');
    expect([4003, null]).toContain((await X.waitClosed()).code);
    // 形の違うコードは HTTP で断る
    expect(await upgradeStatus(server.base, `/api/rooms/12a4/ws?pid=${randomPid()}&name=x`)).toBe(404);
    // pid・名前の形が違えば断る
    expect(await upgradeStatus(server.base, `/api/rooms/${code}/ws?pid=xyz&name=x`)).toBe(400);
    expect(await upgradeStatus(server.base, `/api/rooms/${code}/ws?pid=${randomPid()}&name=`)).toBe(400);
    A.close();
    B.close();
  });

  it('よその Origin からの作成と入室は断る', async () => {
    const r = await fetch(`${server.base}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ pid: randomPid() }),
    });
    expect(r.status).toBe(403);
    expect(await upgradeStatus(server.base, `/api/rooms/1234/ws?pid=${randomPid()}&name=x`, { Origin: 'http://evil.example' })).toBe(403);
    // 同じ Origin なら通る（部屋はないので、つないだあと error が届く）
    expect(await upgradeStatus(server.base, `/api/rooms/1234/ws?pid=${randomPid()}&name=x`, { Origin: server.base })).toBe(101);
  });
});
