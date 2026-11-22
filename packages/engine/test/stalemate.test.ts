// 膠着を早く終える決まり（design §3.6.4 の「膠着」、§3.9 の K1〜K10）
import { describe, expect, it } from 'vitest';
import { applyTemplate, createBattle, plainField, STAGES, stageSetupWith, step, summarize, viewFor, type BattleSetup, type BattleState, type Placement, type Side, type Stage, type StageEnemyOrder } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { matchupSetup, runSetup, runState, SEEDS_10, TEMPLATE_IDS } from '../sim/lib.ts';
import { A11_DEFENSE, allHold } from '../sim/scenes.ts';
import { castleSetup } from '../sim/terrain-scenes.ts';
import { runStage, stageTemplateArmy, STAGE_SEEDS } from '../sim/stagelib.ts';
import { STAR3_FOUND } from './fixtures/star3.ts';
import { battle, clone, DIFFICULTY_LATER, p, STAR3_LATER, STAR3_PENDING_CH23 } from './helpers.ts';

/** A11 の守る側の編成（本陣・盾兵4・弓兵4・歩兵6 を横陣に並べ、全部隊を守備）どうし */
function holdVsHold(extra: Partial<BattleSetup> = {}): BattleSetup {
  const f = plainField();
  const army = (side: Side): Placement[] => allHold(applyTemplate('line', A11_DEFENSE, f.zones[side], side));
  return { field: f, armies: [army(0), army(1)], seed: 1, maxTicks: 1800, timeout: 'compare', ...extra };
}

function make(setup: BattleSetup): BattleState {
  const r = createBattle(setup);
  if (!r.ok) throw new Error(`createBattle: ${r.error.message} ${JSON.stringify(r.error.armyErrors ?? [])}`);
  return r.value;
}

/** 決着まで回し、step を呼んだ回数を返す */
function stepsToEnd(s: BattleState): number {
  let n = 0;
  while (!s.outcome) {
    step(s, []);
    n++;
  }
  return n;
}

const byId = (id: string): Stage => {
  const s = STAGES.find((x) => x.id === id);
  if (!s) throw new Error(`面 ${id} がない`);
  return s;
};

describe('膠着（design §3.6.4）', () => {
  it('開戦のときの時計は 0。stalemate が真偽値でなければ作らない。view には時計を載せない', () => {
    expect(make(holdVsHold()).quietTicks).toBe(0);
    expect(make(holdVsHold({ stalemate: true })).quietTicks).toBe(0);
    for (const v of [1, 'false', null]) {
      const r = createBattle({ ...holdVsHold(), stalemate: v as unknown as boolean });
      expect(r.ok, String(v)).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('invalid_setup');
    }
    const s = make(holdVsHold());
    for (let i = 0; i < 30; i++) step(s, []);
    for (const viewer of [0, 1, 'both'] as const) expect(Object.keys(viewFor(s, viewer))).not.toContain('quietTicks');
    stepsToEnd(s);
    expect(viewFor(s, 0).outcome).toEqual({ winner: 'draw', reason: 'stalemate', tick: 99 });
  });

  it('K1 守備どうしは 10 秒で終わる：ちょうど 100 回目の step で、理由は stalemate、outcome.tick は 99。勝ち負けは時間切れと同じ決め方', () => {
    const want: Record<BattleSetup['timeout'], Side | 'draw'> = { compare: 'draw', side0_wins: 0, side0_loses: 1 };
    for (const timeout of ['compare', 'side0_wins', 'side0_loses'] as const) {
      const s = make(holdVsHold({ timeout }));
      expect(stepsToEnd(s), timeout).toBe(100);
      expect(s.outcome, timeout).toEqual({ winner: want[timeout], reason: 'stalemate', tick: 99 });
      expect(summarize(s).reason).toBe('stalemate');
    }
  });

  it('K2 切れる：stalemate: false なら 1800 刻みの時間切れで終わり、quietTicks は null のまま', () => {
    const s = make(holdVsHold({ stalemate: false }));
    expect(s.quietTicks).toBeNull();
    expect(stepsToEnd(s)).toBe(1800);
    expect(s.outcome).toEqual({ winner: 'draw', reason: 'timeout', tick: 1799 });
    expect(s.quietTicks).toBeNull();
  });

  it('K3a 攻撃：守備の弓兵が動かない相手を撃ち続ける戦いは、膠着で終わらない（撃った刻みは時計が 0）', () => {
    // 陣営0の弓兵（守備）の 4 マス先に、陣営1の盾兵（守備）。盾兵は持ち場から動かずに撃たれ続ける
    const s = battle([p('archer', 5, 10, 'hold')], [p('shield', 5, 6, 'hold')]);
    let shotTicks = 0;
    while (!s.outcome) {
      step(s, []);
      if (s.units.some((u) => u.attacking !== null)) {
        shotTicks++;
        expect(s.quietTicks).toBe(0);
      }
    }
    expect(shotTicks).toBeGreaterThan(T.stalemateTicks);
    expect(s.outcome.reason).not.toBe('stalemate');
  });

  it('K3a 攻撃：門を攻め続ける戦いは、膠着で終わらない（門を打った刻みは時計が 0）', () => {
    const s = make(castleSetup('advance', 1));
    const gateId = s.gate!.id;
    let gateTicks = 0;
    while (!s.outcome) {
      step(s, []);
      if (s.units.some((u) => u.attacking === gateId)) {
        gateTicks++;
        expect(s.quietTicks).toBe(0);
      }
    }
    expect(gateTicks).toBeGreaterThan(0);
    expect(s.outcome.reason).not.toBe('stalemate');
  });

  it('K3b 動こうとする部隊：遠くから歩いてくる部隊がいるあいだは終わらない（最初の攻撃まで 10 秒より長い場面）', () => {
    // 陣営0の歩兵（前進）が 13 マス先の、陣営1の歩兵（守備）へ歩いていく
    const s = battle([p('infantry', 5, 15)], [p('infantry', 5, 1, 'hold')]);
    let firstAttack = -1;
    let quietBefore = 0;
    while (!s.outcome) {
      step(s, []);
      if (firstAttack < 0 && s.units.some((u) => u.attacking !== null)) firstAttack = s.tick;
      // 歩いているあいだは、毎刻み時計が 0（動こうとする部隊がいる刻みは、静かな刻みではない）
      if (firstAttack < 0) quietBefore = Math.max(quietBefore, s.quietTicks!);
    }
    expect(firstAttack).toBeGreaterThan(T.stalemateTicks);
    expect(quietBefore).toBe(0);
    expect(s.outcome.reason).not.toBe('stalemate');
  });

  it('K3b 敗走中の部隊が戦場にいる刻みは、時計が 0', () => {
    const s = make(holdVsHold());
    for (let i = 0; i < 50; i++) step(s, []);
    expect(s.quietTicks).toBe(50);
    // 陣営0の歩兵を1部隊、敗走させる（決着の条件は満たさない）
    const u = s.units.find((x) => x.side === 0 && x.kind === 'infantry')!;
    u.status = 'routing';
    u.routTick = s.tick - 1;
    u.morale = 0;
    let routingTicks = 0;
    while (!s.outcome && s.units[u.id]!.status === 'routing') {
      step(s, []);
      routingTicks++;
      expect(s.quietTicks).toBe(0);
    }
    expect(routingTicks).toBeGreaterThan(0);
    // 消えた次の刻みから数え直して終わる
    const start = s.tick;
    stepsToEnd(s);
    expect(s.outcome!.reason).toBe('stalemate');
    expect(s.outcome!.tick).toBe(start + T.stalemateTicks - 1);
  });

  it('K3c 効いている号令：守備どうしで 5 秒に堅守を出すと、号令が切れた刻みから数え直す', () => {
    const s = make(holdVsHold());
    let n = 0;
    while (!s.outcome) {
      step(s, s.tick === 50 ? [{ side: 0, target: 'all', kind: 'brace' }] : []);
      n++;
    }
    expect(s.ordersUsed[0]).toBe(1);
    expect(s.outcome.reason).toBe('stalemate');
    const want = 50 + T.braceTicks + T.stalemateTicks;
    expect(Math.abs(n - want)).toBeLessThanOrEqual(1);
  });

  it('K3d 予定された号令：守備どうしで 300 刻みに号令を予定しておくと、300 刻みまでは終わらない', () => {
    const s = make(holdVsHold({ scriptedOrders: [{ tick: 300, side: 1, target: 'all', kind: 'brace' }] }));
    const n = stepsToEnd(s);
    expect(s.ordersUsed[1]).toBe(1);
    expect(s.outcome!.reason).toBe('stalemate');
    expect(n).toBeGreaterThan(300);
    expect(Math.abs(n - (300 + T.braceTicks + T.stalemateTicks))).toBeLessThanOrEqual(1);
  });

  it('K4 優先の順：守備どうしで maxTicks を 100 にすると時間切れ、101 にすると膠着', () => {
    const a = make(holdVsHold({ maxTicks: 100 }));
    expect(stepsToEnd(a)).toBe(100);
    expect(a.outcome).toEqual({ winner: 'draw', reason: 'timeout', tick: 99 });
    const b = make(holdVsHold({ maxTicks: 101 }));
    expect(stepsToEnd(b)).toBe(100);
    expect(b.outcome).toEqual({ winner: 'draw', reason: 'stalemate', tick: 99 });
  });

  it('K5 勝ち負けを変えない：総当たり 42組 × 種3 を、決まりあり・なしで比べる', () => {
    const bad: string[] = [];
    for (const a of TEMPLATE_IDS) {
      for (const b of TEMPLATE_IDS) {
        if (a === b) continue;
        for (const seed of SEEDS_10.slice(0, 3)) {
          const on = runSetup(matchupSetup(a, b, seed)).state.outcome!;
          const off = runSetup({ ...matchupSetup(a, b, seed), stalemate: false }).state.outcome!;
          const name = `${a} 対 ${b} 種${seed}`;
          if (off.reason === 'timeout') {
            if (on.winner !== off.winner || !['timeout', 'stalemate'].includes(on.reason)) bad.push(`${name}: なし ${JSON.stringify(off)} あり ${JSON.stringify(on)}`);
          } else if (JSON.stringify(on) !== JSON.stringify(off)) {
            bad.push(`${name}: なし ${JSON.stringify(off)} あり ${JSON.stringify(on)}`);
          }
          if (off.reason !== 'timeout' && on.reason === 'stalemate') bad.push(`${name}: 決着のある戦いが膠着になった`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  // 置き直した 3-2（decisions §25）では、鶴翼をそのまま置くと 20 戦とも 43〜45 秒で門を破って勝つ（膠着にならない）。面の難しさを合わせるまで止める
  it('K6 待つだけの時間がなくなる：3-2 に鶴翼をそのまま置いた 20戦は、どれも膠着の負けで、60 秒以内に終わる', (ctx) => {
    ctx.skip(DIFFICULTY_LATER);
    const st = byId('3-2');
    const bad: string[] = [];
    for (const seed of STAGE_SEEDS) {
      const sm = summarize(runStage(st, stageTemplateArmy(st, 'crane'), seed));
      if (!(sm.reason === 'stalemate' && sm.winner === 1 && sm.seconds <= 60)) bad.push(`種${seed}: ${sm.reason}/${sm.winner} ${sm.seconds}秒`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  // 前の条件は「60 秒以内」だった。最終の鶴翼は中央の盾兵が前進なので、両軍の盾兵が正面でぶつかり、盾兵どうしは削り合いが遅く
  // 80 秒ほど戦い続けてから静かになり、膠着の引き分けまで約 93 秒かかる（実験の記録 §37）。中央を守備にすると 60 秒以内に収まるが、
  // 鶴翼が弱くなりすぎて全敗に近づく（A7 が外れる）。そこで親の判断で「膠着の引き分けで終わり、100 秒以内」に直した。
  // 時間切れ（180 秒）を待たずに膠着で終わる、という膠着の決まりのねらいは保たれる。
  it('K6 待つだけの時間がなくなる：鶴翼どうし（種10個）は、どれも膠着の引き分けで、100 秒以内に終わる', () => {
    const bad: string[] = [];
    for (const seed of SEEDS_10) {
      const sm = summarize(runSetup(matchupSetup('crane', 'crane', seed)).state);
      if (!(sm.reason === 'stalemate' && sm.winner === 'draw' && sm.seconds <= 100)) bad.push(`種${seed}: ${sm.reason}/${sm.winner} ${sm.seconds}秒`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('K7 再現できる：時計が 50 のときに JSON にして戻しても、同じ刻みに同じ結果で終わる', () => {
    const a = make(holdVsHold());
    while (a.quietTicks !== 50) step(a, []);
    const b = clone(a);
    expect(b.quietTicks).toBe(50);
    stepsToEnd(a);
    stepsToEnd(b);
    expect(b.outcome).toEqual(a.outcome);
    expect(b).toEqual(a);
  });

  it('K7 quietTicks の項目を消した状態を step に渡しても例外を投げず、その刻みから数え直して終わる', () => {
    const a = make(holdVsHold());
    for (let i = 0; i < 50; i++) step(a, []);
    const b = clone(a) as Partial<BattleState>;
    delete b.quietTicks;
    const s = b as BattleState;
    const start = s.tick;
    expect(() => stepsToEnd(s)).not.toThrow();
    expect(s.outcome).toEqual({ winner: 'draw', reason: 'stalemate', tick: start + T.stalemateTicks - 1 });
  });

  it('K7 quietTicks が null の状態は、JSON にして戻しても null のままで、膠着で終わらない', () => {
    const a = make(holdVsHold({ stalemate: false }));
    for (let i = 0; i < 200; i++) step(a, []);
    const b = clone(a);
    expect(b.quietTicks).toBeNull();
    expect(stepsToEnd(b)).toBe(1600);
    expect(b.outcome!.reason).toBe('timeout');
    expect(b.quietTicks).toBeNull();
  });

  it('K8 見本は膠着で終わらない：15面の見本 × 種20。号令は、予定された号令と step に渡した号令の両方で同じ結果', () => {
    const bad: string[] = [];
    for (const st of STAGES) checkOrders(st, st.solution, st.solutionOrders ?? [], `${st.id} 見本`, bad);
    expect(bad).toEqual([]);
  }, 300_000);

  it('K8 星3つの配置（stages-ch23.test.ts のもの）も膠着で終わらない。号令の渡し方を変えても同じ結果', (ctx) => {
    const ready = Object.entries(STAR3_FOUND).filter(([id]) => !STAR3_PENDING_CH23.has(id));
    ctx.skip(ready.length === 0, STAR3_LATER);
    const bad: string[] = [];
    for (const [id, f] of ready) {
      const ps: Placement[] = f.ps.map(([kind, col, row, stance]) => ({ kind, col, row, stance }));
      checkOrders(byId(id), ps, f.orders, `${id} 星3つ`, bad);
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('K9 引っかかって少しずつ進む部隊を、止まっていると数えない：決まりを切ったときと同じ刻みに同じ結果（陣営0の勝ち）で終わる', () => {
    // 刻みの数を記録した場面なので、記録したときの 12 × 16 の戦場（配置エリア 6 行、通り道なし）で作る
    const setup: BattleSetup = {
      field: plainField(12, 16, 6, 0),
      armies: [
        [p('infantry', 1, 14, 'flank'), p('archer', 0, 12, 'hold'), p('archer', 2, 12, 'flank'), p('hq', 11, 15, 'hold')],
        [p('infantry', 5, 1, 'hold'), p('hq', 11, 0, 'hold')],
      ],
      seed: 1,
      maxTicks: 1800,
      timeout: 'compare',
    };
    const off = make({ ...setup, stalemate: false });
    const offSteps = stepsToEnd(off);
    const on = make(setup);
    const onSteps = stepsToEnd(on);
    expect(offSteps).toBe(924);
    expect(off.outcome).toEqual({ winner: 0, reason: 'wipeout', tick: 923 });
    expect(onSteps).toBe(offSteps);
    expect(on.outcome).toEqual(off.outcome);
  });

  it('K10 回り込みを待たずに終えない：D1 の場面（ふさがれた歩兵が 5 秒待ってから回り込む）は、最初の攻撃まで時計が満ちない。膠着で終わるのは、決まりを切ると時間切れになる戦いだけで、勝ち負けは同じ', () => {
    // D1：盾兵3（守備、列 3・4・5、行 10）の後ろに歩兵2（前進、列 4・5、行 11）。敵は歩兵2（守備、行 3）。
    // 歩兵2が先に崩れると、盾兵（守備）と敵の歩兵（守備）が向き合ったまま残るので、そのあとの膠着は正しい。見るのは、回り込みを待つあいだに終えないこと
    const armies: [Placement[], Placement[]] = [
      [p('shield', 3, 10, 'hold'), p('shield', 4, 10, 'hold'), p('shield', 5, 10, 'hold'), p('infantry', 4, 11), p('infantry', 5, 11)],
      [p('infantry', 4, 3, 'hold'), p('infantry', 5, 3, 'hold')],
    ];
    const bad: string[] = [];
    for (const seed of SEEDS_10) {
      const setup: BattleSetup = { field: plainField(), armies, seed, maxTicks: 1800, timeout: 'compare', requireHq: false };
      const s = make(setup);
      let firstAttack = -1;
      let quietBefore = 0;
      while (!s.outcome) {
        step(s, []);
        if (firstAttack < 0 && s.units.some((u) => u.attacking !== null)) firstAttack = s.tick - 1;
        if (firstAttack < 0) quietBefore = Math.max(quietBefore, s.quietTicks!);
      }
      // ふさがれて待つあいだも、回り込むあいだも、歩兵は毎刻み動こうとしているので、最初の攻撃（実測は 149 刻み）まで時計は 0 のまま
      if (!(firstAttack >= 0 && firstAttack <= 200 && quietBefore === 0)) bad.push(`種${seed}: 最初の攻撃 ${firstAttack}、それまでの時計の最大 ${quietBefore}`);
      const off = runSetup({ ...setup, stalemate: false }).state.outcome!;
      const on = s.outcome;
      if (on.reason === 'stalemate' ? !(off.reason === 'timeout' && off.winner === on.winner && on.tick > firstAttack) : JSON.stringify(on) !== JSON.stringify(off)) {
        bad.push(`種${seed}: あり ${JSON.stringify(on)} なし ${JSON.stringify(off)}`);
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);
});

/** 号令を「予定された号令」として渡した場合と、同じ刻みに step へ渡した場合を比べる（どちらも stalemate でない） */
function checkOrders(st: Stage, ps: Placement[], orders: StageEnemyOrder[], name: string, bad: string[]): void {
  for (const seed of STAGE_SEEDS) {
    const a = summarize(runStage(st, ps, seed, undefined, orders));
    if (a.reason === 'stalemate') bad.push(`${name} 種${seed}: 予定された号令で stalemate`);
    if (orders.length === 0) continue;
    const s = make(stageSetupWith(st, ps, seed, []));
    runState(s, { orders: (x) => orders.filter((o) => Math.round(o.atSec * 10) === x.tick).map((o) => ({ side: 0 as Side, target: o.target, kind: o.kind })) });
    const b = summarize(s);
    if (b.reason === 'stalemate') bad.push(`${name} 種${seed}: step に渡した号令で stalemate`);
    if (a.seconds !== b.seconds || a.winner !== b.winner || a.remaining[0] !== b.remaining[0]) {
      bad.push(`${name} 種${seed}: 予定 ${a.reason}/${a.winner} ${a.seconds}秒 ${a.remaining[0]} ／ step ${b.reason}/${b.winner} ${b.seconds}秒 ${b.remaining[0]}`);
    }
  }
}
