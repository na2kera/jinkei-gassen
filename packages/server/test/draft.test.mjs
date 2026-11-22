// 下書きの覚え方（design §15.5）。配置の画面では本陣が最初から置いてあるので、「部隊を置いたあと、全部外して本陣だけにした」
// 下書きがふつうに届く。下書きを「通る／足りないだけ／それ以外の不正」に分け、足りないだけの下書きでは、前に通った下書きを
// 時間切れ・読み込み直しで生き返らせない。

import { PVP_RULES } from '@jinkei/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, army, BACK, FRONT, holdArmy, MID, setupPair, startServer, zc } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8811 });
});
afterAll(async () => {
  await server?.stop();
});

const TIMING = { tickMs: 10, revealMs: 300, maxTicks: 100, setupMs: 3000 };
const HQ_ONLY = army([['hq', MID, BACK, 'hold']]);
const HQ_INF = army([
  ['hq', MID, BACK, 'hold'],
  ['infantry', zc(0), FRONT, 'advance'],
]);

async function rejoin(c) {
  const again = new Client(server.base, c.code, { pid: c.pid, name: c.name, cv: c.cv });
  await again.connect();
  await again.waitMsg((m) => m.type === 'room', { label: 'room after rejoin' });
  return again;
}

/** 返事のある番兵（いまの下書きのままの確定。下書きが通らないので断られる）を送り、それまでに送った下書きが処理されたことを確かめる */
async function sentinel(c) {
  const from = c.messages.length;
  c.send({ type: 'ready' });
  return c.waitMsg((m) => m.type === 'error' && m.reason === 'invalid_army', { from, label: 'sentinel' });
}

/** 兵種ごとの数（本陣を含む） */
function kinds(list) {
  const r = {};
  for (const p of list) r[p.kind] = (r[p.kind] ?? 0) + 1;
  return r;
}

describe('下書きを「通る／足りないだけ／それ以外の不正」に分ける（design §15.5）', () => {
  it('通る下書き → 全部外す（本陣だけ）→ 読み込み直すと本陣だけが返り、時間切れでは標準の軍で始まる', async () => {
    let { A, B } = await setupPair(server.base, TIMING);
    B.send({ type: 'ready', army: holdArmy() });
    A.send({ type: 'draft', army: HQ_INF });
    A.send({ type: 'draft', army: HQ_ONLY });
    await sentinel(A);
    A = await rejoin(A);
    expect(A.room.myArmy).toEqual(HQ_ONLY);
    expect(A.room.myReserve ?? null).toBeNull();
    const rev = await A.waitMsg((m) => m.type === 'reveal', { ms: 10_000 });
    const mine = rev.armies[A.room.you];
    // 外したはずの歩兵の軍（本陣と歩兵 1）ではなく、標準の編成
    expect(kinds(mine)).toEqual(PVP_RULES.standardRoster);
    expect(rev.myReserve ?? null).toBeNull();
    A.close();
    B.close();
  });

  it('最後の盤の部隊を遊軍へ移した（本陣＋遊軍）→ 読み込み直すと本陣と遊軍、時間切れでは標準の軍で遊軍なし', async () => {
    let { A, B } = await setupPair(server.base, TIMING);
    B.send({ type: 'ready', army: holdArmy() });
    A.send({ type: 'draft', army: HQ_INF });
    A.send({ type: 'draft', army: HQ_ONLY, reserve: { kind: 'infantry', stance: 'advance' } });
    await sentinel(A);
    A = await rejoin(A);
    expect(A.room.myArmy).toEqual(HQ_ONLY);
    expect(A.room.myReserve).toEqual({ kind: 'infantry', stance: 'advance' });
    const rev = await A.waitMsg((m) => m.type === 'reveal', { ms: 10_000 });
    expect(kinds(rev.armies[A.room.you])).toEqual(PVP_RULES.standardRoster);
    expect(rev.myReserve ?? null).toBeNull();
    A.close();
    B.close();
  });

  it('通る下書き → 不正な下書き（重なり・予算超え）→ 時間切れ：前に通った下書きで始まる（いままでどおり）', async () => {
    let { A, B } = await setupPair(server.base, TIMING);
    B.send({ type: 'ready', army: holdArmy() });
    A.send({ type: 'draft', army: HQ_INF });
    A.send({ type: 'draft', army: [...HQ_INF, { kind: 'archer', col: zc(0), row: FRONT, stance: 'hold' }] });
    const over = army([['hq', MID, BACK, 'hold'], ...Array.from({ length: 7 }, (_, i) => ['cavalry', zc(i), FRONT, 'flank'])]);
    A.send({ type: 'draft', army: over });
    await sentinel(A);
    A = await rejoin(A);
    expect(A.room.myArmy).toEqual(HQ_INF);
    const rev = await A.waitMsg((m) => m.type === 'reveal', { ms: 10_000 });
    expect(kinds(rev.armies[A.room.you])).toEqual({ hq: 1, infantry: 1 });
    A.close();
    B.close();
  });

  it('「足りないだけ」の配置での確定は断られる', async () => {
    const { A, B } = await setupPair(server.base, { ...TIMING, setupMs: 20_000 });
    const from = A.messages.length;
    A.send({ type: 'ready', army: HQ_ONLY });
    const e = await A.waitMsg((m) => m.type === 'error', { from, label: 'thin ready' });
    expect(e.reason).toBe('invalid_army');
    expect(e.armyErrors.map((x) => x.code)).toEqual(['too_few_units']);
    expect(A.room.seats[A.room.you].ready).toBe(false);
    // 本陣＋遊軍でも同じ
    const from2 = A.messages.length;
    A.send({ type: 'ready', army: HQ_ONLY, reserve: { kind: 'cavalry', stance: 'flank' } });
    const e2 = await A.waitMsg((m) => m.type === 'error', { from: from2, label: 'thin ready 2' });
    expect(e2.armyErrors.map((x) => x.code)).toEqual(['too_few_units']);
    A.close();
    B.close();
  });
});
