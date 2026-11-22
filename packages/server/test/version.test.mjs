// 古い画面を断る・盤が変わる前の部屋を片付ける（design §13.6、decisions §22「公開のときの古い画面」）。
// 版 3 より前の画面（cv なしは 1）は、席を探す前に error（outdated）を送られて 1008 で閉じられる。
// 保存してある部屋の形の版が 3 以下なら、読み込みで保存領域とアラームを消して、ないものとして扱う。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, CURRENT_CV, createRoom, holdArmy, randomPid, setupPair, sleep, startServer, stepTicks, testRoute } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8810 });
});
afterAll(async () => {
  await server?.stop();
});

/** 入室を試み、最初に届いたメッセージ（room か error）と、閉じられたか（閉じられなければ null）を返す */
async function tryJoin(code, opts) {
  const c = new Client(server.base, code, opts);
  await c.connect();
  const first = await c.waitMsg((m) => m.type === 'room' || m.type === 'error');
  const closed = first.type === 'error' ? await c.waitClosed() : null;
  return { c, first, closed };
}

/** 版の保存を書き換える（テスト用の口） */
async function setSavedVersion(code, v) {
  const r = await fetch(`${server.base}/api/rooms/${code}/test/version?v=${v}`, { method: 'POST' });
  expect(r.status).toBe(200);
  return (await r.json()).ok;
}

describe('古い画面を断る', () => {
  it('版なし・版 1・版 2 は、待機中の部屋でも outdated を受けて 1008 で閉じられ、席に着かない。版 3 は入れる', async () => {
    const owner = randomPid();
    const code = await createRoom(server.base, owner);
    const A = new Client(server.base, code, { pid: owner, name: 'A' });
    await A.connect();
    await A.waitRoom((r) => r.phase === 'waiting');
    for (const cv of [undefined, 1, 2]) {
      const { c, first, closed } = await tryJoin(code, { name: 'old', cv });
      expect(first).toMatchObject({ type: 'error', reason: 'outdated' });
      // 手元の開発サーバーでは close の知らせが届かないことがある（code: null。helpers の waitClosed）
      if (closed.code !== null) expect(closed.code).toBe(1008);
      expect(c.of('room')).toEqual([]);
      c.close();
    }
    // 断られた人は席に着いていない（A はまだ相手を待っている）
    expect(A.room.phase).toBe('waiting');
    expect(A.room.seats[1]).toBeNull();
    // 版 3 は入れる
    const { c: B, first } = await tryJoin(code, { name: 'B', cv: CURRENT_CV });
    expect(first.type).toBe('room');
    await A.waitRoom((r) => r.phase === 'setup', 5000, 'setup');
    A.close();
    B.close();
  });

  it('席にいる人でも、古い版の入り直しは断られる。部屋の作成の予約（reserved）にも、ない部屋にも、先に outdated を返す', async () => {
    const owner = randomPid();
    const code = await createRoom(server.base, owner);
    // 作った人が、古い版でつなぐ（reserved のまま）
    const r1 = await tryJoin(code, { pid: owner, name: 'A', cv: 2 });
    expect(r1.first).toMatchObject({ type: 'error', reason: 'outdated' });
    r1.c.close();
    // 断られても予約は残っていて、版 3 なら作った人が入れる
    const r2 = await tryJoin(code, { pid: owner, name: 'A' });
    expect(r2.first).toMatchObject({ type: 'room', phase: 'waiting' });
    // ない部屋でも、古い版には outdated（読み込み直せば、新しい版で「見つからない」を出す）
    const r3 = await tryJoin('0000', { name: 'x', cv: undefined });
    expect(r3.first).toMatchObject({ type: 'error', reason: 'outdated' });
    r3.c.close();
    // 版 3 でない部屋に入ると、いままでどおり not_found
    const r4 = await tryJoin('0000', { name: 'x' });
    expect(r4.first).toMatchObject({ type: 'error', reason: 'not_found' });
    r4.c.close();
    r2.c.close();
  });
});

describe('盤が変わる前の部屋（RoomState の v が 3 以下）', () => {
  it('v: 3 の部屋は、読み込みで保存領域とアラームが消え、入ろうとした人には not_found。同じコードで新しい部屋を作れる', async () => {
    // 作っただけの部屋（reserved）。予約の期限のアラームが入っている
    const owner = randomPid();
    const code = await createRoom(server.base, owner);
    const before = await testRoute(server.base, code, 'state');
    expect(before.phase).toBe('reserved');
    expect(before.keys).toBeGreaterThan(0);
    expect(before.alarm).not.toBeNull();
    // 保存した部屋を、盤が変わる前の形に書き換えてから、Durable Object を作り直させる
    expect(await setSavedVersion(code, 3)).toBe(true);
    await testRoute(server.base, code, 'abort');
    const after = await testRoute(server.base, code, 'state');
    expect(after.instance).not.toBe(before.instance);
    expect(after.phase).toBeNull();
    expect(after.keys).toBe(0);
    expect(after.alarm).toBeNull();
    // 作った人が入ろうとしても、部屋は見つからない
    const { c, first } = await tryJoin(code, { pid: owner, name: 'A' });
    expect(first).toMatchObject({ type: 'error', reason: 'not_found' });
    c.close();
    // 同じコードで作り直した部屋は、残って使える
    const owner2 = randomPid();
    expect(await createRoom(server.base, owner2, undefined, [code])).toBe(code);
    const again = await tryJoin(code, { pid: owner2, name: 'C' });
    expect(again.first).toMatchObject({ type: 'room', phase: 'waiting' });
    expect((await testRoute(server.base, code, 'state')).keys).toBeGreaterThan(0);
    again.c.close();
  });

  it('戦闘の途中の v: 3 の部屋も、部屋と戦闘の記録・アラームが消え、作り直したあとに古い戦闘は再開しない（刻みが進まない）', async () => {
    // 刻みを手で進める部屋で、戦闘に入れて少し進め、戦闘の記録（battle）を保存させる
    const timing = { tickMs: 100, revealMs: 300, maxTicks: 300, setupMs: 30_000, testManualTicks: 1 };
    const { A, B, code } = await setupPair(server.base, timing);
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitRoom((r) => r.phase === 'battle', 10_000, 'battle');
    expect(await stepTicks(server.base, code, 30)).toBeGreaterThanOrEqual(30);
    const before = await testRoute(server.base, code, 'state');
    expect(before.phase).toBe('battle');
    expect(before.savedBattleNo).toBe(1);
    expect(before.savedTick).toBeGreaterThanOrEqual(20);
    expect(before.alarm).not.toBeNull();
    // 保存した部屋を盤が変わる前の形にしてから、作り直させる
    expect(await setSavedVersion(code, 3)).toBe(true);
    await testRoute(server.base, code, 'abort');
    const after = await testRoute(server.base, code, 'state');
    expect(after.instance).not.toBe(before.instance);
    expect(after).toMatchObject({ phase: null, savedTick: null, savedBattleNo: null, liveTick: null, running: false, alarm: null, keys: 0 });
    // 古い戦闘は動かない：刻みを進めようとしても進まず、時間がたっても何も保存されない
    expect(await stepTicks(server.base, code, 10)).toBeNull();
    await sleep(1500);
    const later = await testRoute(server.base, code, 'state');
    expect(later).toMatchObject({ phase: null, savedTick: null, liveTick: null, running: false, alarm: null, keys: 0 });
    expect(later.instance).toBe(after.instance);
    // 席にいた人が入り直そうとしても、部屋は見つからない
    const { c, first } = await tryJoin(code, { pid: A.pid, name: 'A' });
    expect(first).toMatchObject({ type: 'error', reason: 'not_found' });
    c.close();
    A.close();
    B.close();
  });

  it('v: 4 の部屋は、作り直したあとも読み戻せる（席と段階が残る）', async () => {
    const owner = randomPid();
    const code = await createRoom(server.base, owner);
    const A = new Client(server.base, code, { pid: owner, name: 'A' });
    await A.connect();
    await A.waitRoom((r) => r.phase === 'waiting');
    const before = await testRoute(server.base, code, 'state');
    expect(await setSavedVersion(code, 4)).toBe(true);
    await testRoute(server.base, code, 'abort');
    const after = await testRoute(server.base, code, 'state');
    expect(after.instance).not.toBe(before.instance);
    expect(after.phase).toBe('waiting');
    expect(after.gen).toBe(before.gen);
    const B = new Client(server.base, code, { name: 'B' });
    await B.connect();
    const room = await B.waitMsg((m) => m.type === 'room');
    expect(room.phase).toBe('setup');
    A.close();
    B.close();
  });
});
