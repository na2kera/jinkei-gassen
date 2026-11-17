// 境目のテスト：両者の不在のあとのアラーム、各段階での作り直し、決まりを破った接続、部屋の世代、書き込みの回数、回数の上限。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createRoom, holdArmy, loneArcherArmy, postRoom, shieldWallArmy, randomPid, setupPair, sleep, startServer, testRoute, upgradeStatus } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8805 });
});
afterAll(async () => {
  await server?.stop();
});

/** つながっていなければ、同じ pid でつなぎ直す */
async function ensureConnected(c) {
  if (c.ws.readyState === WebSocket.OPEN) return c;
  c.close();
  const again = new Client(server.base, c.code, { pid: c.pid, name: c.name });
  await again.connect();
  await again.waitMsg((m) => m.type === 'room');
  return again;
}

describe('両者の不在', () => {
  it('2人とも不在の期限を過ぎて決着しても、過去の時刻のアラームを入れ直し続けない', async () => {
    const { A, B, code } = await setupPair(server.base, { tickMs: 10, revealMs: 200, maxTicks: 200, setupMs: 30_000, awayMs: 300, cleanupMs: 60_000 });
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitRoom((r) => r.phase === 'battle', 10_000, 'battle');
    A.close();
    B.close();
    // 戦闘は 200 × 10ms = 2秒。決着の時点で、2人とも不在の期限（0.3秒）を過ぎている
    let st;
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      st = await testRoute(server.base, code, 'state');
      if (st.phase === 'result') break;
    }
    expect(st.phase).toBe('result');
    // 席は空けず（片付けに任せる）、away は残さない。アラームは片付けの期限（未来）だけ
    expect(st.deadlines.away).toBeUndefined();
    expect(st.deadlines.idle).toBeGreaterThan(Date.now() + 50_000);
    expect(st.alarm).toBe(st.deadlines.idle);
    const runs = st.counts.alarmRuns;
    await sleep(1500);
    const later = await testRoute(server.base, code, 'state');
    expect(later.counts.alarmRuns).toBe(runs);
    expect(later.counts.skippedPastAlarm).toBe(0);
    expect(later.alarm).toBe(st.deadlines.idle);
    // A が戻ると、期限を過ぎて不在の B の席だけが空き、A は相手を待つ
    const A2 = await ensureConnected(A);
    const back = await A2.waitRoom((r) => r.phase === 'waiting', 5000, 'waiting');
    expect(back.seats[1]).toBeNull();
    expect(back.you).toBe(0);
    A2.close();
  });

  it('片方だけが不在の期限を過ぎたら、その席だけを空ける（期限は過去に残らない）', async () => {
    const { A, B, code } = await setupPair(server.base, { tickMs: 10, revealMs: 200, maxTicks: 60, setupMs: 30_000, awayMs: 400 });
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitMsg((m) => m.type === 'result', { ms: 10_000 });
    B.close();
    await A.waitRoom((r) => r.phase === 'waiting', 5000, 'waiting');
    const st = await testRoute(server.base, code, 'state');
    expect(st.deadlines.away).toBeUndefined();
    expect(st.alarm === null || st.alarm > Date.now()).toBe(true);
    A.close();
  });
});

describe('各段階での作り直し（ctx.abort）', () => {
  it('setup・reveal・result で作り直しても、状態・席と接続の対応・期限が戻り、先へ進める', async () => {
    const timing = { tickMs: 10, revealMs: 1500, maxTicks: 60, setupMs: 30_000, watchdogMs: 1000 };
    let { A, B, code } = await setupPair(server.base, timing);
    A.send({ type: 'draft', army: holdArmy() });
    await sleep(200);

    // --- setup
    let before = await testRoute(server.base, code, 'state');
    await testRoute(server.base, code, 'abort');
    let after = await testRoute(server.base, code, 'state');
    expect(after.instance).not.toBe(before.instance);
    expect(after.phase).toBe('setup');
    expect(after.gen).toBe(before.gen);
    // ctx.abort() では WebSocket も切れるので、2人とも「切れた」になり、片付けの期限（idle）が足される。配置の期限は同じ
    expect(after.deadlines.setup).toBe(before.deadlines.setup);
    expect(after.alarm).toBe(before.alarm);
    A = await ensureConnected(A);
    B = await ensureConnected(B);
    // 入り直した人には、検査を通った下書きが戻る（つながったままなら、元の接続がそのまま使える）
    A.send({ type: 'ready' });
    await B.waitRoom((r) => r.seats[0].ready === true && r.seats[0].connected && r.seats[1].connected, 5000, 'A ready');
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitMsg((m) => m.type === 'reveal', { ms: 5000 });

    // --- reveal
    before = await testRoute(server.base, code, 'state');
    expect(before.phase).toBe('reveal');
    await testRoute(server.base, code, 'abort');
    after = await testRoute(server.base, code, 'state');
    expect(after.instance).not.toBe(before.instance);
    expect(after.phase).toBe('reveal');
    expect(after.deadlines.reveal).toBe(before.deadlines.reveal);
    expect(after.alarm).toBe(before.alarm);
    // 公開の期限のアラームで、そのまま戦闘へ進む
    A = await ensureConnected(A);
    B = await ensureConnected(B);
    const res = await A.waitMsg((m) => m.type === 'result', { ms: 15_000 });
    expect(res.battleNo).toBe(1);

    // --- result
    await A.waitRoom((r) => r.phase === 'result');
    before = await testRoute(server.base, code, 'state');
    await testRoute(server.base, code, 'abort');
    after = await testRoute(server.base, code, 'state');
    expect(after.phase).toBe('result');
    expect(after.score).toEqual(before.score);
    expect(after.battleNo).toBe(1);
    A = await ensureConnected(A);
    B = await ensureConnected(B);
    A.send({ type: 'rematch', battleNo: 1 });
    B.send({ type: 'rematch', battleNo: 1 });
    await Promise.all([A.waitRoom((r) => r.phase === 'setup', 5000, 'A setup'), B.waitRoom((r) => r.phase === 'setup', 5000, 'B setup')]);
    expect(A.room.seats.map((s) => s.connected)).toEqual([true, true]);
    expect(A.room.score).toEqual(after.score);
    A.close();
    B.close();
  });
});

describe('決まりを破った接続', () => {
  it('大きすぎるメッセージ・バイナリ・頻度の超過で閉じ、その席は「切れた」になり、同じ pid で入り直せる', async () => {
    const { A, B } = await setupPair(server.base, { setupMs: 60_000 });
    // 大きすぎる
    A.send('x'.repeat(5000));
    expect([1009, null]).toContain((await A.waitClosed()).code);
    await B.waitRoom((r) => r.seats[0].connected === false, 5000, 'A gone (size)');
    let A2 = new Client(server.base, A.code, { pid: A.pid, name: 'A' });
    await A2.connect();
    await B.waitRoom((r) => r.seats[0].connected === true, 5000, 'A back');
    // バイナリ
    A2.ws.send(new Uint8Array([1, 2, 3]));
    expect([1003, null]).toContain((await A2.waitClosed()).code);
    await B.waitRoom((r) => r.seats[0].connected === false, 5000, 'A gone (binary)');
    A2 = new Client(server.base, A.code, { pid: A.pid, name: 'A' });
    await A2.connect();
    await B.waitRoom((r) => r.seats[0].connected === true, 5000, 'A back 2');
    // 頻度：ためておける分（20通）を使い切ったあと、さらに20通で閉じる。途中までは閉じない
    for (let i = 0; i < 30; i++) A2.send({ type: 'unready' });
    await sleep(300);
    expect(A2.ws.readyState).toBe(WebSocket.OPEN);
    for (let i = 0; i < 40; i++) A2.send({ type: 'unready' });
    expect([1008, null]).toContain((await A2.waitClosed()).code);
    await B.waitRoom((r) => r.seats[0].connected === false, 5000, 'A gone (rate)');
    const A3 = new Client(server.base, A.code, { pid: A.pid, name: 'A' });
    await A3.connect();
    const room = await A3.waitMsg((m) => m.type === 'room');
    expect(room.you).toBe(0);
    expect(room.phase).toBe('setup');
    A3.close();
    B.close();
  });
});

describe('部屋の世代', () => {
  it('片付けで何も残らず、同じコードの次の部屋は別の世代になり、前の部屋の pid では入れない', async () => {
    const { A, B, code } = await setupPair(server.base, { cleanupMs: 500, setupMs: 60_000 });
    const gen1 = (await testRoute(server.base, code, 'state')).gen;
    A.close();
    B.close();
    let st;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      st = await testRoute(server.base, code, 'state');
      if (st.phase === null) break;
    }
    expect(st.phase).toBeNull();
    expect(st.keys).toBe(0);
    expect(st.alarm).toBeNull();
    // 同じコードで作り直す
    const owner = randomPid();
    expect(await createRoom(server.base, owner, { setupMs: 60_000 }, [code])).toBe(code);
    const gen2 = (await testRoute(server.base, code, 'state')).gen;
    expect(gen2).not.toBe(gen1);
    expect(gen2).toBeGreaterThan(0);
    // 前の部屋の人は、作った人ではないので入れない（予約中）
    const old = new Client(server.base, code, { pid: A.pid, name: 'A' });
    await old.connect();
    expect((await old.waitMsg((m) => m.type === 'error')).reason).toBe('not_found');
    // 作った人が入り、前の部屋の B が来ても、新しい人として扱われる
    const C = new Client(server.base, code, { pid: owner, name: 'C' });
    await C.connect();
    await C.waitRoom((r) => r.phase === 'waiting');
    const oldB = new Client(server.base, code, { pid: B.pid, name: 'B' });
    await oldB.connect();
    await C.waitRoom((r) => r.phase === 'setup');
    expect(C.room.score).toEqual([0, 0, 0]);
    expect(C.room.battleNo).toBe(0);
    C.close();
    oldB.close();
  });
});

describe('書き込みの回数', () => {
  it('最長（1800刻み）の1戦で、保存とアラームの書き込みを数える', async () => {
    const { A, B, code } = await setupPair(server.base, { tickMs: 5, revealMs: 200, maxTicks: 1800, setupMs: 30_000 });
    const before = (await testRoute(server.base, code, 'state')).counts;
    // 守備どうしは 10 秒で膠着になるので、攻撃が続いて時間切れになる組で測る（A は盾の壁、B は弓兵1）
    A.send({ type: 'ready', army: shieldWallArmy() });
    B.send({ type: 'ready', army: loneArcherArmy() });
    await A.waitRoom((r) => r.phase === 'battle', 10_000, 'battle');
    // 号令を3回使う（号令を受け付けた刻みは別に書く）
    for (const target of ['left', 'center', 'right']) {
      A.send({ type: 'order', battleNo: 1, target, kind: 'brace' });
      await sleep(100);
    }
    const res = await A.waitMsg((m) => m.type === 'result', { ms: 60_000 });
    expect(res.summary.reason).toBe('timeout');
    expect(res.summary.seconds).toBe(180);
    const after = (await testRoute(server.base, code, 'state')).counts;
    const put = after.put - before.put;
    const alarmSet = after.alarmSet - before.alarmSet;
    console.log(`writes for one 1800-tick battle (ready → result): put=${put} alarmSet=${alarmSet} total=${put + alarmSet}`);
    // 戦闘の保存 1800/20 = 90、号令3、決着1、部屋の記録が段階ごとに数回。見張りは10秒ごとに入れ直す
    expect(put).toBeLessThan(110);
    expect(alarmSet).toBeLessThan(15);
    A.close();
    B.close();
  });
});

describe('回数の上限（送信元ごと）', () => {
  it('部屋の作成は1分に10回、入室の試みは1分に30回まで。超えたら 429', async () => {
    const key = 'limit-test';
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await postRoom(server.base, { pid: randomPid() }, { rlKey: key })).status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
    // 別の送信元は数えない
    expect((await postRoom(server.base, { pid: randomPid() })).status).toBe(201);
    const joins = [];
    for (let i = 0; i < 31; i++) joins.push(await upgradeStatus(server.base, `/api/rooms/0000/ws?pid=${randomPid()}&name=x`, { 'X-Test-Rl-Key': key }));
    expect(joins.slice(0, 30).every((s) => s === 101)).toBe(true);
    expect(joins[30]).toBe(429);
    // 形の違うコードの試みも数える
    expect(await upgradeStatus(server.base, `/api/rooms/abcd/ws?pid=${randomPid()}&name=x`, { 'X-Test-Rl-Key': key })).toBe(429);
  });
});

describe('テスト用のフラグなし（本番と同じ設定）', () => {
  it('テスト用の経路と秒数の差し替えは 404・400 になり、回数の上限は送信元の IP で効く', async () => {
    const prod = await startServer({ port: 8816, testMode: false });
    try {
      for (const name of ['alarm', 'abort', 'state']) {
        const r = await fetch(`${prod.base}/api/rooms/1234/test/${name}`, { method: 'POST' });
        expect(r.status).toBe(404);
      }
      expect((await postRoom(prod.base, { pid: randomPid(), timing: { setupMs: 100 } })).status).toBe(400);
      expect((await postRoom(prod.base, { pid: randomPid(), codes: ['1234'] })).status).toBe(400);
      // 鍵の差し替え（X-Test-Rl-Key）は効かず、同じ送信元として数えられる。上の2回（400）も数に入る
      const statuses = [];
      for (let i = 0; i < 9; i++) statuses.push((await postRoom(prod.base, { pid: randomPid() })).status);
      expect(statuses.slice(0, 8).every((s) => s === 201)).toBe(true);
      expect(statuses[8]).toBe(429);
    } finally {
      await prod.stop();
    }
  });
});
