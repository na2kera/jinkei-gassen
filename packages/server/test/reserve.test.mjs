// 遊軍（design §7.7、§7.9 の R14）：隠す情報、現れたあとの場面、もう一戦、配置の検査、組で扱うこと、
// 現れた直後の作り直し、古い画面の入り直し、遊軍のエラーの op と、渡す前の入力は陣営ごとに1つまで、同じ刻みの遊軍と号令。

import { plainField, PVP_RULES } from '@jinkei/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, army, attackArmy, BACK, FRONT, holdArmy, loneArcherArmy, MID, ZONE, zc, zoneArmy, setupPair, startServer, stepTicks, testRoute, unpack } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8806 });
});
afterAll(async () => {
  await server?.stop();
});

/** 同じ pid・同じ版でつなぎ直す（前の接続は server が 4001 で閉じる）。最初の room が届くまで待つ */
async function rejoin(c) {
  const again = new Client(server.base, c.code, { pid: c.pid, name: c.name, cv: c.cv });
  await again.connect();
  await again.waitMsg((m) => m.type === 'room', { label: 'room after rejoin' });
  return again;
}

/** 部屋ごとに変わる値（コード・時刻）を除いた写し */
function norm(m) {
  const c = structuredClone(m);
  delete c.receivedAt;
  delete c.serverTime;
  // 部屋のコード（エラーの code は残す）
  if (c.type === 'room') delete c.code;
  delete c.startsAt;
  delete c.deadlines;
  return c;
}

const CAV = { kind: 'cavalry', stance: 'advance' };
const ARCH = { kind: 'archer', stance: 'hold' };

/** 刻みを手で進める部屋（timing.testManualTicks: 1）で、target の刻みまで進める */
async function stepTo(code, target) {
  let tick = await stepTicks(server.base, code, 1);
  while (tick !== null && tick < target) {
    const next = await stepTicks(server.base, code, Math.min(100, target - tick));
    if (next === tick) break;
    tick = next;
  }
  return tick;
}

/** 決着するまで刻みを進める（決着すると stepTicks が同じ刻みを返す） */
async function stepToEnd(code, chunk = 20) {
  let prev = -1;
  for (;;) {
    const t = await stepTicks(server.base, code, chunk);
    if (t === prev || t === null) return t;
    prev = t;
  }
}

describe('遊軍を呼ぶ（R14 b・f・h、同じ刻みの遊軍と号令。刻みを手で進める）', () => {
  it('現れた遊軍は両者の snap に出る。現れた直後に作り直しても消えず、二度は呼べない。渡す前の入力は1つまで。同じ刻みの号令もかかる', async () => {
    // A（陣営0）は本陣と弓兵1（どちらも中央の翼。左翼と右翼はだれもいない）、遊軍は騎兵・守備。
    // B（陣営1）は盾兵の壁（守備。遊軍の歩兵と合わせて予算に収まる数）、遊軍は歩兵・守備。弓兵が撃ち続けるので膠着にならず、時間切れまで続く
    const timing = { tickMs: 100, revealMs: 300, maxTicks: 400, setupMs: 30_000, watchdogMs: 1000, testManualTicks: 1 };
    let { A, B, code } = await setupPair(server.base, timing, { cv: [3, 3] });
    const nShield = Math.min(ZONE.width, Math.floor((PVP_RULES.budget - PVP_RULES.costs.infantry) / PVP_RULES.costs.shield));
    const wall = zoneArmy([['hq', 4, ZONE.height - 1, 'hold'], ...Array.from({ length: nShield }, (_, c) => ['shield', c + ZONE.width - nShield, 0, 'hold'])]);
    const aReserve = { kind: 'cavalry', stance: 'hold' };
    const bReserve = { kind: 'infantry', stance: 'hold' };
    A.send({ type: 'ready', army: loneArcherArmy(), reserve: aReserve });
    B.send({ type: 'ready', army: wall, reserve: bReserve });
    const revA = await A.waitMsg((m) => m.type === 'reveal');
    expect(revA.myReserve).toEqual(aReserve);
    expect((await B.waitMsg((m) => m.type === 'reveal')).myReserve).toEqual(bReserve);
    await A.waitRoom((r) => r.phase === 'battle', 5000, 'battle');
    const battleNo = A.room.battleNo;
    expect(await stepTo(code, 10)).toBe(10);
    const first = await A.waitMsg((m) => m.type === 'snap' && m.tick === 10);
    expect(first.reserve).toEqual({ ...aReserve, state: 'waiting' });
    const nUnits = first.units.length;
    expect(nUnits).toBe(loneArcherArmy().length + wall.length);

    // 開戦 5 秒まで（刻み 50 より前）は呼べない。エラーは本人にだけ、op: 'reserve' 付きで返る
    B.send({ type: 'reserve', battleNo, from: 'left' });
    const early = await B.waitMsg((m) => m.type === 'error');
    expect(early).toMatchObject({ type: 'error', reason: 'invalid_reserve', op: 'reserve', code: 'reserve_not_ready' });
    // battleNo が違う・形が違うメッセージは黙って捨てる。番兵（返事のある、正しい形の遊軍の入力）の返事までに、ほかの返事が来ない
    // （同じ接続のメッセージは順に処理されるので、番兵の返事が届けば、その前の2通は処理済み）
    const fromB0 = B.messages.length;
    B.send({ type: 'reserve', battleNo: battleNo + 1, from: 'left' });
    B.send({ type: 'reserve', battleNo, from: 'up' });
    B.send({ type: 'reserve', battleNo, from: 'right' });
    const sentinel = await B.waitMsg((m) => m.type === 'error', { from: fromB0, label: 'sentinel' });
    expect(sentinel).toMatchObject({ code: 'reserve_not_ready' });
    expect(B.messages.slice(fromB0, B.messages.indexOf(sentinel))).toEqual([]);
    // A は何も送っていないので、A に遊軍のエラーは届かない（エラーは本人にだけ）
    expect(A.of('error')).toHaveLength(0);

    // --- 刻み 62 で、B が左から呼ぶ（号令は出さない）。2つ目の入力は、渡す前なので断られる（断りが届けば、1つ目も処理済み）
    expect(await stepTo(code, 62)).toBe(62);
    await B.waitMsg((m) => m.type === 'snap' && m.tick === 62);
    const fromA = A.messages.length;
    const fromB = B.messages.length;
    B.send({ type: 'reserve', battleNo, from: 'left' });
    B.send({ type: 'reserve', battleNo, from: 'left' });
    expect(await B.waitMsg((m) => m.type === 'error', { from: fromB })).toMatchObject({ reason: 'invalid_reserve', op: 'reserve', code: 'no_reserve' });
    // 1刻み進める（刻み 63 は奇数なので snap は出ない）。現れた刻みはすぐ保存している（定期の保存は 20 刻みごと）
    expect(await stepTicks(server.base, code, 1)).toBe(63);
    const st = await testRoute(server.base, code, 'state');
    expect(st.savedTick).toBe(63);
    expect(await stepTicks(server.base, code, 1)).toBe(64);
    const isReserveEv = (side) => (m) => m.type === 'snap' && m.events.some((e) => e.type === 'reserve' && e.side === side);
    const sb = await B.waitMsg(isReserveEv(1), { from: fromB, label: 'B reserve event' });
    const sa = await A.waitMsg(isReserveEv(1), { from: fromA, label: 'B reserve event at A' });
    expect(sb.tick).toBe(64);
    const ev = sb.events.find((e) => e.type === 'reserve');
    expect(ev).toEqual({ type: 'reserve', tick: 62, side: 1, unit: nUnits, from: 'left' });
    expect(sa.events.find((e) => e.type === 'reserve')).toEqual(ev);
    expect(sb.reserve).toEqual({ ...bReserve, state: 'used' });
    // 現れた部隊は、ふつうの部隊として両者の units に入る。B から見て左の端の列（通り道）で、中央の線のすぐ自陣側の行
    // （10×12 の盤なら、自分が下の座標で列 0・行 6）。A から見て右上（列 9・行 5）
    const f = plainField();
    const unitB = sb.units.map(unpack).find((u) => u.id === nUnits);
    expect(unitB).toMatchObject({ side: 1, kind: 'infantry', wing: 'left', stance: 'hold' });
    expect(Math.abs(unitB.x - 0.5)).toBeLessThan(0.6);
    expect(Math.abs(unitB.y - (f.height / 2 + 0.5))).toBeLessThan(0.6);
    const unitA = sa.units.map(unpack).find((u) => u.id === nUnits);
    expect(unitA).toMatchObject({ side: 1, kind: 'infantry', wing: 'left', stance: null });
    expect(Math.abs(unitA.x - (f.width - 0.5))).toBeLessThan(0.6);
    expect(Math.abs(unitA.y - (f.height / 2 - 0.5))).toBeLessThan(0.6);

    // --- 作り直す（保存は刻み 64 より前の 63 のまま。定期の保存は 60 なので、すぐ保存していなければ遊軍は消える）。
    // 戻っても遊軍は現れたまま、もう一度は呼べない
    // 作り直したかは、戻ったあとの刻みで分かる（作り直していなければ、メモリの刻み 64 が届く）
    await testRoute(server.base, code, 'abort');
    A = await rejoin(A);
    B = await rejoin(B);
    const back = await B.waitMsg((m) => m.type === 'snap', { label: 'snap after abort' });
    expect(back.tick).toBe(63);
    expect(back.reserve).toEqual({ ...bReserve, state: 'used' });
    expect(back.units.map(unpack).some((u) => u.id === nUnits && u.kind === 'infantry' && u.side === 1)).toBe(true);
    B.send({ type: 'reserve', battleNo, from: 'right' });
    expect(await B.waitMsg((m) => m.type === 'error')).toMatchObject({ reason: 'invalid_reserve', op: 'reserve', code: 'no_reserve' });

    // --- 刻み 70 で、A が同じ刻みに遊軍（左から）と号令。4通を送り、2通の断りが届いたら、4通とも処理済み
    expect(await stepTo(code, 70)).toBe(70);
    await A.waitMsg((m) => m.type === 'snap' && m.tick === 70);
    const fromA2 = A.messages.length;
    A.send({ type: 'reserve', battleNo, from: 'left' });
    A.send({ type: 'order', battleNo, target: 'all', kind: 'brace' });
    A.send({ type: 'reserve', battleNo, from: 'right' });
    // だれもいない左翼への号令は、遊軍が現れる前（受け取った時点の戦場）で調べるので断られる
    A.send({ type: 'order', battleNo, target: 'left', kind: 'brace' });
    await A.waitFor(() => (A.messages.slice(fromA2).filter((m) => m.type === 'error').length >= 2 ? true : undefined), 10_000, 'two errors');
    const errs = A.messages.slice(fromA2).filter((m) => m.type === 'error');
    expect(errs).toHaveLength(2);
    expect(errs[0]).toMatchObject({ reason: 'invalid_reserve', op: 'reserve', code: 'no_reserve' });
    // 号令のエラーには op を付けない
    expect(errs[1].reason).toBe('invalid_order');
    expect(errs[1].op).toBeUndefined();
    expect(await stepTicks(server.base, code, 2)).toBe(72);
    const withA = await A.waitMsg((m) => m.type === 'snap' && m.tick === 72, { from: fromA2 });
    const rEv = withA.events.find((e) => e.type === 'reserve' && e.side === 0);
    const oEvs = withA.events.filter((e) => e.type === 'order' && e.side === 0);
    expect(rEv).toEqual({ type: 'reserve', tick: 70, side: 0, unit: nUnits + 1, from: 'left' });
    expect(oEvs.map((e) => [e.tick, e.target])).toEqual([[70, 'all']]);
    // 現れたばかりの遊軍にも、同じ刻みの全軍あての号令がかかる
    const cav = withA.units.map(unpack).find((u) => u.id === nUnits + 1);
    expect(cav).toMatchObject({ side: 0, kind: 'cavalry', wing: 'left', order: 'brace', stance: 'hold' });
    expect(withA.ordersLeft[0]).toBe(2);

    await stepToEnd(code, 50);
    const [ra, rb] = await Promise.all([A.waitMsg((m) => m.type === 'result', { ms: 20_000 }), B.waitMsg((m) => m.type === 'result', { ms: 20_000 })]);
    // 呼んだ遊軍は振り返りの部隊に入り、呼ばなかった遊軍はない
    for (const r of [ra, rb]) {
      expect(r.summary.unusedReserve).toEqual([null, null]);
      expect(r.summary.units.some((u) => u.id === nUnits && u.kind === 'infantry')).toBe(true);
      expect(r.summary.units.some((u) => u.id === nUnits + 1 && u.kind === 'cavalry')).toBe(true);
    }
    // 結果の段階の遊軍の入力は黙って捨てる。番兵（もう一戦。自分の接続に room が返る）の返事までに、ほかの知らせが来ない
    await A.waitRoom((r) => r.phase === 'result', 5000, 'result room');
    const fromR = A.messages.length;
    A.send({ type: 'reserve', battleNo, from: 'left' });
    A.send({ type: 'rematch', battleNo });
    const ack = await A.waitMsg((m) => m.type === 'room' && m.rematch[0] === true, { from: fromR, label: 'rematch room' });
    expect(A.messages.slice(fromR, A.messages.indexOf(ack))).toEqual([]);
    A.close();
    B.close();
  });
});

describe('隠す情報：届く列そのもの（R14 a。刻みを手で進め、種を決める）', () => {
  it('相手の遊軍だけを変えた3つの対戦で、届くメッセージの数・順・中身が一致する。兵が減る戦いでも、相手の星の割合は判定の割合に置き換わる', async () => {
    // A（陣営0）が攻める。B（陣営1）は守備で、遊軍を呼ばないまま兵が減る
    // 公開の段階で入り直すため、公開は長めにとる（入り直しが終わる前に戦闘に移ると、列が変わってテストが落ちる）
    const timing = { tickMs: 100, revealMs: 3000, maxTicks: 600, setupMs: 30_000, testManualTicks: 1 };
    const attack = attackArmy();
    const run = async (variant) => {
      const { A, B, code } = await setupPair(server.base, timing, { cv: [3, 3], seed: 20261119 });
      // A の接続を入り直すたびに足していく（列は、全部の接続に届いたものを順につないだもの）
      const As = [A];
      const a = () => As.at(-1);
      A.send({ type: 'ready', army: attack });
      // 自分の確定が自分の接続に返ってから、setup で入り直す
      await A.waitRoom((r) => r.seats[0].ready === true, 5000, 'A ready');
      As.push(await rejoin(a()));
      B.send({ type: 'ready', army: holdArmy(), reserve: variant });
      await a().waitMsg((m) => m.type === 'reveal', { label: 'reveal' });
      // reveal で入り直す
      As.push(await rejoin(a()));
      await a().waitMsg((m) => m.type === 'reveal', { label: 'reveal after rejoin' });
      await a().waitRoom((r) => r.phase === 'battle', 10_000, 'battle');
      expect(await stepTo(code, 10)).toBe(10);
      await a().waitMsg((m) => m.type === 'snap' && m.tick === 10);
      // 自分に遊軍はいないので、呼ぶと no_reserve（相手の遊軍の有無で変わらない）。返事が届いてから進める
      a().send({ type: 'reserve', battleNo: 1, from: 'left' });
      await a().waitMsg((m) => m.type === 'error', { label: 'reserve error' });
      // 2刻みずつ進め、そのたびに A に snap が届くのを待つ。刻み 60 で battle の途中に入り直す
      let rejoined = false;
      for (;;) {
        const t = await stepTicks(server.base, code, 2);
        await a().waitMsg((m) => (m.type === 'snap' && m.tick === t) || m.type === 'result', { label: `snap ${t}` });
        if (a().of('result').length > 0) break;
        if (t >= 60 && !rejoined) {
          rejoined = true;
          As.push(await rejoin(a()));
          await a().waitMsg((m) => m.type === 'snap', { label: 'snap after rejoin' });
        }
      }
      await B.waitMsg((m) => m.type === 'result');
      // 結果の画面に入り直す
      As.push(await rejoin(a()));
      await a().waitMsg((m) => m.type === 'result');
      const B2 = await rejoin(B);
      await B2.waitMsg((m) => m.type === 'result');
      const out = {
        a: As.flatMap((c) => c.messages).map(norm),
        b: B.last('result'),
        b2: B2.last('result'),
        bSnaps: B.of('snap'),
      };
      for (const c of [...As, B, B2]) c.close();
      return out;
    };
    const runs = await Promise.all([run(null), run(CAV), run(ARCH)]);
    const [r0, r1, r2] = runs;
    // 列そのもの（数・順・中身。setup・reveal・battle・result で入り直したときのもの、遊軍のエラーも含む）が一致する
    expect(r0.a.filter((m) => m.type === 'snap').length).toBeGreaterThan(10);
    expect(r0.a.filter((m) => m.type === 'reveal')).toHaveLength(2);
    expect(r0.a.filter((m) => m.type === 'error')).toEqual([expect.objectContaining({ reason: 'invalid_reserve', op: 'reserve', code: 'no_reserve' })]);
    expect(r1.a).toEqual(r0.a);
    expect(r2.a).toEqual(r0.a);
    // 自分（A）に遊軍はいないので、遊軍の値はいつも null。rules.reserve は2人そろってから true
    for (const m of r0.a) {
      if (m.type === 'room') {
        expect(m.rules.reserve).toBe(m.phase !== 'waiting');
        expect(m.myReserve).toBeNull();
      }
      if (m.type === 'reveal') expect(m.myReserve).toBeNull();
      if (m.type === 'snap') expect(m.reserve).toBeNull();
    }
    // 対照：遊軍を持つ B 本人には、自分の遊軍の様子が届く（開戦 5 秒までは waiting、そのあと ready）
    expect(r0.bSnaps.every((m) => m.reserve === null)).toBe(true);
    expect(r1.bSnaps.find((m) => m.tick === 10).reserve).toEqual({ ...CAV, state: 'waiting' });
    expect(r1.bSnaps.find((m) => m.tick === 50).reserve).toEqual({ ...CAV, state: 'ready' });
    expect(r2.bSnaps.find((m) => m.tick === 50).reserve).toEqual({ ...ARCH, state: 'ready' });
    // 兵が減る戦い：相手（B）の判定の割合は 1 より小さく、A に届く星の割合はそれと同じ値（決着のときも、入り直したときも）
    const aResults = r0.a.filter((m) => m.type === 'result');
    expect(aResults).toHaveLength(2);
    expect(aResults[1]).toEqual(aResults[0]);
    const sum = aResults[0].summary;
    expect(sum.remaining[1]).toBeLessThan(1);
    expect(sum.remainingForStars[1]).toBe(sum.remaining[1]);
    expect(sum.unusedReserve).toEqual([null, null]);
    // 対照：遊軍を持つ B 本人には、呼ばなかった遊軍を無傷として数えた割合が届く（決着のときも、入り直したときも）
    for (const r of [r1, r2]) {
      expect(r.b.summary.remainingForStars[1]).toBeGreaterThan(r.b.summary.remaining[1]);
      expect(r.b.summary.unusedReserve[1]).not.toBeNull();
      expect(norm(r.b2)).toEqual(norm(r.b));
    }
    expect(r0.b.summary.remainingForStars[1]).toBe(r0.b.summary.remaining[1]);
  });
});

describe('配置の検査・組で扱う・もう一戦（R14 c・d・e）', () => {
  it('遊軍を含めて予算と部隊数を数え、最後に検査を通った組が使われ、もう一戦で組が消える', async () => {
    const timing = { tickMs: 10, revealMs: 300, maxTicks: 200, setupMs: 4000 };
    let { A, B } = await setupPair(server.base, timing, { cv: [3, 3] });
    const errOf = async (c, msg) => {
      const from = c.messages.length;
      c.send(msg);
      return c.waitMsg((m) => m.type === 'error', { from, label: 'army error' });
    };
    // 騎兵の遊軍と合わせて予算ちょうどになる配置（本陣・盾兵・騎兵2。予算 24 なら盾兵4 で値段 20）
    const C = PVP_RULES.costs;
    const nShield = (PVP_RULES.budget - C.cavalry * 3) / C.shield;
    expect(Number.isInteger(nShield) && nShield > 0 && nShield <= ZONE.width).toBe(true);
    const armyFull = army([
      ['hq', MID, BACK, 'hold'],
      ...Array.from({ length: nShield }, (_, i) => ['shield', zc(i + 2), FRONT + 1, 'hold']),
      ['cavalry', zc(0), FRONT + 2, 'advance'],
      ['cavalry', zc(ZONE.width - 1), FRONT + 2, 'advance'],
    ]);
    // 予算を遊軍で超える：予算ちょうど − 騎兵の遊軍 + 歩兵 + 騎兵の遊軍
    const armyOver = [...armyFull, { kind: 'infantry', col: MID, row: FRONT + 2, stance: 'advance' }];
    let e = await errOf(B, { type: 'ready', army: armyOver, reserve: { kind: 'cavalry', stance: 'advance' } });
    expect(e.reason).toBe('invalid_army');
    expect(e.armyErrors.map((x) => x.code)).toEqual(['over_budget']);
    // 戦場に本陣と歩兵（部隊数の上限ちょうど）+ 遊軍で、上限を 1 超える
    const armyMany = army([['hq', MID, BACK, 'hold'], ...Array.from({ length: PVP_RULES.maxUnits }, (_, i) => ['infantry', zc(i % ZONE.width), FRONT + Math.floor(i / ZONE.width), 'advance'])]);
    e = await errOf(B, { type: 'ready', army: armyMany, reserve: { kind: 'infantry', stance: 'advance' } });
    expect(e.armyErrors.map((x) => x.code)).toEqual(['too_many_units']);
    // 本陣を遊軍に・知らない方針（どちらも index なし）
    e = await errOf(B, { type: 'ready', army: holdArmy(), reserve: { kind: 'hq', stance: 'hold' } });
    expect(e.armyErrors).toEqual([expect.objectContaining({ code: 'invalid_kind' })]);
    expect(e.armyErrors[0].index).toBeUndefined();
    e = await errOf(B, { type: 'ready', army: holdArmy(), reserve: { kind: 'cavalry', stance: 'charge' } });
    expect(e.armyErrors).toEqual([expect.objectContaining({ code: 'invalid_stance' })]);
    // 形の違う遊軍（知らない鍵）は、メッセージごと黙って捨てる。番兵（返事のある、正しくない組の確定）の返事までに、
    // ほかの知らせ（エラーや、確定したことを知らせる room）が来ない
    const fromB = B.messages.length;
    B.send({ type: 'ready', army: holdArmy(), reserve: { kind: 'cavalry', stance: 'hold', extra: 1 } });
    B.send({ type: 'ready', army: holdArmy(), reserve: 'cavalry' });
    const sentinel = await errOf(B, { type: 'ready', army: holdArmy(), reserve: { kind: 'hq', stance: 'hold' } });
    expect(sentinel.armyErrors).toEqual([expect.objectContaining({ code: 'invalid_kind' })]);
    expect(B.messages.slice(fromB, B.messages.indexOf(sentinel))).toEqual([]);
    // 予算ちょうど（配置 + 騎兵の遊軍 = 予算）は通る
    B.send({ type: 'ready', army: armyFull, reserve: { kind: 'cavalry', stance: 'advance' } });
    await A.waitRoom((r) => r.seats[1].ready === true, 5000, 'B ready');

    // A：正しい組のあとに、正しくない下書き（配置が不正・遊軍が不正）を送り、時間切れを待つ
    const good = { army: holdArmy(), reserve: { kind: 'cavalry', stance: 'flank' } };
    A.send({ type: 'draft', ...good });
    const twoHq = [...holdArmy(), { kind: 'hq', col: zc(0), row: BACK, stance: 'hold' }];
    A.send({ type: 'draft', army: twoHq, reserve: { kind: 'archer', stance: 'hold' } });
    A.send({ type: 'draft', army: holdArmy().slice(0, 5), reserve: { kind: 'hq', stance: 'hold' } });
    // 番兵：正しくない組での確定（エラーが返る。最後に検査を通った組は変えない）。返事が届けば、前の3通の下書きは処理済み
    const fromA0 = A.messages.length;
    const aSentinel = await errOf(A, { type: 'ready', army: twoHq });
    expect(aSentinel.armyErrors.some((x) => x.code === 'hq_count')).toBe(true);
    expect(A.messages.slice(fromA0, A.messages.indexOf(aSentinel))).toEqual([]);
    // 入り直すと、最後に検査を通った組（配置と遊軍）が返る
    A = await rejoin(A);
    expect(A.room.myArmy).toEqual(good.army);
    expect(A.room.myReserve).toEqual(good.reserve);
    // B の room には、A の遊軍は出てこない
    expect(B.room.myReserve).toEqual({ kind: 'cavalry', stance: 'advance' });

    const [revA, revB] = await Promise.all([A.waitMsg((m) => m.type === 'reveal', { ms: 10_000 }), B.waitMsg((m) => m.type === 'reveal', { ms: 10_000 })]);
    expect(revA.armies[0]).toEqual(good.army);
    expect(revA.myReserve).toEqual(good.reserve);
    expect(revB.myReserve).toEqual({ kind: 'cavalry', stance: 'advance' });
    const ra = await A.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    const rb = await B.waitMsg((m) => m.type === 'result', { ms: 20_000 });
    // 呼ばなかった遊軍は、本人の振り返りにだけ出る
    expect(ra.summary.unusedReserve).toEqual([{ kind: 'cavalry', men: expect.any(Number) }, null]);
    expect(rb.summary.unusedReserve).toEqual([null, { kind: 'cavalry', men: expect.any(Number) }]);
    expect(rb.summary.remainingForStars[0]).toBe(rb.summary.remaining[0]);
    expect(ra.summary.remainingForStars[1]).toBe(ra.summary.remaining[1]);
    expect(ra.summary.units).toEqual(rb.summary.units);

    // もう一戦：下書きの組が消え、時間切れなら既定の編成で遊軍なし
    await A.waitRoom((r) => r.phase === 'result');
    A.send({ type: 'rematch', battleNo: ra.battleNo });
    B.send({ type: 'rematch', battleNo: ra.battleNo });
    await Promise.all([A.waitRoom((r) => r.phase === 'setup'), B.waitRoom((r) => r.phase === 'setup')]);
    expect(A.room.myArmy).toBeNull();
    expect(A.room.myReserve).toBeNull();
    expect(B.room.myReserve).toBeNull();
    const fromA = A.messages.length;
    const rev2 = await A.waitMsg((m) => m.type === 'reveal', { from: fromA, ms: 10_000 });
    expect(rev2.myReserve).toBeNull();
    const snap2 = await A.waitMsg((m) => m.type === 'snap' && m.battleNo === rev2.battleNo, { from: fromA });
    expect(snap2.reserve).toBeNull();
    const snapB2 = await B.waitMsg((m) => m.type === 'snap' && m.battleNo === rev2.battleNo);
    expect(snapB2.reserve).toBeNull();
    A.close();
    B.close();
  });
});

describe('古い画面の入り直し（R14 g。design §13.6 で古い版は入れなくなった）', () => {
  // 版 3 より前の画面は、席を探す前に outdated で断られる。そのため「片方が古い画面で rules.reserve が false になる部屋」は
  // もう作れない（reserve_disabled の仕組みは server に残るが、通しのテストでは届かない）。
  // ここでは、席にいる人が古い画面（cv なし・版 2）を装って入り直そうとしても、いまの接続・相手の確定・遊軍が崩れないことを確かめる
  it('両者 cv=3 で始めたあと、同じ人が cv なし・cv=2 で入り直そうとしても断られ、いまの接続と席の cv は残る（setup 中・戦闘中）。相手の確定と遊軍は残り、呼べる', async () => {
    const timing = { tickMs: 100, revealMs: 300, maxTicks: 300, setupMs: 30_000, testManualTicks: 1 };
    const { A, B, code } = await setupPair(server.base, timing, { cv: [3, 3] });
    /** 古い画面を装って入り直す。outdated が届いて閉じられ、room は届かない */
    const tryOld = async (cv) => {
      const old = new Client(server.base, code, { pid: B.pid, name: B.name, cv });
      await old.connect();
      expect(await old.waitMsg((m) => m.type === 'error')).toMatchObject({ reason: 'outdated' });
      const closed = await old.waitClosed();
      if (closed.code !== null) expect(closed.code).toBe(1008);
      expect(old.of('room')).toEqual([]);
      old.close();
    };
    // B：下書き（遊軍つき）→ 確定 → 取り消し。どれも自分の接続に返る room で、処理済みを確かめる（下書きだけでは room が来ない）
    B.send({ type: 'draft', army: holdArmy(), reserve: ARCH });
    B.send({ type: 'ready' });
    await B.waitRoom((r) => r.seats[1].ready === true, 5000, 'B ready');
    B.send({ type: 'unready' });
    await B.waitRoom((r) => r.seats[1].ready === false, 5000, 'B unready');
    expect(B.room.myReserve).toEqual(ARCH);
    A.send({ type: 'ready', army: holdArmy(), reserve: CAV });
    await A.waitRoom((r) => r.seats[0].ready === true, 5000, 'A ready');
    const fromA0 = A.messages.length;
    const fromB0 = B.messages.length;
    // --- setup 中に、B が古い画面を装って入り直そうとする
    await tryOld(undefined);
    await tryOld(2);
    // いまの B の接続は 4001 で閉じられず、そのまま使える。入り直しの試みで、A にも B にも何も届いていない
    expect(B.closed).toBeNull();
    B.send({ type: 'ready' });
    const [revA, revB] = await Promise.all([A.waitMsg((m) => m.type === 'reveal'), B.waitMsg((m) => m.type === 'reveal')]);
    const sinceA = A.messages.slice(fromA0, A.messages.indexOf(revA) + 1);
    expect(sinceA.map((m) => m.type)).toEqual(['room', 'reveal']);
    expect(sinceA[0]).toMatchObject({ phase: 'reveal', rules: { reserve: true }, myReserve: CAV });
    expect(B.messages.slice(fromB0, B.messages.indexOf(revB) + 1).every((m) => m.type === 'room' || m.type === 'reveal')).toBe(true);
    expect(revA.myReserve).toEqual(CAV);
    expect(revB.myReserve).toEqual(ARCH);
    await A.waitRoom((r) => r.phase === 'battle', 5000, 'battle');
    const battleNo = A.room.battleNo;
    expect(await stepTo(code, 60)).toBe(60);
    await A.waitMsg((m) => m.type === 'snap' && m.tick === 60);
    // --- 戦闘中にも、古い画面を装って入り直そうとする
    const fromA = A.messages.length;
    await tryOld(undefined);
    expect(B.closed).toBeNull();
    expect(B.room.rules.reserve).toBe(true);
    A.send({ type: 'reserve', battleNo, from: 'right' });
    expect(await stepTicks(server.base, code, 2)).toBe(62);
    const s = await A.waitMsg((m) => m.type === 'snap' && m.tick === 62, { from: fromA });
    expect(A.messages.slice(fromA, A.messages.indexOf(s)).every((m) => m.type === 'snap')).toBe(true);
    expect(s.events.find((e) => e.type === 'reserve')).toMatchObject({ side: 0, from: 'right' });
    expect(s.reserve).toEqual({ ...CAV, state: 'used' });
    const sb = await B.waitMsg((m) => m.type === 'snap' && m.tick === 62);
    expect(sb.units.map(unpack).some((u) => u.side === 0 && u.kind === 'cavalry')).toBe(true);
    A.close();
    B.close();
  });
});
