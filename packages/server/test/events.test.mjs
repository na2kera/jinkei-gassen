// 出来事の通し番号（snap の evBase）と、戦場の選び方。

import { PVP_MAPS, pvpField } from '@jinkei/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fieldFor } from '../src/flip.ts';
import { Client, army, collectEvents, holdArmy, loneArcherArmy, postRoom, shieldWallArmy, randomPid, setupPair, sleep, startServer, testRoute } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8807 });
});
afterAll(async () => {
  await server?.stop();
});

/** 勝ち負けが付く、動きのある配置（前進と本陣狙い） */
const attack = army([
  ['hq', 5, 15, 'hold'],
  ['infantry', 2, 10, 'advance'],
  ['infantry', 4, 10, 'advance'],
  ['infantry', 6, 10, 'advance'],
  ['infantry', 8, 10, 'advance'],
  ['cavalry', 0, 11, 'hunt'],
  ['cavalry', 11, 11, 'hunt'],
  ['archer', 5, 12, 'advance'],
]);

async function ensureConnected(c) {
  if (c.ws.readyState === WebSocket.OPEN) return c;
  c.close();
  const again = new Client(server.base, c.code, { pid: c.pid, name: c.name });
  await again.connect();
  return again;
}

describe('出来事の通し番号', () => {
  it('1つの接続では番号が 0 から途切れずに続き、同じ号令が2つ受け付けられても別の番号になる。両者で番号と中身がそろう', async () => {
    const { A, B } = await setupPair(server.base, { tickMs: 20, revealMs: 200, maxTicks: 300, setupMs: 30_000 });
    A.send({ type: 'ready', army: holdArmy() });
    B.send({ type: 'ready', army: holdArmy() });
    await A.waitMsg((m) => m.type === 'snap');
    // 同じ翼・同じ種類の号令を続けて2つ（同じ刻みに入ることが多い）
    A.send({ type: 'order', battleNo: 1, target: 'left', kind: 'brace' });
    A.send({ type: 'order', battleNo: 1, target: 'left', kind: 'brace' });
    await A.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    const snaps = A.of('snap');
    expect(snaps[0].evBase).toBe(0);
    for (let i = 1; i < snaps.length; i++) expect(snaps[i].evBase).toBe(snaps[i - 1].evBase + snaps[i - 1].events.length);
    const { byIndex, mismatches, gaps } = collectEvents([A, B]);
    expect(mismatches).toEqual([]);
    expect(gaps).toBe(0);
    const orders = [...byIndex.entries()].filter(([, j]) => JSON.parse(j).type === 'order');
    expect(orders.length).toBe(2);
    expect(new Set(orders.map(([k]) => k)).size).toBe(2);
    // end は最後の番号
    const last = Math.max(...byIndex.keys());
    expect(JSON.parse(byIndex.get(last)).type).toBe('end');
    expect([...byIndex.keys()].sort((a, b) => a - b)).toEqual([...Array(last + 1).keys()]);
    A.close();
    B.close();
  });

  it('入り直した人の最初の snap は events が空で、evBase がいままでに出た出来事の数', async () => {
    const { A, B, code } = await setupPair(server.base, { tickMs: 20, revealMs: 200, maxTicks: 600, setupMs: 30_000 });
    // 守備どうしは 10 秒で膠着になる（design §3.6.4）ので、入り直すまで戦闘が続くよう、攻撃が続いて時間切れになる組を使う（A は盾の壁）
    A.send({ type: 'ready', army: shieldWallArmy() });
    B.send({ type: 'ready', army: loneArcherArmy() });
    await B.waitMsg((m) => m.type === 'snap');
    B.send({ type: 'order', battleNo: 1, target: 'all', kind: 'brace' });
    A.send({ type: 'order', battleNo: 1, target: 'center', kind: 'brace' });
    await A.waitMsg((m) => m.type === 'snap' && m.ordersLeft[0] === 2 && m.ordersLeft[1] === 2);
    B.close();
    await A.waitRoom((r) => r.seats[1].connected === false, 5000, 'B gone');
    const seenByA = Math.max(...A.of('snap').map((s) => s.evBase + s.events.length));
    expect(seenByA).toBe(2);
    const B2 = new Client(server.base, code, { pid: B.pid, name: 'B' });
    await B2.connect();
    const first = await B2.waitMsg((m) => m.type === 'snap');
    expect(first.events).toEqual([]);
    expect(first.evBase).toBe(2);
    await A.waitMsg((m) => m.type === 'result', { ms: 30_000 });
    await B2.waitMsg((m) => m.type === 'result', { ms: 5000 });
    // 入り直したあとの番号も、A に届いたものとそろう
    expect(collectEvents([A, B, B2]).mismatches).toEqual([]);
    A.close();
    B2.close();
  });

  it('作り直されても、同じ番号には同じ出来事が付き、番号は途切れない', async () => {
    const { A, B, code } = await setupPair(server.base, { tickMs: 10, revealMs: 200, maxTicks: 1200, setupMs: 30_000, watchdogMs: 1000 });
    A.send({ type: 'ready', army: attack });
    B.send({ type: 'ready', army: holdArmy() });
    // ぶつかり合って出来事（突入・敗走など）が出始めるまで進める
    await A.waitMsg((m) => m.type === 'snap' && m.evBase + m.events.length >= 2, { ms: 20_000 });
    const lastBefore = Math.max(...A.of('snap').map((s) => s.evBase + s.events.length));
    await testRoute(server.base, code, 'abort');
    await sleep(300);
    const A2 = await ensureConnected(A);
    const B2 = await ensureConnected(B);
    const results = await Promise.all([A2.waitMsg((m) => m.type === 'result', { ms: 30_000 }), B2.waitMsg((m) => m.type === 'result', { ms: 30_000 })]);
    expect(results[0].battleNo).toBe(1);
    const all = [A, A2, B, B2];
    const { byIndex, mismatches } = collectEvents(all);
    expect(mismatches).toEqual([]);
    const last = Math.max(...byIndex.keys());
    expect(last).toBeGreaterThanOrEqual(lastBefore - 1);
    expect([...byIndex.keys()].sort((a, b) => a - b)).toEqual([...Array(last + 1).keys()]);
    expect(JSON.parse(byIndex.get(last)).type).toBe('end');
    // 作り直しのあと最初の snap の evBase は、保存した時点の数（作り直しの前に届いた数を超えない）
    const firstAfter = A2 === A ? null : A2.of('snap')[0];
    if (firstAfter) {
      expect(firstAfter.events).toEqual([]);
      expect(firstAfter.evBase).toBeLessThanOrEqual(lastBefore);
    }
    A2.close();
    B2.close();
  });
});

describe('戦場', () => {
  it('setup に入るたびに4つからランダムに選ぶ', async () => {
    const ids = PVP_MAPS.map((m) => m.id);
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const { A, B } = await setupPair(server.base, { setupMs: 60_000 }, { map: null });
      expect(ids).toContain(A.room.map);
      expect(B.room.map).toBe(A.room.map);
      seen.add(A.room.map);
      A.close();
      B.close();
    }
    // 12回とも同じになる見込みは 4 × (1/4)^12 ≒ 2.4e-7
    expect(seen.size).toBeGreaterThan(1);
  });

  it('テストでは戦場を決められ、room の field は engine の戦場を自分が下の向きにしたもの', async () => {
    for (const map of ['river', 'hill', 'forest']) {
      const { A, B } = await setupPair(server.base, { setupMs: 60_000 }, { map });
      expect(A.room.map).toBe(map);
      expect(A.room.field).toEqual(fieldFor(0, pvpField(map)));
      expect(B.room.field).toEqual(fieldFor(1, pvpField(map)));
      expect(A.room.field.terrain.some((t) => t !== 'plain')).toBe(true);
      A.close();
      B.close();
    }
    expect((await postRoom(server.base, { pid: randomPid(), map: 'moon' })).status).toBe(400);
  });
});
