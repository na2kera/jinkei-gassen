// 遊軍（design §7.7、§7.9 の R14）：隠す情報、現れたあとの場面、もう一戦、配置の検査、組で扱うこと、
// 現れた直後の作り直し、cv（古い画面の混じる部屋）、遊軍のエラーの op と、渡す前の入力は陣営ごとに1つまで、同じ刻みの遊軍と号令。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, army, collectEvents, holdArmy, loneArcherArmy, setupPair, sleep, startServer, testRoute, unpack } from './helpers.mjs';

let server;
beforeAll(async () => {
  server = await startServer({ port: 8806 });
});
afterAll(async () => {
  await server?.stop();
});

/**
 * 同じ pid でつなぎ直す（前の接続は server が 4001 で閉じる）。最初の room が届くまで待つ。
 * opts.cv を渡すとその版で（undefined なら cv を付けない古い画面として）、渡さなければ前と同じ版でつなぐ
 */
async function rejoin(c, opts = {}) {
  const cv = 'cv' in opts ? opts.cv : c.cv;
  const again = new Client(server.base, c.code, { pid: c.pid, name: c.name, cv });
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

describe('隠す情報（R14 a）', () => {
  it('相手の遊軍だけを「なし／騎兵・前進／弓兵・守備」に変えた3つの対戦で、自分に届くメッセージが（入り直しを含めて）一致する', async () => {
    // 守備どうしは、だれも攻めず動かないので、開戦から 10 秒（刻み 99）で膠着の引き分けになる。呼ばなかった遊軍は膠着の時計を止めない
    const timing = { tickMs: 20, revealMs: 1500, maxTicks: 1800, setupMs: 30_000 };
    const run = async (variant) => {
      const { A, B } = await setupPair(server.base, timing, { cv: [2, 2] });
      expect(A.room.rules.reserve).toBe(true);
      const As = [A];
      A.send({ type: 'draft', army: holdArmy() });
      B.send({ type: 'draft', army: holdArmy(), reserve: variant });
      await sleep(300);
      // setup で入り直す
      As.push(await rejoin(As.at(-1)));
      As.at(-1).send({ type: 'ready' });
      await B.waitRoom((r) => r.seats[0].ready === true, 5000, 'A ready');
      // B は下書きの組（配置と遊軍）のまま確定する
      B.send({ type: 'ready' });
      await As.at(-1).waitMsg((m) => m.type === 'reveal', { label: 'reveal' });
      // reveal で入り直す
      As.push(await rejoin(As.at(-1)));
      await As.at(-1).waitMsg((m) => m.type === 'reveal', { label: 'reveal after rejoin' });
      await As.at(-1).waitMsg((m) => m.type === 'snap', { ms: 10_000, label: 'first snap' });
      // 自分には遊軍がいないので、呼ぶと no_reserve（相手の遊軍の有無で変わらない）
      As.at(-1).send({ type: 'reserve', battleNo: 1, from: 'left' });
      await As.at(-1).waitMsg((m) => m.type === 'error', { label: 'reserve error' });
      // battle で入り直す
      await As.at(-1).waitMsg((m) => m.type === 'snap' && m.tick >= 60, { label: 'tick 60' });
      As.push(await rejoin(As.at(-1)));
      await As.at(-1).waitMsg((m) => m.type === 'snap', { label: 'snap after rejoin' });
      await As.at(-1).waitMsg((m) => m.type === 'result', { ms: 20_000, label: 'result' });
      await B.waitMsg((m) => m.type === 'result', { ms: 20_000, label: 'B result' });
      // result で入り直す
      As.push(await rejoin(As.at(-1)));
      await As.at(-1).waitMsg((m) => m.type === 'result', { label: 'result after rejoin' });
      return { As, B };
    };
    const runs = await Promise.all([run(null), run(CAV), run(ARCH)]);
    for (const r of runs) {
      r.As.forEach((c) => c.close());
      r.B.close();
    }

    const summaryOf = ({ As }) => {
      const all = As.flatMap((c) => c.messages);
      const others = all.filter((m) => m.type !== 'snap').map(norm);
      const snaps = new Map();
      for (const s of all.filter((m) => m.type === 'snap')) {
        const n = norm(s);
        delete n.events;
        delete n.evBase;
        snaps.set(s.tick, JSON.stringify(n));
      }
      const ev = collectEvents(As);
      return { others, snaps, events: [...ev.byIndex.entries()].sort((a, b) => a[0] - b[0]), raw: As.flatMap((c) => c.raw) };
    };
    const [s0, s1, s2] = runs.map(summaryOf);
    // snap 以外（room・reveal・error・result。入り直したときのものも）は、並びも中身も一致する
    expect(s0.others.map((m) => m.type)).toContain('reveal');
    expect(s0.others.filter((m) => m.type === 'result')).toHaveLength(2);
    expect(s0.others.filter((m) => m.type === 'error')).toEqual([expect.objectContaining({ reason: 'invalid_reserve', op: 'reserve', code: 'no_reserve' })]);
    expect(s1.others).toEqual(s0.others);
    expect(s2.others).toEqual(s0.others);
    // snap は、3つに共通する刻みで一致する（どの刻みに snap が届くかは実時間しだい）
    const common = [...s0.snaps.keys()].filter((t) => s1.snaps.has(t) && s2.snaps.has(t));
    expect(common.length).toBeGreaterThan(5);
    for (const t of common) {
      expect(s1.snaps.get(t)).toBe(s0.snaps.get(t));
      expect(s2.snaps.get(t)).toBe(s0.snaps.get(t));
    }
    // 出来事も、通し番号ごとに一致する
    expect(s1.events).toEqual(s0.events);
    expect(s2.events).toEqual(s0.events);
    // 自分に遊軍はいないので、遊軍の値はいつも null
    for (const s of [s0, s1, s2]) {
      for (const m of s.others) {
        if (m.type === 'room') {
          // 相手を待っている間（席が1つ）は false、2人そろえば true
          expect(m.rules.reserve).toBe(m.phase !== 'waiting');
          expect(m.myReserve).toBeNull();
        }
        if (m.type === 'reveal') expect(m.myReserve).toBeNull();
        if (m.type === 'result') {
          expect(m.summary.unusedReserve).toEqual([null, null]);
          expect(m.summary.remainingForStars).toEqual(m.summary.remaining);
          expect(m.winner).toBe('draw');
          expect(m.reason).toBe('stalemate');
        }
      }
      for (const v of s.snaps.values()) expect(JSON.parse(v).reserve).toBeNull();
      // 届いた文字列に、騎兵（相手の遊軍の兵種で、どちらの戦場にもいない）が値として出てこない
      // （rules.costs の鍵 "cavalry": は除くため、値の形 "cavalry", で探す。部隊の詰めた配列・遊軍の値はこの形になる）
      for (const raw of s.raw) expect(raw).not.toContain('"cavalry",');
    }
    // 対照：遊軍を持つ側には、自分の遊軍が届いている（検査が空振りしていない）
    const bReveal = (i) => runs[i].B.of('reveal')[0];
    expect(bReveal(0).myReserve).toBeNull();
    expect(bReveal(1).myReserve).toEqual(CAV);
    expect(bReveal(2).myReserve).toEqual(ARCH);
    expect(runs[1].B.raw.some((r) => r.includes('"cavalry",'))).toBe(true);
    const bSnap = runs[1].B.of('snap').find((m) => m.tick >= 50);
    expect(bSnap.reserve).toEqual({ ...CAV, state: 'ready' });
    expect(runs[1].B.of('snap').find((m) => m.tick < 50).reserve).toEqual({ ...CAV, state: 'waiting' });
    const bResult = runs[1].B.last('result');
    expect(bResult.summary.unusedReserve).toEqual([null, { kind: 'cavalry', men: expect.any(Number) }]);
    expect(bResult.summary.remainingForStars[1]).toBe(1);
    expect(runs[2].B.last('result').summary.unusedReserve[1]).toMatchObject({ kind: 'archer' });
  });
});

describe('遊軍を呼ぶ（R14 b・f・h、同じ刻みの遊軍と号令）', () => {
  it('現れた遊軍は両者の snap に出る。現れた直後に作り直しても消えず、二度は呼べない。渡す前の入力は1つまで', async () => {
    // A（陣営0）は本陣と弓兵1（どちらも中央の翼。左翼と右翼はだれもいない）、遊軍は騎兵・守備。
    // B（陣営1）は盾兵11の壁（守備）、遊軍は歩兵・守備。弓兵が撃ち続けるので膠着にならず、時間切れまで続く
    const timing = { tickMs: 100, revealMs: 300, maxTicks: 260, setupMs: 30_000, watchdogMs: 1000 };
    let { A, B, code } = await setupPair(server.base, timing, { cv: [2, 2] });
    const wall = army([['hq', 5, 15, 'hold'], ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => ['shield', c, 10, 'hold'])]);
    const aReserve = { kind: 'cavalry', stance: 'hold' };
    const bReserve = { kind: 'infantry', stance: 'hold' };
    A.send({ type: 'ready', army: loneArcherArmy(), reserve: aReserve });
    B.send({ type: 'ready', army: wall, reserve: bReserve });
    const revA = await A.waitMsg((m) => m.type === 'reveal');
    expect(revA.myReserve).toEqual(aReserve);
    expect((await B.waitMsg((m) => m.type === 'reveal')).myReserve).toEqual(bReserve);
    const first = await A.waitMsg((m) => m.type === 'snap');
    expect(first.reserve).toEqual({ ...aReserve, state: 'waiting' });
    const battleNo = A.room.battleNo;
    const nUnits = first.units.length;
    expect(nUnits).toBe(loneArcherArmy().length + wall.length);

    // 開戦 5 秒まで（刻み 50 より前）は呼べない。エラーは本人にだけ、op: 'reserve' 付きで返る
    expect(first.tick).toBeLessThan(40);
    B.send({ type: 'reserve', battleNo, from: 'left' });
    const early = await B.waitMsg((m) => m.type === 'error');
    expect(early).toMatchObject({ type: 'error', reason: 'invalid_reserve', op: 'reserve', code: 'reserve_not_ready' });
    // battleNo が違う・形が違うメッセージは黙って捨てる
    B.send({ type: 'reserve', battleNo: battleNo + 1, from: 'left' });
    B.send({ type: 'reserve', battleNo, from: 'up' });
    await sleep(300);
    expect(B.of('error')).toHaveLength(1);
    expect(A.of('error')).toHaveLength(0);

    // --- B が左から呼ぶ（号令は出さない）。定期の保存（20刻みごと）から離れた刻みで呼ぶ
    const go = await B.waitMsg((m) => m.type === 'snap' && m.tick >= 52 && m.tick % 20 >= 2 && m.tick % 20 <= 8, { label: 'tick to summon' });
    expect(go.reserve.state).toBe('ready');
    const fromA = A.messages.length;
    B.send({ type: 'reserve', battleNo, from: 'left' });
    const isReserveEv = (side) => (m) => m.type === 'snap' && m.events.some((e) => e.type === 'reserve' && e.side === side);
    const sb = await B.waitMsg(isReserveEv(1), { label: 'B reserve event' });
    const sa = await A.waitMsg(isReserveEv(1), { from: fromA, label: 'B reserve event at A' });
    const ev = sb.events.find((e) => e.type === 'reserve');
    expect(ev).toMatchObject({ side: 1, unit: nUnits, from: 'left' });
    expect(sa.events.find((e) => e.type === 'reserve')).toEqual(ev);
    expect(sb.reserve).toEqual({ ...bReserve, state: 'used' });
    // 現れた部隊は、ふつうの部隊として両者の units に入る。B から見て左（自分が下の座標で列 0・行 8）、A から見て右上（列 11・行 7）
    const unitB = sb.units.map(unpack).find((u) => u.id === nUnits);
    expect(unitB).toMatchObject({ side: 1, kind: 'infantry', wing: 'left', stance: 'hold' });
    expect(Math.abs(unitB.x - 0.5)).toBeLessThan(0.6);
    expect(Math.abs(unitB.y - 8.5)).toBeLessThan(0.6);
    const unitA = sa.units.map(unpack).find((u) => u.id === nUnits);
    expect(unitA).toMatchObject({ side: 1, kind: 'infantry', wing: 'left', stance: null });
    expect(Math.abs(unitA.x - 11.5)).toBeLessThan(0.6);
    expect(Math.abs(unitA.y - 7.5)).toBeLessThan(0.6);
    // 現れた刻みは、すぐ保存している（定期の保存の刻みより後で、次の定期の保存より前）
    const st = await testRoute(server.base, code, 'state');
    const lastPeriodic = Math.floor(ev.tick / 20) * 20;
    expect(st.savedTick).toBeGreaterThan(lastPeriodic);
    expect(st.savedTick).toBeLessThan(lastPeriodic + 20);

    // --- 作り直す。戻っても遊軍は現れたまま、もう一度は呼べない
    await testRoute(server.base, code, 'abort');
    const abortedAt = Date.now();
    await sleep(300);
    A = await rejoin(A);
    B = await rejoin(B);
    const back = await B.waitMsg((m) => m.type === 'snap' && m.receivedAt > abortedAt, { ms: 10_000, label: 'snap after abort' });
    expect(back.tick).toBeGreaterThanOrEqual(ev.tick);
    expect(back.reserve).toEqual({ ...bReserve, state: 'used' });
    expect(back.units.map(unpack).some((u) => u.id === nUnits && u.kind === 'infantry' && u.side === 1)).toBe(true);
    B.send({ type: 'reserve', battleNo, from: 'right' });
    expect(await B.waitMsg((m) => m.type === 'error')).toMatchObject({ reason: 'invalid_reserve', op: 'reserve', code: 'no_reserve' });

    // --- A：同じ刻みに遊軍（左から）と号令。2つ目の遊軍の入力は断られ、だれもいない左翼への号令は、遊軍が現れる前に調べるので断られる
    await A.waitMsg((m) => m.type === 'snap' && m.reserve?.state === 'ready', { label: 'A ready' });
    const fromA2 = A.messages.length;
    A.send({ type: 'reserve', battleNo, from: 'left' });
    A.send({ type: 'reserve', battleNo, from: 'right' });
    A.send({ type: 'order', battleNo, target: 'left', kind: 'brace' });
    A.send({ type: 'order', battleNo, target: 'all', kind: 'brace' });
    const withA = await A.waitMsg(isReserveEv(0), { from: fromA2, label: 'A reserve event' });
    await sleep(400);
    const errs = A.messages.slice(fromA2).filter((m) => m.type === 'error');
    expect(errs).toHaveLength(2);
    expect(errs).toContainEqual(expect.objectContaining({ reason: 'invalid_reserve', op: 'reserve', code: 'no_reserve' }));
    // 号令のエラーには op を付けない
    const orderErr = errs.find((e) => e.reason === 'invalid_order');
    expect(orderErr).toBeDefined();
    expect(orderErr.op).toBeUndefined();
    const evs = A.messages.slice(fromA2).filter((m) => m.type === 'snap').flatMap((m) => m.events);
    const rEv = evs.find((e) => e.type === 'reserve' && e.side === 0);
    const oEvs = evs.filter((e) => e.type === 'order' && e.side === 0);
    expect(rEv).toMatchObject({ unit: nUnits + 1, from: 'left' });
    expect(oEvs.map((e) => e.target)).toEqual(['all']);
    expect(oEvs[0].tick).toBe(rEv.tick);
    // 現れたばかりの遊軍にも、同じ刻みの全軍あての号令がかかる
    const cav = withA.units.map(unpack).find((u) => u.id === nUnits + 1);
    expect(cav).toMatchObject({ side: 0, kind: 'cavalry', wing: 'left', order: 'brace', stance: 'hold' });
    expect(withA.ordersLeft[0]).toBe(2);

    const [ra, rb] = await Promise.all([A.waitMsg((m) => m.type === 'result', { ms: 40_000 }), B.waitMsg((m) => m.type === 'result', { ms: 40_000 })]);
    // 呼んだ遊軍は振り返りの部隊に入り、呼ばなかった遊軍はない
    for (const r of [ra, rb]) {
      expect(r.summary.unusedReserve).toEqual([null, null]);
      expect(r.summary.units.some((u) => u.id === nUnits && u.kind === 'infantry')).toBe(true);
      expect(r.summary.units.some((u) => u.id === nUnits + 1 && u.kind === 'cavalry')).toBe(true);
    }
    // 結果の段階の遊軍の入力は黙って捨てる
    const nErr = A.of('error').length;
    A.send({ type: 'reserve', battleNo, from: 'left' });
    await sleep(200);
    expect(A.of('error').length).toBe(nErr);
    A.close();
    B.close();
  });
});

describe('配置の検査・組で扱う・もう一戦（R14 c・d・e）', () => {
  it('遊軍を含めて予算と部隊数を数え、最後に検査を通った組が使われ、もう一戦で組が消える', async () => {
    const timing = { tickMs: 10, revealMs: 300, maxTicks: 200, setupMs: 4000 };
    let { A, B } = await setupPair(server.base, timing, { cv: [2, 2] });
    const errOf = async (c, msg) => {
      const from = c.messages.length;
      c.send(msg);
      return c.waitMsg((m) => m.type === 'error', { from, label: 'army error' });
    };
    // 値段 32 の配置（本陣・盾兵8・騎兵2）
    const army32 = army([
      ['hq', 5, 15, 'hold'],
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((c) => ['shield', c, 11, 'hold']),
      ['cavalry', 0, 12, 'advance'],
      ['cavalry', 11, 12, 'advance'],
    ]);
    // 予算を遊軍で超える：32 + 2 (歩兵) + 4（騎兵の遊軍）= 38
    const army34 = [...army32, { kind: 'infantry', col: 5, row: 13, stance: 'advance' }];
    let e = await errOf(B, { type: 'ready', army: army34, reserve: { kind: 'cavalry', stance: 'advance' } });
    expect(e.reason).toBe('invalid_army');
    expect(e.armyErrors.map((x) => x.code)).toEqual(['over_budget']);
    // 戦場 16 部隊（本陣と歩兵15）+ 遊軍
    const army16 = army([['hq', 5, 15, 'hold'], ...Array.from({ length: 15 }, (_, i) => ['infantry', i % 12, 10 + Math.floor(i / 12), 'advance'])]);
    e = await errOf(B, { type: 'ready', army: army16, reserve: { kind: 'infantry', stance: 'advance' } });
    expect(e.armyErrors.map((x) => x.code)).toEqual(['too_many_units']);
    // 本陣を遊軍に・知らない方針（どちらも index なし）
    e = await errOf(B, { type: 'ready', army: holdArmy(), reserve: { kind: 'hq', stance: 'hold' } });
    expect(e.armyErrors).toEqual([expect.objectContaining({ code: 'invalid_kind' })]);
    expect(e.armyErrors[0].index).toBeUndefined();
    e = await errOf(B, { type: 'ready', army: holdArmy(), reserve: { kind: 'cavalry', stance: 'charge' } });
    expect(e.armyErrors).toEqual([expect.objectContaining({ code: 'invalid_stance' })]);
    // 形の違う遊軍（知らない鍵）は、メッセージごと黙って捨てる
    const nErr = B.of('error').length;
    B.send({ type: 'ready', army: holdArmy(), reserve: { kind: 'cavalry', stance: 'hold', extra: 1 } });
    B.send({ type: 'ready', army: holdArmy(), reserve: 'cavalry' });
    await sleep(200);
    expect(B.of('error').length).toBe(nErr);
    expect(A.room.seats[1].ready).toBe(false);
    // 予算ちょうど（32 + 騎兵の遊軍 4 = 36）は通る
    B.send({ type: 'ready', army: army32, reserve: { kind: 'cavalry', stance: 'advance' } });
    await A.waitRoom((r) => r.seats[1].ready === true, 5000, 'B ready');

    // A：正しい組のあとに、正しくない下書き（配置が不正・遊軍が不正）を送り、時間切れを待つ
    const good = { army: holdArmy(), reserve: { kind: 'cavalry', stance: 'flank' } };
    A.send({ type: 'draft', ...good });
    await sleep(100);
    const twoHq = [...holdArmy(), { kind: 'hq', col: 0, row: 15, stance: 'hold' }];
    A.send({ type: 'draft', army: twoHq, reserve: { kind: 'archer', stance: 'hold' } });
    await sleep(100);
    A.send({ type: 'draft', army: holdArmy().slice(0, 5), reserve: { kind: 'hq', stance: 'hold' } });
    await sleep(100);
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

describe('古い画面の混じる部屋（R14 g）', () => {
  it('片方が cv なしなら rules.reserve は false で、遊軍つきの draft・ready と reserve は reserve_disabled で断られる', async () => {
    const timing = { tickMs: 20, revealMs: 300, maxTicks: 200, setupMs: 30_000 };
    const { A, B } = await setupPair(server.base, timing, { cv: [2, undefined] });
    expect(A.room.rules.reserve).toBe(false);
    expect(B.room.rules.reserve).toBe(false);
    A.send({ type: 'draft', army: holdArmy(), reserve: CAV });
    expect(await A.waitMsg((m) => m.type === 'error')).toMatchObject({ reason: 'reserve_disabled' });
    const from = A.messages.length;
    A.send({ type: 'ready', army: holdArmy(), reserve: CAV });
    expect(await A.waitMsg((m) => m.type === 'error', { from })).toMatchObject({ reason: 'reserve_disabled' });
    await sleep(200);
    expect(B.room.seats[0].ready).toBe(false);
    // 遊軍なし（null）なら通る
    A.send({ type: 'ready', army: holdArmy(), reserve: null });
    B.send({ type: 'ready', army: holdArmy() });
    const rev = await A.waitMsg((m) => m.type === 'reveal');
    expect(rev.myReserve).toBeNull();
    const snap = await A.waitMsg((m) => m.type === 'snap' && m.tick >= 55, { ms: 10_000 });
    expect(snap.reserve).toBeNull();
    const fromE = A.messages.length;
    A.send({ type: 'reserve', battleNo: A.room.battleNo, from: 'left' });
    expect(await A.waitMsg((m) => m.type === 'error', { from: fromE })).toMatchObject({ reason: 'reserve_disabled', op: 'reserve' });
    // 古い画面（B）に届いたものにも、遊軍の値は入っていない
    expect(B.of('room').every((m) => m.rules.reserve === false && m.myReserve === null)).toBe(true);
    A.close();
    B.close();
  });

  it('setup の途中で古い画面で入り直すと、両者の遊軍が外れて room が送り直される。確定はそのまま', async () => {
    const timing = { tickMs: 20, revealMs: 300, maxTicks: 200, setupMs: 30_000 };
    let { A, B } = await setupPair(server.base, timing, { cv: [2, 2] });
    A.send({ type: 'ready', army: holdArmy(), reserve: CAV });
    B.send({ type: 'draft', army: holdArmy(), reserve: ARCH });
    await B.waitRoom((r) => r.seats[0].ready === true, 5000, 'A ready');
    const fromA = A.messages.length;
    // B が古い画面（cv なし）で入り直す
    B = await rejoin(B, { cv: undefined });
    const roomA = await A.waitMsg((m) => m.type === 'room' && m.rules.reserve === false, { from: fromA, label: 'room with reserve off' });
    expect(roomA.myReserve).toBeNull();
    expect(roomA.myArmy).toEqual(holdArmy());
    expect(roomA.seats[0].ready).toBe(true);
    expect(B.room.rules.reserve).toBe(false);
    expect(B.room.myReserve).toBeNull();
    // B が新しい画面で入り直すと、また使えるようになるが、外れた遊軍は戻らない
    B = await rejoin(B, { cv: 2 });
    await A.waitRoom((r) => r.rules.reserve === true, 5000, 'reserve on again');
    expect(A.room.myReserve).toBeNull();
    expect(B.room.myReserve).toBeNull();
    // army を付けない ready は、reserve の値を（形が違っても）見ず、いまの下書きの組で確定する
    B.send({ type: 'ready', reserve: 'not a reserve' });
    const [revA, revB] = await Promise.all([A.waitMsg((m) => m.type === 'reveal'), B.waitMsg((m) => m.type === 'reveal')]);
    expect(revA.myReserve).toBeNull();
    expect(revB.myReserve).toBeNull();
    const snap = await A.waitMsg((m) => m.type === 'snap');
    expect(snap.reserve).toBeNull();
    A.close();
    B.close();
  });

  it('遊軍が外れるとき、相手（古い画面で入り直した人）に届くものは、遊軍があってもなくても同じ', async () => {
    const timing = { tickMs: 20, revealMs: 300, maxTicks: 200, setupMs: 30_000 };
    const run = async (reserve) => {
      let { A, B } = await setupPair(server.base, timing, { cv: [2, 2] });
      A.send({ type: 'ready', army: holdArmy(), reserve });
      await B.waitRoom((r) => r.seats[0].ready === true, 5000, 'A ready');
      const Bs = [B];
      Bs.push(await rejoin(B, { cv: undefined }));
      await A.waitRoom((r) => r.rules.reserve === false, 5000, 'reserve off');
      await sleep(300);
      Bs.push(await rejoin(Bs.at(-1), { cv: 2 }));
      await A.waitRoom((r) => r.rules.reserve === true, 5000, 'reserve on');
      await sleep(300);
      // A の確定はそのまま（遊軍を持っていたかどうかで、相手に見える確定の様子が変わらない）
      expect(A.room.seats[0].ready).toBe(true);
      expect(A.room.myReserve).toBeNull();
      const msgs = Bs.flatMap((c) => c.messages).map(norm);
      A.close();
      Bs.forEach((c) => c.close());
      return msgs;
    };
    const [withReserve, without] = await Promise.all([run(CAV), run(null)]);
    expect(withReserve.some((m) => m.type === 'room' && m.rules.reserve === false)).toBe(true);
    expect(withReserve).toEqual(without);
  });
});
