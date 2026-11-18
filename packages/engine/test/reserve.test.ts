// 遊軍（design §7、§7.9 の R1〜R12）
import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  canOrder,
  canSummon,
  canSummonView,
  createBattle,
  MAX_UNITS,
  plainField,
  PVP_RULES,
  reserveErrors,
  STAGES,
  stageSetup,
  stageSetupWith,
  starsFor,
  step,
  summarize,
  validateArmy,
  validateStageArmy,
  viewFor,
  pvpArmyLimits,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type Kind,
  type Placement,
  type ReserveFrom,
  type ReserveInput,
  type ReserveSetup,
  type Side,
  type Stage,
  type Stance,
  type TemplateId,
} from '../src/index.ts';
import { KIND_STATS, T } from '../src/tuning.ts';
import { matchupSetup, TEMPLATE_IDS } from '../sim/lib.ts';
import { allHold } from '../sim/scenes.ts';
import { runStage, STAGE_SEEDS } from '../sim/stagelib.ts';
import { clone, openField, p } from './helpers.ts';

function make(setup: BattleSetup): BattleState {
  const r = createBattle(setup);
  if (!r.ok) throw new Error(`createBattle: ${r.error.message} ${JSON.stringify(r.error.armyErrors ?? [])}`);
  return r.value;
}

/** tick まで、何もせずに進める */
function stepTo(s: BattleState, tick: number): void {
  while (s.tick < tick && !s.outcome) step(s, []);
}

/** 両軍が離れたまま全部隊が守備の、標準の戦場（だれも攻撃しない） */
function quietSetup(reserves: NonNullable<BattleSetup['reserves']> | null, height = 16, extra: Partial<BattleSetup> = {}): BattleSetup {
  const f = plainField(12, height);
  const army = (side: Side): Placement[] => allHold(applyTemplate('line', PVP_RULES.standardRoster, f.zones[side], side));
  return { field: f, armies: [army(0), army(1)], seed: 7, maxTicks: 1800, timeout: 'compare', stalemate: false, ...(reserves ? { reserves } : {}), ...extra };
}

const cav: ReserveSetup = { kind: 'cavalry', stance: 'advance' };
const sum = (_s: BattleState, side: Side, from: ReserveFrom): ReserveInput[] => [{ side, from }];
/** 状態から遊軍の欄を除いた写し（遊軍のない戦いと比べるため） */
const withoutReserves = (s: BattleState): unknown => {
  const c = clone(s) as unknown as Record<string, unknown>;
  delete c['reserves'];
  return c;
};

describe('R1 遊軍のない戦いは変わらない', () => {
  // T10 と、いまある全テストは、それぞれのファイルで記録も期待値も変えずに通す。ここでは reserves の書き方の違いを見る
  const pairs: [TemplateId, TemplateId][] = [['line', 'crane'], ['scale', 'arrow'], ['ring', 'crescent'], ['echelon', 'line'], ['crane', 'scale'], ['arrow', 'ring']];
  for (const [a, b] of pairs) {
    it(`${a} 対 ${b}：reserves を [null, null] と書いた設定と、書かない設定で、全刻みの状態と出来事が一致する`, () => {
      for (const seed of [1, 2, 3]) {
        const x = make(matchupSetup(a, b, seed));
        const y = make({ ...matchupSetup(a, b, seed), reserves: [null, null], scriptedReserves: [] });
        expect(x.reserves).toEqual([null, null]);
        expect(JSON.stringify(x)).toBe(JSON.stringify(y));
        while (!x.outcome) {
          const ex = step(x, []);
          const ey = step(y, [], []);
          expect(JSON.stringify(ey)).toBe(JSON.stringify(ex));
          expect(JSON.stringify(y)).toBe(JSON.stringify(x));
        }
        const sm = summarize(x);
        expect(sm.unusedReserve).toEqual([null, null]);
        expect(sm.remainingForStars).toEqual(sm.remaining);
      }
    }, 60_000);
  }
});

describe('値の検査', () => {
  it('reserveErrors：本陣、知らない兵種・方針、オブジェクトでない値を落とす', () => {
    expect(reserveErrors({ kind: 'cavalry', stance: 'flank' })).toEqual([]);
    for (const k of ['infantry', 'shield', 'cavalry', 'archer'] as Kind[]) for (const st of ['advance', 'hold', 'flank', 'hunt'] as Stance[]) expect(reserveErrors({ kind: k, stance: st })).toEqual([]);
    expect(reserveErrors({ kind: 'hq', stance: 'hold' }).map((e) => e.code)).toEqual(['invalid_kind']);
    expect(reserveErrors({ kind: 'gate', stance: 'hold' }).map((e) => e.code)).toEqual(['invalid_kind']);
    expect(reserveErrors({ kind: 'cavalry', stance: 'charge' }).map((e) => e.code)).toEqual(['invalid_stance']);
    expect(reserveErrors({ kind: 'cavalry', stance: 'constructor' }).map((e) => e.code)).toEqual(['invalid_stance']);
    for (const v of [null, undefined, 1, 'cavalry', [], [{ kind: 'cavalry', stance: 'hold' }]]) expect(reserveErrors(v).length).toBe(1);
  });
  it('createBattle：reserves と scriptedReserves の形が正しくなければ invalid_setup', () => {
    const base = quietSetup(null);
    const bad: unknown[] = [
      { reserves: [cav] },
      { reserves: [cav, null, null] },
      { reserves: {} },
      { reserves: [{ kind: 'hq', stance: 'hold' }, null] },
      { reserves: [{ kind: 'cavalry', stance: 'x' }, null] },
      { reserves: [undefined, null] },
      { reserves: [cav, null], scriptedReserves: {} },
      { reserves: [cav, null], scriptedReserves: [{ tick: 60, side: 1, from: 'left' }] }, // 遊軍のない陣営への予定
      { reserves: [cav, null], scriptedReserves: [{ tick: 60, side: 0, from: 'left' }, { tick: 90, side: 0, from: 'right' }] }, // 同じ陣営に2つ
      { reserves: [cav, null], scriptedReserves: [{ tick: -1, side: 0, from: 'left' }] },
      { reserves: [cav, null], scriptedReserves: [{ tick: 1.5, side: 0, from: 'left' }] },
      { reserves: [cav, null], scriptedReserves: [{ tick: 60, side: 2, from: 'left' }] },
      { reserves: [cav, null], scriptedReserves: [{ tick: 60, side: 0, from: 'center' }] },
      { reserves: [cav, null], scriptedReserves: [null] },
    ];
    for (const extra of bad) {
      const r = createBattle({ ...base, ...(extra as object) } as BattleSetup);
      expect(r.ok, JSON.stringify(extra)).toBe(false);
      if (!r.ok) expect(r.error.code, JSON.stringify(extra)).toBe('invalid_setup');
    }
  });
  it('createBattle：戦場の部隊 + 遊軍が上限を超えたら invalid_army（too_many_units）。ちょうどなら作れる', () => {
    const f = openField();
    const sixteen: Placement[] = [p('hq', 0, 0, 'hold'), ...Array.from({ length: 15 }, (_, i) => p('infantry', i % 12, 1 + Math.floor(i / 12)))];
    const fifteen = sixteen.slice(0, 15);
    const enemy = [p('hq', 0, 15, 'hold'), p('infantry', 1, 15)];
    const r = createBattle({ field: f, armies: [sixteen, enemy], seed: 1, maxTicks: 100, timeout: 'compare', reserves: [cav, null] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('invalid_army');
      expect(r.error.armyErrors?.map((e) => e.code)).toEqual(['too_many_units']);
    }
    expect(createBattle({ field: f, armies: [fifteen, enemy], seed: 1, maxTicks: 100, timeout: 'compare', reserves: [cav, null] }).ok).toBe(true);
    expect(fifteen.length + 1).toBe(MAX_UNITS);
  });
  it('作った状態は JSON にして戻しても同じ。予定の tick が 50 より小さければ 50 にする', () => {
    const s = make(quietSetup([cav, { kind: 'archer', stance: 'hold' }], 16, { scriptedReserves: [{ tick: 10, side: 1, from: 'right' }] }));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s.reserves).toEqual([
      { kind: 'cavalry', stance: 'advance', used: false, unit: null, auto: null },
      { kind: 'archer', stance: 'hold', used: false, unit: null, auto: { tick: T.reserveMinTick, from: 'right' } },
    ]);
  });
  it('validateArmy：遊軍を部隊数と予算に含める。正しくない遊軍は reserveErrors の誤り', () => {
    const f = plainField();
    const army = applyTemplate('line', PVP_RULES.standardRoster, f.zones[0], 0);
    const lim = pvpArmyLimits();
    expect(validateArmy(army, f.zones[0], lim)).toEqual([]); // 予算ちょうど
    expect(validateArmy(army, f.zones[0], { ...lim, reserve: null })).toEqual([]);
    expect(validateArmy(army, f.zones[0], { ...lim, reserve: { kind: 'archer', stance: 'hold' } }).map((e) => e.code)).toEqual(['over_budget']);
    // 1つ抜いて遊軍に回せば、予算も数も同じ
    const i = army.findIndex((x) => x.kind === 'cavalry');
    const rest = army.filter((_, j) => j !== i);
    expect(validateArmy(rest, f.zones[0], { ...lim, reserve: { kind: 'cavalry', stance: 'flank' } })).toEqual([]);
    expect(validateArmy(rest, f.zones[0], { ...lim, reserve: { kind: 'hq', stance: 'hold' } }).map((e) => e.code)).toEqual(['invalid_kind']);
    expect(validateArmy(rest, f.zones[0], { ...lim, reserve: { kind: 'cavalry', stance: 'x' as Stance } }).map((e) => e.code)).toEqual(['invalid_stance']);
    // 部隊数：戦場 16 + 遊軍は上限を超える。戦場が本陣だけなら、遊軍がいても too_few_units
    const big = applyTemplate('line', { hq: 1, infantry: 15 }, f.zones[0], 0);
    expect(validateArmy(big, f.zones[0], { maxUnits: MAX_UNITS, reserve: cav }).map((e) => e.code)).toEqual(['too_many_units']);
    expect(validateArmy([p('hq', 5, 15, 'hold')], f.zones[0], { maxUnits: MAX_UNITS, reserve: cav }).map((e) => e.code)).toEqual(['too_few_units']);
  });
  it('validateStageArmy：手持ちと上限を遊軍込みで数え、本陣と面で選べない方針を落とす', () => {
    const st = STAGES.find((s) => s.id === '2-1') as Stage;
    const sol = st.solution;
    expect(validateStageArmy(st, sol)).toEqual([]);
    const i = sol.findIndex((x) => x.kind !== 'hq');
    const k = (sol[i] as Placement).kind;
    const rest = sol.filter((_, j) => j !== i);
    expect(validateStageArmy(st, rest, { kind: k, stance: 'hold' })).toEqual([]);
    // 抜かずに遊軍を足すと、手持ちを超える（その兵種を手持ちいっぱいに置いているとき）
    const have = st.roster[k] ?? 0;
    if (sol.filter((x) => x.kind === k).length === have) expect(validateStageArmy(st, sol, { kind: k, stance: 'hold' }).map((e) => e.code)).toContain('over_roster');
    expect(validateStageArmy(st, rest, { kind: 'hq', stance: 'hold' }).map((e) => e.code)).toEqual(['invalid_kind']);
    const e = validateStageArmy(st, rest, { kind: k, stance: 'nope' as Stance });
    expect(e.map((x) => x.code)).toEqual(['invalid_stance']);
    expect(e[0]?.index).toBeUndefined();
    // 方針を選べない面（第1章）では、初期設定以外の方針を落とす
    const c1 = STAGES.find((s) => s.id === '1-2') as Stage;
    const j = c1.solution.findIndex((x) => x.kind === 'infantry');
    const rest1 = c1.solution.filter((_, q) => q !== j);
    expect(validateStageArmy(c1, rest1, { kind: 'infantry', stance: 'advance' })).toEqual([]);
    const e1 = validateStageArmy(c1, rest1, { kind: 'infantry', stance: 'hunt' });
    expect(e1.map((x) => x.code)).toEqual(['invalid_stance']);
    expect(e1[0]?.index).toBeUndefined();
    // 戦場が本陣だけ
    expect(validateStageArmy(st, sol.filter((x) => x.kind === 'hq'), { kind: k, stance: 'hold' }).map((x) => x.code)).toContain('too_few_units');
    for (const v of [null, undefined, 1, {}, [null], 'cavalry']) expect(() => validateStageArmy(st, rest, v as never)).not.toThrow();
  });
  it('stageSetupWith：遊軍がなければ、いままでと同じ設定。あれば自軍と敵の遊軍と予定を足す', () => {
    for (const st of STAGES) expect(stageSetupWith(st, st.solution, 5, [])).toEqual(stageSetup(st, st.solution, 5));
    const st = STAGES[5] as Stage;
    const withEnemy: Stage = { ...st, enemyReserve: { kind: 'cavalry', stance: 'hunt', atSec: 20, from: 'right' } };
    const s = stageSetupWith(withEnemy, st.solution, 5, [], { kind: 'archer', stance: 'hold' }, { atSec: 8, from: 'left' });
    expect(s.reserves).toEqual([{ kind: 'archer', stance: 'hold' }, { kind: 'cavalry', stance: 'hunt' }]);
    expect(s.scriptedReserves).toEqual([{ tick: 80, side: 0, from: 'left' }, { tick: 200, side: 1, from: 'right' }]);
  });
});

describe('R2 呼べる条件', () => {
  it('tick 49 では reserve_not_ready、tick 50 から呼べる。2回目は no_reserve。遊軍のない陣営は no_reserve。決着後は battle_over', () => {
    const s = make(quietSetup([cav, null]));
    stepTo(s, 49);
    expect(s.tick).toBe(49);
    const r49 = canSummon(s, 0, 'left');
    expect(r49.ok).toBe(false);
    if (!r49.ok) expect(r49.error.code).toBe('reserve_not_ready');
    // 呼べない入力は黙って捨てる（出来事を出さない）
    const before = clone(s);
    const ev49 = step(s, [], sum(s, 0, 'left'));
    expect(ev49.filter((e) => e.type === 'reserve')).toEqual([]);
    expect(s.units.length).toBe(before.units.length);
    expect(s.tick).toBe(50);
    expect(canSummon(s, 0, 'left')).toEqual({ ok: true, value: true });
    const n = s.units.length;
    const ev = step(s, [], sum(s, 0, 'left'));
    expect(ev.filter((e) => e.type === 'reserve')).toEqual([{ type: 'reserve', tick: 50, side: 0, unit: n, from: 'left' }]);
    const again = canSummon(s, 0, 'right');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('no_reserve');
    const other = canSummon(s, 1, 'left');
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe('no_reserve');
    const done = make(quietSetup([cav, null]));
    stepTo(done, 60);
    done.outcome = { winner: 0, reason: 'hq', tick: 59 };
    const o = canSummon(done, 0, 'left');
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error.code).toBe('battle_over');
  });
  it('正しくない値は invalid_order。canSummon・canSummonView・step の遊軍の入力は例外を投げない', () => {
    const s = make(quietSetup([cav, null]));
    stepTo(s, 50);
    const junk: unknown[] = [null, undefined, 0, 1, 'x', {}, [], { side: 0 }, { side: 0, from: 'up' }, { side: 2, from: 'left' }, NaN];
    for (const v of junk) {
      expect(() => canSummon(v as never, 0, 'left')).not.toThrow();
      expect(canSummon(v as never, 0, 'left').ok).toBe(false);
      expect(() => canSummonView(v as never, 0)).not.toThrow();
      expect(canSummonView(v as never, 0)).toBe(false);
      if (v !== 0 && v !== 1) {
        const r = canSummon(s, v as never, 'left');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe('invalid_order');
      }
      const r2 = canSummon(s, 0, v as never);
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.error.code).toBe('invalid_order');
    }
    // 壊れた入力は捨て、状態を変えない。先頭の8件より後ろは見ない
    const a = clone(s);
    const b = clone(s);
    expect(() => step(a, [], junk as never)).not.toThrow();
    for (const v of junk) expect(() => step(a, [], v as never)).not.toThrow();
    step(b, []);
    for (let i = 0; i < junk.length; i++) step(b, []);
    expect(a).toEqual(b);
    const c = clone(s);
    step(c, [], [...new Array(8).fill({ side: 1, from: 'left' }), { side: 0, from: 'left' }] as never);
    expect(c.reserves[0]?.used).toBe(false);
  });
  it('canSummonView は、決着していないことと、自分の遊軍が ready であることだけを見る', () => {
    const s = make(quietSetup([cav, cav]));
    expect(canSummonView(viewFor(s, 0), 0)).toBe(false); // waiting
    stepTo(s, 50);
    expect(canSummonView(viewFor(s, 0), 0)).toBe(true);
    expect(canSummonView(viewFor(s, 0), 1)).toBe(false); // 相手のぶんは見えない
    expect(canSummonView(viewFor(s, 1), 1)).toBe(true);
    step(s, [], [{ side: 0, from: 'left' }]);
    expect(canSummonView(viewFor(s, 0), 0)).toBe(false); // used
  });
});

describe('R3 現れた部隊', () => {
  const cases: [Side, ReserveFrom, number, number][] = [
    [0, 'left', 0, 8],
    [0, 'right', 11, 8],
    [1, 'left', 11, 7],
    [1, 'right', 0, 7],
  ];
  for (const [side, from, col, row] of cases) {
    it(`陣営${side}の${from}：列 ${col}・行 ${row}、翼・兵数・士気・方針・向き・id`, () => {
      const r: ReserveSetup = { kind: 'archer', stance: 'flank' };
      const s = make(quietSetup(side === 0 ? [r, null] : [null, r]));
      stepTo(s, 50);
      const n = s.units.length;
      const init = [...s.initialMen];
      const ev = step(s, [], [{ side, from }]);
      expect(ev.filter((e) => e.type === 'reserve')).toEqual([{ type: 'reserve', tick: 50, side, unit: n, from }]);
      expect(s.units.length).toBe(n + 1);
      const u = s.units[n]!;
      expect(u.id).toBe(n);
      expect(u.side).toBe(side);
      expect(u.kind).toBe('archer');
      expect(u.stance).toBe('flank');
      expect(u.wing).toBe(from);
      expect(u.maxMen).toBe(KIND_STATS.archer.men);
      expect(u.status).toBe('active');
      expect(u.flankEdgeX).toBe(col + 0.5);
      expect(s.initialMen[side]).toBe((init[side] as number) + KIND_STATS.archer.men);
      expect(s.initialMen[1 - side]).toBe(init[1 - side]);
      expect(s.reserves[side]).toMatchObject({ used: true, unit: n });
      // 現れた刻みの動きのあとも、そのマスにいる（迂回の②は端に沿って前へ進むので、少しだけ動いている）
      expect(Math.floor(u.x)).toBe(col);
      expect(Math.abs(u.y - (row + 0.5))).toBeLessThan(0.3);
    });
  }
  it('現れたばかりの値：向きは敵の方向、持ち場は現れた位置、迂回は「端に沿って進む」から', () => {
    const s = make(quietSetup([null, { kind: 'shield', stance: 'hold' }]));
    stepTo(s, 50);
    step(s, [], [{ side: 1, from: 'left' }]);
    const u = s.units[s.units.length - 1]!;
    // 向きは敵の方向（陣営1は y が増える向き）から始まり、この刻みのうちに狙いへ少し回る
    expect(u.fy).toBeGreaterThan(0.9);
    expect(u).toMatchObject({ x: 11.5, y: 7.5, men: 100, morale: T.moraleMax, home: { x: 11.5, y: 7.5 }, flankPhase: 2, order: null, runup: 0, huntMoves: [], advMoves: [], detourX: null, routTick: null });
  });
  it('高さ 15 の戦場では、陣営0が行 8、陣営1が行 6', () => {
    for (const [side, row] of [[0, 8], [1, 6]] as const) {
      const s = make(quietSetup(side === 0 ? [cav, null] : [null, cav], 15));
      stepTo(s, 50);
      step(s, [], [{ side, from: 'left' }]);
      const u = s.units[s.units.length - 1]!;
      expect(u.home.y).toBe(row + 0.5);
    }
  });
  it('呼ぶ処理は乱数を引かない（だれも攻撃しない場面で、呼んだ刻みの乱数の状態が、呼ばなかった場合と同じ）', () => {
    const s = make(quietSetup([{ kind: 'infantry', stance: 'hold' }, { kind: 'shield', stance: 'hold' }]));
    stepTo(s, 50);
    const a = clone(s);
    const b = clone(s);
    // 陣営0の左（列 0・行 8）と陣営1の右（列 0・行 7）は隣り合って戦いになるので、陣営1は左（列 11・行 7）から呼ぶ
    step(a, [], [{ side: 0, from: 'left' }, { side: 1, from: 'left' }]);
    step(b, []);
    expect(a.units.length).toBe(b.units.length + 2);
    expect(a.rng).toBe(b.rng);
  });
});

describe('R4 マスがふさがっているとき', () => {
  it('候補の最初のマスに部隊がいれば、次の行に現れる（敵の部隊でも同じ）', () => {
    for (const blockerSide of [0, 1] as const) {
      const mine = [p('hq', 6, 15, 'hold'), p('infantry', 6, 14, 'hold')];
      const theirs = [p('hq', 6, 0, 'hold'), p('infantry', 6, 1, 'hold')];
      (blockerSide === 0 ? mine : theirs).push(p('shield', 0, 8, 'hold'));
      const s = make({ field: openField(), armies: [mine, theirs], seed: 1, maxTicks: 1800, timeout: 'compare', stalemate: false, reserves: [cav, null] });
      stepTo(s, 50);
      step(s, [], [{ side: 0, from: 'left' }]);
      const u = s.units[s.units.length - 1]!;
      expect(u.home).toEqual({ x: 0.5, y: 9.5 });
    }
  });
  it('端の列がすべてふさがっていれば no_spawn_cell で、状態は変わらない', () => {
    const mine = [p('hq', 6, 15, 'hold'), ...[8, 9, 10, 11, 12, 13, 14, 15].map((r) => p('infantry', 0, r, 'hold'))];
    const s = make({ field: openField(), armies: [mine, [p('hq', 6, 0, 'hold'), p('infantry', 6, 1, 'hold')]], seed: 1, maxTicks: 1800, timeout: 'compare', stalemate: false, reserves: [cav, null] });
    stepTo(s, 50);
    const r = canSummon(s, 0, 'left');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no_spawn_cell');
    expect(canSummon(s, 0, 'right').ok).toBe(true);
    const a = clone(s);
    const b = clone(s);
    const ev = step(a, [], [{ side: 0, from: 'left' }]);
    step(b, []);
    expect(ev).toEqual([]);
    expect(a).toEqual(b);
  });
  it('城壁の面（3-2 の戦場）：守る側（陣営1）の遊軍は城壁の内側の行に現れ、城壁の行とその向こうには現れない', () => {
    const st = STAGES.find((x) => x.id === '3-2') as Stage;
    const wallRow = st.gate!.row;
    let n = 0;
    for (const from of ['left', 'right'] as const) {
      for (const tick of [50, 150, 400]) {
        const s = make({ ...stageSetup(st, st.solution, 5000), reserves: [null, { kind: 'infantry', stance: 'hold' }] });
        stepTo(s, tick);
        if (s.outcome) continue;
        if (!canSummon(s, 1, from).ok) continue;
        step(s, [], [{ side: 1, from }]);
        const u = s.units[s.units.length - 1]!;
        expect(u.kind).toBe('infantry');
        expect(u.home.y).toBeLessThan(wallRow);
        n++;
      }
    }
    expect(n).toBeGreaterThan(2);
    // 攻める側（陣営0）の遊軍は、ふつうどおり中央の線のすぐ自陣側
    const s0 = make({ ...stageSetup(st, st.solution, 5000), reserves: [cav, null] });
    stepTo(s0, 50);
    step(s0, [], [{ side: 0, from: 'left' }]);
    expect(s0.units[s0.units.length - 1]!.home.y).toBeGreaterThan(wallRow + 1);
  });
  it('門が破れたあとも、城壁の行とその向こうには現れない', () => {
    const st = STAGES.find((x) => x.id === '3-2') as Stage;
    const s = make({ ...stageSetup(st, st.solution, 5000), reserves: [null, cav] });
    stepTo(s, 50);
    // 門を壊したことにして、両隣の城壁を平地にする（step の中の崩れ方と同じ）
    const g = s.units[s.gate!.id]!;
    g.status = 'gone';
    for (const c of [s.gate!.col - 1, s.gate!.col + 1]) s.field.terrain[s.gate!.row * s.field.width + c] = 'plain';
    // 端の列の城壁の内側をすべてふさぐと、城壁の行や外には出ず no_spawn_cell
    for (let r = 0; r < s.gate!.row; r++) {
      const u = clone(s.units[0]!);
      u.id = s.units.length;
      u.side = 1;
      u.x = 11.5;
      u.y = r + 0.5;
      u.status = 'active';
      s.units.push(u);
    }
    const res = canSummon(s, 1, 'left');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('no_spawn_cell');
  });
});

describe('R5 現れたあと、ふつうに戦う', () => {
  it('歩兵どうしが戦っている横から、前進の騎兵の遊軍を出すと、横か後ろからの突入が出る', () => {
    // 陣営0の歩兵（列 3・行 8）と陣営1の歩兵（列 3・行 7）が向かい合って戦う。陣営0の右（列 11）から騎兵を出すと、相手の横へ走り込む。
    // 本陣を置くと、前進の騎兵は戦っていない敵（本陣）を先に狙うので、本陣なしの部分的な戦いにする
    const s = make({
      field: openField(),
      armies: [[p('infantry', 3, 8, 'hold')], [p('infantry', 3, 7, 'hold')]],
      requireHq: false,
      seed: 3,
      maxTicks: 1800,
      timeout: 'compare',
      reserves: [{ kind: 'cavalry', stance: 'advance' }, null],
    });
    stepTo(s, 50);
    expect(s.units.some((u) => u.attacking !== null)).toBe(true);
    const ev: BattleEvent[] = [...step(s, [], [{ side: 0, from: 'right' }])];
    const id = s.units.length - 1;
    for (let i = 0; i < 100 && !s.outcome; i++) ev.push(...step(s, []));
    const impacts = ev.filter((e) => e.type === 'impact' && e.attacker === id);
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts.some((e) => e.type === 'impact' && e.facing !== 'front')).toBe(true);
  });
  it('どのひな形・兵種・方針・左右でも、最後まで進み、NaN が出ず、戦場の外に出ない', () => {
    const kinds: Kind[] = ['infantry', 'shield', 'cavalry', 'archer'];
    const stances: Stance[] = ['advance', 'hold', 'flank', 'hunt'];
    let runs = 0;
    for (let ti = 0; ti < TEMPLATE_IDS.length; ti++) {
      const a = TEMPLATE_IDS[ti] as TemplateId;
      const b = TEMPLATE_IDS[(ti + 1) % TEMPLATE_IDS.length] as TemplateId;
      for (const kind of kinds) {
        for (const stance of stances) {
          for (const from of ['left', 'right'] as const) {
            for (const seed of [11, 12]) {
              for (const at of [50, 300]) {
                const f = plainField();
                const setup: BattleSetup = {
                  field: f,
                  armies: [applyTemplate(a, PVP_RULES.standardRoster, f.zones[0], 0), applyTemplate(b, PVP_RULES.standardRoster, f.zones[1], 1)],
                  seed,
                  maxTicks: 1800,
                  timeout: 'compare',
                  reserves: [{ kind, stance }, null],
                  scriptedReserves: [{ tick: at, side: 0, from }],
                };
                const s = make(setup);
                while (!s.outcome) {
                  step(s, []);
                  for (const u of s.units) {
                    if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !Number.isFinite(u.men) || !Number.isFinite(u.morale)) throw new Error(`NaN ${a} ${kind} ${stance} ${from} ${seed} ${at} tick ${s.tick}`);
                    if (u.status === 'active' && (u.x < 0 || u.x > f.width || u.y < 0 || u.y > f.height)) throw new Error(`外 ${a} ${kind} ${stance} ${from} ${seed} ${at}`);
                  }
                }
                runs++;
              }
            }
          }
        }
      }
    }
    expect(runs).toBe(7 * 4 * 4 * 2 * 2 * 2);
  }, 600_000);
});

describe('R6 号令', () => {
  it('同じ刻みに渡した全軍あて・出た側の翼あての号令は、現れた遊軍にかかる。反対の翼あてはかからない', () => {
    for (const [target, hit] of [['all', true], ['left', true], ['right', false]] as const) {
      const s = make(quietSetup([{ kind: 'infantry', stance: 'hold' }, null]));
      stepTo(s, 50);
      step(s, [{ side: 0, target, kind: 'brace' }], [{ side: 0, from: 'left' }]);
      const u = s.units[s.units.length - 1]!;
      expect(u.order?.kind ?? null, target).toBe(hit ? 'brace' : null);
    }
  });
  it('あとの号令もかかる。だれもいない翼は、呼ぶ前は no_target_units、現れた次の刻みから通る', () => {
    // 陣営0は中央だけに置く（左翼は空）
    const mine = [p('hq', 5, 15, 'hold'), p('infantry', 5, 14, 'hold'), p('infantry', 6, 14, 'hold')];
    const s = make({ field: openField(), armies: [mine, [p('hq', 5, 0, 'hold'), p('infantry', 5, 1, 'hold')]], seed: 1, maxTicks: 1800, timeout: 'compare', reserves: [{ kind: 'infantry', stance: 'hold' }, null] });
    stepTo(s, 50);
    const before = canOrder(s, 0, 'left', 'charge');
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.error.code).toBe('no_target_units');
    step(s, [], [{ side: 0, from: 'left' }]);
    expect(canOrder(s, 0, 'left', 'charge').ok).toBe(true);
    const id = s.units.length - 1;
    const ev = step(s, [{ side: 0, target: 'left', kind: 'charge' }]);
    expect(ev.some((e) => e.type === 'order')).toBe(true);
    expect(s.units[id]!.order?.kind).toBe('charge');
    expect(s.ordersUsed[0]).toBe(1); // 遊軍を呼んでも号令の回数は減らない
  });
});

describe('R7 判定', () => {
  it('呼ばなかった遊軍は数に入らない：遊軍のない同じ配置と、全刻みで状態（遊軍の欄を除く）が一致する', () => {
    for (const [a, b] of [['line', 'crane'], ['ring', 'ring'], ['scale', 'echelon']] as [TemplateId, TemplateId][]) {
      for (const seed of [1, 2]) {
        const base = matchupSetup(a, b, seed);
        base.armies = [base.armies[0].slice(0, -1), base.armies[1]];
        const x = make(base);
        const y = make({ ...base, reserves: [cav, { kind: 'archer', stance: 'hold' }] });
        expect(y.initialMen).toEqual(x.initialMen);
        while (!x.outcome) {
          step(x, []);
          step(y, []);
          expect(withoutReserves(y)).toEqual(withoutReserves(x));
        }
        expect(y.outcome).toEqual(x.outcome);
        const sm = summarize(y);
        expect(sm.remaining).toEqual(summarize(x).remaining);
        expect(sm.unusedReserve).toEqual([{ kind: 'cavalry', men: 60 }, { kind: 'archer', men: 80 }]);
      }
    }
  });
  it('呼んだあとは initialMen と remaining に入り、unusedReserve は null', () => {
    const s = make(quietSetup([cav, null]));
    stepTo(s, 50);
    const init = s.initialMen[0];
    step(s, [], [{ side: 0, from: 'left' }]);
    expect(s.initialMen[0]).toBe(init + 60);
    const sm = summarize(s);
    expect(sm.unusedReserve).toEqual([null, null]);
    expect(sm.remaining[0]).toBe(1);
    expect(sm.remainingForStars).toEqual(sm.remaining);
    expect(sm.units.some((u) => u.id === s.units.length - 1 && u.wing === 'left' && u.kind === 'cavalry')).toBe(true);
  });
});

describe('R8 星', () => {
  it('remainingForStars は、呼ばなかった遊軍を無傷として数える', () => {
    const base = matchupSetup('line', 'crane', 4);
    base.armies = [base.armies[0].slice(0, -1), base.armies[1]];
    const s = make({ ...base, reserves: [cav, null] });
    while (!s.outcome) step(s, []);
    const sm = summarize(s);
    const alive = s.units.filter((u) => u.side === 0 && u.status === 'active').reduce((t, u) => t + u.men, 0);
    expect(sm.remainingForStars[0]).toBeCloseTo((alive + 60) / (s.initialMen[0] + 60), 12);
    expect(sm.remainingForStars[1]).toBe(sm.remaining[1]);
    // 星は remainingForStars で決まる。ない振り返り（古い形）では remaining を使う
    const won = { ...sm, winner: 0 as const, remaining: [0.6, 0] as [number, number], remainingForStars: [0.75, 0] as [number, number] };
    expect(starsFor(won, 0)).toBe(3);
    const old = { ...won } as Partial<typeof won>;
    delete old.remainingForStars;
    delete old.unusedReserve;
    expect(starsFor(old as typeof won, 0)).toBe(2);
  });
  it('遊軍のない戦いでは remaining と一致する（15 面の見本 × 種 20）', () => {
    for (const st of STAGES) {
      for (const seed of STAGE_SEEDS) {
        const sm = summarize(runStage(st, st.solution, seed, undefined, st.solutionOrders ?? []));
        expect(sm.remainingForStars).toEqual(sm.remaining);
        expect(sm.unusedReserve).toEqual([null, null]);
      }
    }
  }, 300_000);
});

describe('R9 膠着と、予定された遊軍', () => {
  /** 両軍が全部隊守備で離れている（膠着の決まりは入れたまま） */
  const holdSetup = (extra: Partial<BattleSetup> = {}): BattleSetup => ({ ...quietSetup(null), stalemate: true, ...extra });
  it('片方に呼ばない遊軍がいても、10 秒で膠着になる', () => {
    const x = make(holdSetup());
    const y = make(holdSetup({ reserves: [null, cav] }));
    while (!x.outcome) step(x, []);
    while (!y.outcome) step(y, []);
    expect(x.outcome?.reason).toBe('stalemate');
    expect(y.outcome).toEqual(x.outcome);
  });
  it('予定された遊軍が残っているあいだは膠着にならず、現れたあとに戦いが動く', () => {
    const s = make(holdSetup({ reserves: [cav, null], scriptedReserves: [{ tick: 300, side: 0, from: 'left' }] }));
    let at = -1;
    while (!s.outcome) {
      const ev = step(s, []);
      if (ev.some((e) => e.type === 'reserve')) at = ev.find((e) => e.type === 'reserve')!.tick;
    }
    expect(at).toBe(300);
    expect(s.outcome!.tick).toBeGreaterThan(300 + T.stalemateTicks - 1);
    // 現れた騎兵（前進）が敵に向かって動き、攻撃する
    expect(s.units[s.units.length - 1]!.stats.dealt).toBeGreaterThan(0);
  });
  it('tick が 50 より小さい予定は 50 に現れる', () => {
    const s = make(quietSetup([cav, null], 16, { scriptedReserves: [{ tick: 0, side: 0, from: 'right' }] }));
    const seen: number[] = [];
    while (s.tick < 60) for (const e of step(s, [])) if (e.type === 'reserve') seen.push(e.tick);
    expect(seen).toEqual([50]);
  });
  it('マスがふさがっていれば、空いた刻みに現れる。片方が呼べなくても、もう片方は現れる', () => {
    // 陣営0の左の端（列 0）の行 8〜15 をふさぐ。行 8 の部隊だけが前進して離れる
    const mine = [p('hq', 6, 15, 'hold'), p('infantry', 0, 8, 'advance'), ...[9, 10, 11, 12, 13, 14, 15].map((r) => p('infantry', 0, r, 'hold'))];
    const s = make({
      field: openField(),
      armies: [mine, [p('hq', 6, 0, 'hold'), p('infantry', 6, 1, 'hold')]],
      seed: 1,
      maxTicks: 1800,
      timeout: 'compare',
      stalemate: false,
      reserves: [cav, cav],
      scriptedReserves: [{ tick: 50, side: 0, from: 'left' }, { tick: 50, side: 1, from: 'left' }],
    });
    // 行 8 の歩兵を、遊軍が出られない位置（行 8 の中）に引き戻しておく
    const blocker = s.units[1]!;
    const seen: Record<number, number> = {};
    let firstFree = -1;
    while (s.tick < 400 && seen[0] === undefined) {
      if (s.tick < 50) {
        blocker.x = 0.5;
        blocker.y = 8.5;
      }
      if (s.tick >= 50 && firstFree < 0 && canSummon(s, 0, 'left').ok) firstFree = s.tick;
      for (const e of step(s, [])) if (e.type === 'reserve') seen[e.side] = e.tick;
    }
    expect(seen[1]).toBe(50);
    expect(firstFree).toBeGreaterThan(50);
    expect(seen[0]).toBe(firstFree);
  });
  it('人の入力で先に呼ばれたら、予定は使わない', () => {
    const s = make(quietSetup([cav, null], 16, { scriptedReserves: [{ tick: 100, side: 0, from: 'right' }] }));
    stepTo(s, 60);
    step(s, [], [{ side: 0, from: 'left' }]);
    let n = 0;
    while (s.tick < 200) for (const e of step(s, [])) if (e.type === 'reserve') n++;
    expect(n).toBe(0);
    expect(s.units[s.units.length - 1]!.wing).toBe('left');
  });
});

describe('R10 隠す情報', () => {
  const variants: (ReserveSetup | null)[] = [null, { kind: 'cavalry', stance: 'advance' }, { kind: 'archer', stance: 'hold' }];
  for (const hider of [1, 0] as const) {
    it(`陣営${hider}の遊軍だけを変えた3つの戦いで、呼ぶ前の相手の場面が全刻みで一致する`, () => {
      const viewer: Side = hider === 0 ? 1 : 0;
      const runs = variants.map((r) => {
        const base = matchupSetup('line', 'scale', 9);
        const armies = base.armies.map((a, i) => (i === hider ? a.slice(0, -1) : a)) as BattleSetup['armies'];
        const s = make({
          ...base,
          armies,
          ...(r ? { reserves: (hider === 0 ? [r, null] : [null, r]) as NonNullable<BattleSetup['reserves']>, scriptedReserves: [{ tick: 300, side: hider, from: 'left' as const }] } : {}),
        });
        const views: string[] = [];
        while (!s.outcome && s.tick < 300) {
          views.push(JSON.stringify(viewFor(s, viewer)));
          step(s, []);
        }
        return { s, views };
      });
      expect(runs[0]!.views.length).toBe(300);
      expect(runs[1]!.views).toEqual(runs[0]!.views);
      expect(runs[2]!.views).toEqual(runs[0]!.views);
      // 遊軍のない戦いの場面には reserve の項目がない。自分の遊軍は自分にだけ見える
      expect('reserve' in viewFor(runs[0]!.s, hider)).toBe(false);
      expect(viewFor(runs[1]!.s, hider).reserve?.[hider]).toEqual({ kind: 'cavalry', stance: 'advance', state: 'ready' });
      expect(viewFor(runs[1]!.s, hider).reserve?.[viewer]).toBeNull();
      expect(viewFor(runs[1]!.s, 'both').reserve?.[hider]?.kind).toBe('cavalry');
      // 現れたあとは units に出る
      const s1 = runs[1]!.s;
      const n = s1.units.length;
      step(s1, []);
      expect(s1.units.length).toBe(n + 1);
      expect(viewFor(s1, viewer).units.some((u) => u.id === n && u.side === hider && u.kind === 'cavalry' && u.stance === undefined)).toBe(true);
      expect(viewFor(s1, hider).reserve?.[hider]?.state).toBe('used');
    });
  }
  it('遊軍の waiting・ready・used', () => {
    const s = make(quietSetup([cav, null]));
    expect(viewFor(s, 0).reserve).toEqual([{ kind: 'cavalry', stance: 'advance', state: 'waiting' }, null]);
    expect('reserve' in viewFor(s, 1)).toBe(false);
    stepTo(s, 50);
    expect(viewFor(s, 0).reserve?.[0]?.state).toBe('ready');
    step(s, [], [{ side: 0, from: 'right' }]);
    expect(viewFor(s, 0).reserve?.[0]?.state).toBe('used');
  });
});

describe('R11 古い状態', () => {
  it('reserves の項目を消した状態を step・viewFor・summarize・canSummon に渡しても、落ちずに進む', () => {
    const s = make(matchupSetup('line', 'crane', 2));
    stepTo(s, 60);
    const old = clone(s) as unknown as Record<string, unknown>;
    delete old['reserves'];
    const o = old as unknown as BattleState;
    expect(() => viewFor(o, 0)).not.toThrow();
    expect('reserve' in viewFor(o, 0)).toBe(false);
    expect(summarize(o).unusedReserve).toEqual([null, null]);
    const r = canSummon(o, 0, 'left');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no_reserve');
    expect(() => step(o, [], [{ side: 0, from: 'left' }])).not.toThrow();
    expect(o.reserves).toEqual([null, null]);
    while (!o.outcome) step(o, []);
    // 遊軍のない戦いなので、消さなかった状態と同じに終わる
    while (!s.outcome) step(s, []);
    expect(o).toEqual(s);
  });
});

describe('R12 両軍が同じ刻みに呼ぶ', () => {
  it('どちらも現れ、id は入力の順。同じ入力なら同じ結果', () => {
    const run = (order: ReserveInput[]): BattleState => {
      const s = make({ ...matchupSetup('line', 'line', 6), armies: matchupSetup('line', 'line', 6).armies.map((a) => a.slice(0, -1)) as BattleSetup['armies'], reserves: [cav, cav] });
      stepTo(s, 80);
      step(s, [], order);
      while (!s.outcome) step(s, []);
      return s;
    };
    const ab: ReserveInput[] = [{ side: 0, from: 'left' }, { side: 1, from: 'left' }];
    const ba: ReserveInput[] = [{ side: 1, from: 'left' }, { side: 0, from: 'left' }];
    const x = run(ab);
    const y = run(ab);
    expect(JSON.stringify(y)).toBe(JSON.stringify(x));
    expect(x.reserves[0]?.unit).toBe(x.reserves[1]!.unit! - 1);
    const z = run(ba);
    expect(z.reserves[1]?.unit).toBe(z.reserves[0]!.unit! - 1);
    // 両軍の現れた位置は、戦場を 180° 回すと重なる
    const u0 = x.units[x.reserves[0]!.unit!]!;
    const u1 = x.units[x.reserves[1]!.unit!]!;
    expect(u0.home.x + u1.home.x).toBe(12);
    expect(u0.home.y + u1.home.y).toBe(16);
  });
  it('予定された遊軍どうしでも、陣営0・陣営1の順に1つずつ現れ、先に現れた部隊があとの部隊のマスの判定に入る', () => {
    const s = make(quietSetup([cav, cav], 16, { scriptedReserves: [{ tick: 50, side: 1, from: 'left' }, { tick: 50, side: 0, from: 'left' }] }));
    stepTo(s, 50);
    const ev = step(s, []);
    expect(ev.filter((e) => e.type === 'reserve').map((e) => (e.type === 'reserve' ? e.side : -1))).toEqual([0, 1]);
  });
});
