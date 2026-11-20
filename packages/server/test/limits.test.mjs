// 回数の上限（design §11.1、§11.4 の S1・S2・S4、§11.5-11 の S14〜S17）。
// 席にいる人のつなぎ直しは入室の回数に数えない。ws の頼みはすべて、粗い上限（WS_LIMITER、1分 600 回）で数える。
// 手元の開発サーバーの上限は時計の1分ごとの窓で数えるので、数えるところは inOneWindow の中で走らせる（窓をまたいだら新しい鍵でやり直す）。
// 鍵はテストごと・やり直しごとに乱数で作るので、ほかのテストと回数を共有しない。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createRoom, inOneWindow, randomPid, setupPair, startServer, testRoute, upgradeStatus } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8808 });
});
afterAll(async () => {
  await server?.stop();
});

/** 同じ pid・同じ鍵で n 回つなぎ直す。毎回 room が届くのを待ち、client から閉じる。返すのは最後の接続 */
async function reconnectMany(code, pid, key, n) {
  let last = null;
  for (let i = 0; i < n; i++) {
    last?.close();
    const c = new Client(server.base, code, { pid, name: 'A', rlKey: key });
    await c.connect();
    const room = await c.waitMsg((m) => m.type === 'room' || m.type === 'error', { ms: 10_000, label: `room #${i + 1}` });
    expect(room.type, `つなぎ直し ${i + 1} 回目`).toBe('room');
    last = c;
  }
  return last;
}

/** ws の頼み（Upgrade つき）を、席にいない pid で n 回送り、状態コードを返す */
async function joinMany(code, key, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await upgradeStatus(server.base, `/api/rooms/${code}/ws?pid=${randomPid()}&name=x`, { 'X-Test-Rl-Key': key }));
  return out;
}

describe('席にいる人のつなぎ直し', () => {
  it('S1 席にいる人が、同じ鍵で 130 回つなぎ直しても 429 にならない（毎回 room が届く）', async () => {
    const A = new Client(server.base, '', { name: 'A' });
    A.code = await createRoom(server.base, A.pid);
    await inOneWindow(async (key) => {
      const last = await reconnectMany(A.code, A.pid, key, 130);
      expect(last.room.phase).toBe('waiting');
      last.close();
    });
  });

  it('S15 同じ鍵で入室の上限（120）を使い切ったあとでも、席にいる人のつなぎ直しは通る。席にいない人は 429', async () => {
    const { A, B, code } = await setupPair(server.base, { setupMs: 120_000 });
    await inOneWindow(async (key) => {
      // ない部屋への入室で、この鍵の入室の回数を使い切る
      const joins = await joinMany('0000', key, 121);
      expect(joins.slice(0, 120).every((s) => s === 101)).toBe(true);
      expect(joins[120]).toBe(429);
      // 席にいる A は、同じ鍵でつなぎ直せる（数えない）
      const A2 = await reconnectMany(code, A.pid, key, 3);
      expect(A2.room.phase).toBe('setup');
      expect(A2.room.you).toBe(0);
      // 席にいない人は、同じ鍵では 429
      expect(await upgradeStatus(server.base, `/api/rooms/${code}/ws?pid=${randomPid()}&name=x`, { 'X-Test-Rl-Key': key })).toBe(429);
      A2.close();
    });
    A.close();
    B.close();
  });
});

describe('席にいない人の入室', () => {
  it('S2・S16 満員の部屋への入室は、同じ鍵で 121 回目から 429（1回目で席に着いてしまわないよう、満員の部屋に向ける）', async () => {
    const { A, B, code } = await setupPair(server.base, { setupMs: 120_000 });
    await inOneWindow(async (key) => {
      const joins = await joinMany(code, key, 121);
      expect(joins.slice(0, 120).every((s) => s === 101)).toBe(true);
      expect(joins[120]).toBe(429);
    });
    // 満員のまま、席の2人はそのまま（断られた入室は席を変えない）
    await A.waitRoom((r) => r.phase === 'setup' && r.seats[0] !== null && r.seats[1] !== null);
    A.close();
    B.close();
  });

  it('S14 ws の頼みは、どれも粗い上限で数える：601 回目が 429（Upgrade のない頼みは部屋に聞かずに 426）', async () => {
    await inOneWindow(async (key) => {
      const statuses = [];
      for (let i = 0; i < 601; i++) {
        const r = await fetch(`${server.base}/api/rooms/0000/ws?pid=${randomPid()}&name=x`, { headers: { 'X-Test-Rl-Key': key } });
        await r.body?.cancel();
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 600).every((s) => s === 426)).toBe(true);
      expect(statuses[600]).toBe(429);
    });
  });
});

describe('isSeated', () => {
  it('S4・S17 ない部屋に聞いても、状態は作られず、アラームも置かれない。ある部屋では席の pid にだけ true', async () => {
    // ない部屋
    const none = await (await fetch(`${server.base}/api/rooms/0002/test/seated?pid=${randomPid()}`, { method: 'POST' })).json();
    expect(none.seated).toBe(false);
    const st = await testRoute(server.base, '0002', 'state');
    expect(st.phase).toBeNull();
    expect(st.keys).toBe(0);
    expect(st.alarm).toBeNull();
    expect(st.counts.put).toBe(0);
    expect(st.counts.alarmSet).toBe(0);

    // ある部屋：席の pid は true、ほかは false。聞いても書き込みは増えない
    const { A, B, code } = await setupPair(server.base, { setupMs: 120_000 });
    const before = await testRoute(server.base, code, 'state');
    const ask = async (pid) => (await (await fetch(`${server.base}/api/rooms/${code}/test/seated?pid=${pid}`, { method: 'POST' })).json()).seated;
    expect(await ask(A.pid)).toBe(true);
    expect(await ask(B.pid)).toBe(true);
    expect(await ask(randomPid())).toBe(false);
    const after = await testRoute(server.base, code, 'state');
    expect(after.instance).toBe(before.instance);
    expect(after.counts.put).toBe(before.counts.put);
    expect(after.counts.alarmSet).toBe(before.counts.alarmSet);
    expect(after.alarm).toBe(before.alarm);
    expect(after.deadlines).toEqual(before.deadlines);
    A.close();
    B.close();
  });
});
