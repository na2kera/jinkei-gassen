// 地形の倍率と決まりを、小さな場面でじかに確かめる（design §3.8）。勝ち負けではなく、値を見る。
// 場面：戦場全体を両陣営の配置エリアにした 12 × 16 の戦場で、地形を置いたマスだけを変える。
// 損害は、同じ種で「平地の同じ場面」と比べる（ばらつきの乱数が同じになるので、比がそのまま地形の倍率になる）。
import { describe, expect, it } from 'vitest';
import { canOrder, createBattle, KIND_STATS, remainingRatio, step, type BattleState, type Kind, type Terrain } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { castleField, castleSetup, openTerrainField } from '../sim/terrain-scenes.ts';
import { face, p, place } from './helpers.ts';

type Cells = [number, number, Terrain][];

function scene(cells: Cells, a: Kind, d: Kind): BattleState {
  // id 0：攻め手（陣営0）、id 1：遠くの予備（陣営0）、id 2：受け手（陣営1）、id 3：遠くの予備（陣営1）
  const r = createBattle({
    field: openTerrainField(cells),
    armies: [[p(a, 0, 15, 'hold'), p('infantry', 0, 14, 'hold')], [p(d, 11, 0, 'hold'), p('infantry', 11, 1, 'hold')]],
    seed: 3,
    maxTicks: 1800,
    timeout: 'compare',
    requireHq: false,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/**
 * 受け手は (5.5, 8.5)（マス (5,8)）で、陣営1の前 (0, 1) を向く。攻め手は、受け手の向きから angle 度の方向に dist だけ離して置く。
 * 1刻み進めて、受け手が失った兵数を返す
 */
function hit(cells: Cells, o: { a?: Kind; d?: Kind; angle?: number; dist?: number } = {}): number {
  const s = scene(cells, o.a ?? 'infantry', o.d ?? 'infantry');
  place(s, 2, 5.5, 8.5);
  face(s, 2, 0, 1);
  const ang = ((o.angle ?? 0) * Math.PI) / 180;
  const dd = o.dist ?? 1.0;
  place(s, 0, 5.5 + Math.sin(ang) * dd, 8.5 + Math.cos(ang) * dd);
  face(s, 0, -Math.sin(ang), -Math.cos(ang));
  s.units[0]!.target = 2;
  s.units[2]!.target = 0;
  const m0 = s.units[2]!.men;
  step(s, []);
  return m0 - s.units[2]!.men;
}

const D: [number, number] = [5, 8]; // 受け手のマス
const A: [number, number] = [5, 9]; // 正面 1.0 の攻め手のマス
const cell = (c: [number, number], t: Terrain): [number, number, Terrain] => [c[0], c[1], t];

describe('損害の倍率（§3.8 の表）', () => {
  const plain = hit([]);
  it('攻める側が丘の上・受ける側が丘の外：近接 1.2', () => {
    expect(hit([cell(A, 'hill')]) / plain).toBeCloseTo(T.hillAttackMult, 9);
  });
  it('攻める側が丘の外・受ける側が丘の上：近接 0.85', () => {
    expect(hit([cell(D, 'hill')]) / plain).toBeCloseTo(T.hillDefendMult, 9);
  });
  it('両方が丘の上なら、丘の倍率はかからない', () => {
    expect(hit([cell(A, 'hill'), cell(D, 'hill')]) / plain).toBeCloseTo(1, 9);
  });
  it('攻める側が川の中：近接 0.7。受ける側が川の中：近接 1.3', () => {
    expect(hit([cell(A, 'river')]) / plain).toBeCloseTo(T.riverAttackMult, 9);
    expect(hit([cell(D, 'river')]) / plain).toBeCloseTo(T.riverTakenMult, 9);
  });
  it('川の中から丘の上へは 0.7 × 0.85、丘の上から川の中へは 1.2 × 1.3', () => {
    expect(hit([cell(A, 'river'), cell(D, 'hill')]) / plain).toBeCloseTo(T.riverAttackMult * T.hillDefendMult, 9);
    expect(hit([cell(A, 'hill'), cell(D, 'river')]) / plain).toBeCloseTo(T.hillAttackMult * T.riverTakenMult, 9);
  });
  it('受ける側が森の中：近接にはかからない', () => {
    expect(hit([cell(D, 'forest')]) / plain).toBeCloseTo(1, 9);
  });
  it('柵：受ける側が柵のマス、攻める側が柵の外で正面にいる：近接 0.55', () => {
    expect(hit([cell(D, 'fence')]) / plain).toBeCloseTo(T.fenceMeleeMult, 9);
  });
  it('柵：側面・背面からはかからない。攻める側も柵のマスにいるときもかからない', () => {
    expect(hit([cell(D, 'fence')], { angle: 90 }) / hit([], { angle: 90 })).toBeCloseTo(1, 9);
    expect(hit([cell(D, 'fence')], { angle: 180 }) / hit([], { angle: 180 })).toBeCloseTo(1, 9);
    expect(hit([cell(D, 'fence'), cell(A, 'fence')]) / plain).toBeCloseTo(1, 9);
  });
  it('盾兵の正面と柵は、両方かける', () => {
    expect(hit([cell(D, 'fence')], { d: 'shield' }) / hit([], { d: 'shield' })).toBeCloseTo(T.fenceMeleeMult, 9);
  });

  // 弓：弓兵は (5.5, 12.5)（マス (5,12)）から、4 マス先の受け手を撃つ
  const shoot = (cells: Cells): number => hit(cells, { a: 'archer', dist: 4 });
  const arrowPlain = shoot([]);
  it('弓：受ける側が川の中 1.3、森の中 0.5、柵の正面 0.5', () => {
    expect(arrowPlain).toBeGreaterThan(0);
    expect(shoot([cell(D, 'river')]) / arrowPlain).toBeCloseTo(T.riverTakenMult, 9);
    expect(shoot([cell(D, 'forest')]) / arrowPlain).toBeCloseTo(T.forestArrowTakenMult, 9);
    expect(shoot([cell(D, 'fence')]) / arrowPlain).toBeCloseTo(T.fenceArrowMult, 9);
  });
  it('弓：丘の上からの弓に 1.2 はかからない。丘の上の受け手にも 0.85 はかからない。弓兵が川の中でも 0.7 はかからない', () => {
    expect(shoot([[5, 12, 'hill']]) / arrowPlain).toBeCloseTo(1, 9);
    expect(shoot([cell(D, 'hill')]) / arrowPlain).toBeCloseTo(1, 9);
    expect(shoot([[5, 12, 'river']]) / arrowPlain).toBeCloseTo(1, 9);
  });
});

describe('速さの倍率（1刻みに動く距離）', () => {
  // 陣営0の部隊（前進）を (5,12) に、遠くに陣営1の敵を1つ置き、1刻み進める。敵は真上なので、まっすぐ y が減る向きに進む
  const moved = (kind: Kind, t: Terrain | null): number => {
    const r = createBattle({
      field: openTerrainField(t ? [[5, 12, t]] : []),
      armies: [[p(kind, 5, 12, 'advance')], [p('infantry', 5, 0, 'hold')]],
      seed: 1,
      maxTicks: 1800,
      timeout: 'compare',
      requireHq: false,
    });
    if (!r.ok) throw new Error(r.error.message);
    step(r.value, []);
    return 12.5 - r.value.units[0]!.y;
  };
  it('丘 0.85、森 0.8（騎兵は 0.5）、川 0.5、柵 0.4', () => {
    expect(moved('infantry', null)).toBeCloseTo(KIND_STATS.infantry.speed * 0.1, 9);
    expect(moved('infantry', 'hill') / moved('infantry', null)).toBeCloseTo(T.hillSpeedMult, 9);
    expect(moved('infantry', 'forest') / moved('infantry', null)).toBeCloseTo(T.forestSpeedMult, 9);
    expect(moved('cavalry', 'forest') / moved('cavalry', null)).toBeCloseTo(T.forestCavalrySpeedMult, 9);
    expect(moved('shield', 'forest') / moved('shield', null)).toBeCloseTo(T.forestSpeedMult, 9);
    expect(moved('infantry', 'river') / moved('infantry', null)).toBeCloseTo(T.riverSpeedMult, 9);
    expect(moved('cavalry', 'river') / moved('cavalry', null)).toBeCloseTo(T.riverSpeedMult, 9);
    expect(moved('infantry', 'fence') / moved('infantry', null)).toBeCloseTo(T.fenceSpeedMult, 9);
  });
});

describe('弓の届く距離', () => {
  it('丘の上の弓兵は、距離 + 1.5 の敵を撃つ。丘の外の弓兵は撃たない', () => {
    const d = T.archerRange + 1.2; // 届く距離 + 1.5 より内側、届く距離より外側
    const run = (hill: boolean): number => {
      const r = createBattle({
        field: openTerrainField(hill ? [[5, 12, 'hill']] : []),
        armies: [[p('archer', 5, 12, 'hold')], [p('infantry', 5, 0, 'hold')]],
        seed: 1,
        maxTicks: 1800,
        timeout: 'compare',
        requireHq: false,
      });
      if (!r.ok) throw new Error(r.error.message);
      place(r.value, 1, 5.5, 12.5 - d);
      step(r.value, []);
      return 100 - r.value.units[1]!.men;
    };
    expect(run(true)).toBeGreaterThan(0);
    expect(run(false)).toBe(0);
  });
});

describe('騎兵の突入が起きない地形', () => {
  /**
   * 騎兵（陣営0、前進）を (5,12) から、受け手（陣営1、守備）の (5,8) へ当てる。受け手は騎兵の方へ向くので、正面から当たる。
   * side が true なら、受け手を正面の (5,7) から歩兵（陣営0）が押さえ、騎兵は横の (11,8) から当たる（側面）
   */
  const impacts = (cells: Cells, side = false): number => {
    const r = createBattle({
      field: openTerrainField(cells),
      armies: [
        side ? [p('cavalry', 11, 8, 'advance'), p('infantry', 5, 7, 'hold')] : [p('cavalry', 5, 12, 'advance')],
        [p('infantry', 5, 8, 'hold'), p('infantry', 0, 0, 'hold')],
      ],
      seed: 1,
      maxTicks: 1800,
      timeout: 'compare',
      requireHq: false,
    });
    if (!r.ok) throw new Error(r.error.message);
    let n = 0;
    for (let i = 0; i < 60; i++) for (const e of step(r.value, [])) if (e.type === 'impact') n++;
    return n;
  };
  it('平地では起きる（比べるための確認）', () => {
    expect(impacts([])).toBe(1);
    expect(impacts([], true)).toBe(1);
  });
  it('受ける側が森の中・攻める側が森の中・攻める側が川の中・柵の正面では起きない', () => {
    expect(impacts([cell(D, 'forest')])).toBe(0);
    expect(impacts([[5, 9, 'forest'], [5, 10, 'forest'], [5, 11, 'forest'], [5, 12, 'forest']])).toBe(0);
    expect(impacts([[5, 9, 'river'], [5, 10, 'river'], [5, 11, 'river'], [5, 12, 'river']])).toBe(0);
    expect(impacts([cell(D, 'fence')])).toBe(0);
  });
  it('柵の側面からは起きる', () => {
    expect(impacts([cell(D, 'fence')], true)).toBe(1);
  });
});

describe('地形の判定は、刻みの初めの位置で行う', () => {
  it('その刻みに川から出た部隊は、その刻みの損害では川の中として扱われる', () => {
    // 川は行 9 だけ。受け手（陣営0）は (5.5, 9.97)（川の中、川の端のすぐ手前）で敗走中。この刻みに +y へ逃げて川から出る。
    // 攻め手（陣営1）は (5.5, 8.97)（川の外）で、受け手を狙っていて、近接の距離にいる
    const run = (river: boolean): { loss: number; y: number } => {
      const r = createBattle({
        field: openTerrainField(river ? Array.from({ length: 12 }, (_, c) => [c, 9, 'river'] as [number, number, Terrain]) : []),
        armies: [[p('infantry', 5, 9, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 8, 'hold')]],
        seed: 1,
        maxTicks: 1800,
        timeout: 'compare',
        requireHq: false,
      });
      if (!r.ok) throw new Error(r.error.message);
      const s = r.value;
      place(s, 0, 5.5, 9.97);
      place(s, 2, 5.5, 8.97);
      s.units[0]!.status = 'routing';
      s.units[0]!.routTick = -1;
      s.units[2]!.target = 0;
      step(s, []);
      return { loss: 100 - s.units[0]!.men, y: s.units[0]!.y };
    };
    const a = run(true);
    const b = run(false);
    expect(a.y).toBeGreaterThan(10); // この刻みに川から出た
    expect(a.loss / b.loss).toBeCloseTo(T.riverTakenMult, 9);
  });
});

describe('門', () => {
  /** T5 の戦場（城壁は行 5、門は (5,5)）。陣営0の部隊を門の正面・後ろなどに置き直して確かめる */
  function gateScene(): BattleState {
    const r = createBattle(castleSetup('advance', 1));
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  }
  const gateId = (s: BattleState): number => s.gate!.id;

  it('門は units の最後に、陣営1の部隊として立つ。耐久は 150、動かない', () => {
    const s = gateScene();
    const g = s.units[gateId(s)]!;
    expect(g.kind).toBe('gate');
    expect(g.men).toBe(T.gateMen);
    expect(gateId(s)).toBe(s.units.length - 1);
    for (let i = 0; i < 30; i++) step(s, []);
    expect(g.x).toBe(5.5);
    expect(g.y).toBe(5.5);
    expect(g.morale).toBe(100);
  });
  it('門への損害は近接だけで、向きと受ける側の倍率はかからない（正面からも背面からも同じ）。弓と突入では減らない', () => {
    // 陣営0の歩兵 1 を門の下（城壁の外）0.95 先に置き、門を狙わせる。門の向きを、攻め手の方（正面）と反対（背面）に変えて比べる
    const dmg = (gateFacing: 'toward' | 'away'): number => {
      const s = gateScene();
      place(s, 1, 5.5, 6.45);
      s.units[1]!.target = gateId(s);
      face(s, gateId(s), 0, gateFacing === 'toward' ? 1 : -1);
      // ほかの陣営0の部隊は遠くへ
      for (const id of [2, 3, 4, 5, 6]) place(s, id, 1 + id, 15.5);
      const m0 = s.units[gateId(s)]!.men;
      step(s, []);
      return m0 - s.units[gateId(s)]!.men;
    };
    const below = dmg('toward');
    expect(below / (KIND_STATS.infantry.melee * 0.1)).toBeGreaterThanOrEqual(0.9);
    expect(below / (KIND_STATS.infantry.melee * 0.1)).toBeLessThanOrEqual(1.1);
    expect(dmg('away')).toBeCloseTo(below, 9);
    // 弓兵：門の正面 3 マス先に陣営0の弓兵だけ。門を狙わない
    const r = createBattle({ ...castleSetup('advance', 1), armies: [[p('hq', 5, 14, 'hold'), p('archer', 5, 10, 'hold')], [p('hq', 0, 0, 'hold'), p('infantry', 11, 0, 'hold')]] });
    if (!r.ok) throw new Error(r.error.message);
    const s = r.value;
    place(s, 1, 5.5, 8.5);
    for (let i = 0; i < 30; i++) step(s, []);
    expect(s.units[gateId(s)]!.men).toBe(T.gateMen);
    // 騎兵：助走をつけて門に当たっても、突入は起きない
    const c = createBattle({ ...castleSetup('advance', 1), armies: [[p('hq', 0, 14, 'hold'), p('cavalry', 5, 11, 'advance')], [p('hq', 0, 0, 'hold'), p('infantry', 11, 0, 'hold')]] });
    if (!c.ok) throw new Error(c.error.message);
    let impacts = 0;
    for (let i = 0; i < 60; i++) for (const e of step(c.value, [])) if (e.type === 'impact') impacts++;
    expect(impacts).toBe(0);
    expect(c.value.units[gateId(c.value)]!.men).toBeLessThan(T.gateMen);
  });
  it('門が全滅しても、両軍の士気は動かない。最初に消えた部隊・敗走させた数にも数えない', () => {
    const s = gateScene();
    place(s, 1, 5.5, 6.45);
    s.units[1]!.target = gateId(s);
    s.units[gateId(s)]!.men = 0.01;
    // 門の近くの部隊（陣営0の歩兵 2、陣営1の歩兵 8）の士気を 50 にし、敵が近くにいて回復しない状況にする
    for (const id of [2, 8]) s.units[id]!.morale = 50;
    place(s, 2, 4.5, 6.6);
    place(s, 8, 5.5, 4.5);
    const ev = step(s, []);
    expect(ev).toContainEqual({ type: 'destroyed', tick: 0, unit: gateId(s) });
    expect(s.brokenLastTick).toEqual([]);
    expect(s.firstBroken).toEqual([null, null]);
    expect(s.units[1]!.stats.routsCaused).toBe(0);
    const m2 = s.units[2]!.morale;
    const m8 = s.units[8]!.morale;
    step(s, []);
    // 次の刻みにも、崩れの影響（味方の全滅 −6、敵の崩れ +3 など）は入らない
    expect(s.units[2]!.morale).toBeGreaterThanOrEqual(m2 - 1e-9);
    expect(s.units[8]!.morale).toBeGreaterThanOrEqual(m8 - 1e-9);
  });
  it('門が全滅した刻みには通れず、次の刻みから通れる', () => {
    const s = gateScene();
    // 歩兵 1 を門の正面に。門の耐久を 0.01 にして、刻み 0 で破る
    place(s, 1, 5.5, 6.45);
    s.units[1]!.target = gateId(s);
    s.units[gateId(s)]!.men = 0.01;
    for (const id of [2, 3, 4, 5, 6]) place(s, id, 1 + id, 15.5);
    step(s, []);
    expect(s.units[gateId(s)]!.status).toBe('gone');
    // 刻み 0 の動きは、門が立っていた刻みの初めの状態で決まるので、まだ切れ目に入っていない
    expect(s.units[1]!.y).toBeGreaterThanOrEqual(6.45 - 1e-9);
    let entered = -1;
    for (let i = 0; i < 40 && entered < 0; i++) {
      step(s, []);
      if (s.units[1]!.y < 6) entered = s.tick;
    }
    expect(entered).toBeGreaterThan(1);
    for (let i = 0; i < 60; i++) step(s, []);
    expect(s.units[1]!.y).toBeLessThan(5);
  });
  it('門のそばの弓兵は、撃てる敵がいれば門を殴らずに撃つ（兵種ごとの違いが方針より先）。撃てる敵がいなければ門と戦う', () => {
    // 弓兵を門 (5.5, 5.5) の 1.4 下に置く。城壁の内側の歩兵 (4.5, 3.5) までは約 3.5 で、撃てる距離に入る
    const r = createBattle({ ...castleSetup('advance', 1), armies: [[p('hq', 5, 14, 'hold'), p('archer', 5, 10, 'advance')], [p('hq', 0, 0, 'hold'), p('infantry', 4, 3, 'hold')]] });
    if (!r.ok) throw new Error(r.error.message);
    const s = r.value;
    const g = s.gate!.id;
    place(s, 1, 5.5, 6.9);
    s.units[1]!.target = g;
    expect(Math.hypot(0, 6.9 - 5.5)).toBeLessThanOrEqual(T.gateReach);
    step(s, []);
    expect(s.units[1]!.attacking).toBe(3);
    expect(s.units[g]!.men).toBe(T.gateMen);
    // 内側の歩兵がいなくなれば（本陣は撃てる距離の外）、門と戦う
    s.units[3]!.status = 'gone';
    step(s, []);
    expect(s.units[1]!.attacking).toBe(g);
  });
  it('残った兵の割合・開戦時の兵数に、門を数えない', () => {
    const s = gateScene();
    const initial1 = s.units.filter((u) => u.side === 1 && u.kind !== 'gate').reduce((a, u) => a + u.men, 0);
    expect(s.initialMen[1]).toBe(initial1);
    s.units[gateId(s)]!.status = 'gone';
    expect(remainingRatio(s, 1)).toBe(1);
  });
  it('門には号令がかからない（門しかいない翼への号令は受け付けない）', () => {
    const r = createBattle({ ...castleSetup('advance', 1), armies: [[p('hq', 5, 14, 'hold'), p('infantry', 5, 10, 'advance')], [p('hq', 0, 0, 'hold'), p('infantry', 11, 0, 'hold')]] });
    if (!r.ok) throw new Error(r.error.message);
    const s = r.value;
    // 全軍への号令：ほかの部隊にはかかるが、門にはかからない
    step(s, [{ side: 1, target: 'all', kind: 'brace' }]);
    expect(s.units[gateId(s)]!.order).toBeNull();
    expect(s.units[3]!.order).not.toBeNull();
    // 門 (5, 5) は陣営1の中央の翼。中央には門しかいないので、中央への号令は受け付けない（号令の回数も減らない）
    expect(s.units[gateId(s)]!.wing).toBe('center');
    expect(s.units.filter((u) => u.side === 1 && u.kind !== 'gate').every((u) => u.wing !== 'center')).toBe(true);
    const used = s.ordersUsed[1];
    const c = canOrder(s, 1, 'center', 'brace');
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.code).toBe('no_target_units');
    const ev = step(s, [{ side: 1, target: 'center', kind: 'brace' }]);
    expect(ev.some((e) => e.type === 'order')).toBe(false);
    expect(s.ordersUsed[1]).toBe(used);
    expect(s.units[gateId(s)]!.order).toBeNull();
  });
});

describe('城壁と門の形の検査（createBattle）', () => {
  const base = castleSetup('advance', 1);
  const withCells = (fn: (t: Terrain[]) => void): typeof base => {
    const f = castleField();
    fn(f.terrain);
    return { ...base, field: f };
  };
  const code = (setup: typeof base): string | null => {
    const r = createBattle(setup);
    return r.ok ? null : r.error.code + ':' + r.error.message;
  };
  it('正しい形は通る', () => {
    expect(code(base)).toBeNull();
  });
  it('城壁が2行・切れ目が2つ・切れ目がない・端の行は通らない', () => {
    expect(code(withCells((t) => (t[7 * 12 + 3] = 'wall')))).toMatch(/invalid_field/);
    expect(code(withCells((t) => (t[5 * 12 + 2] = 'plain')))).toMatch(/invalid_field/);
    expect(code(withCells((t) => (t[5 * 12 + 5] = 'wall')))).toMatch(/invalid_field/);
    const top = castleField();
    for (let c = 0; c < 12; c++) top.terrain[5 * 12 + c] = 'plain';
    for (let c = 0; c < 12; c++) if (c !== 5) top.terrain[c] = 'wall';
    expect(code({ ...base, field: top, gate: { side: 1, col: 5, row: 0, win: false } })).toMatch(/invalid_field/);
  });
  it('門が切れ目にない・城壁があるのに門がない・城壁がないのに門がある は通らない', () => {
    expect(code({ ...base, gate: { side: 1, col: 4, row: 5, win: false } })).toMatch(/invalid_setup/);
    const { gate: _g, ...noGate } = base;
    expect(code(noGate as typeof base)).toMatch(/invalid_setup/);
    const plain = castleField();
    for (let c = 0; c < 12; c++) plain.terrain[5 * 12 + c] = 'plain';
    expect(code({ ...base, field: plain })).toMatch(/invalid_setup/);
  });
  it('城壁のマスに部隊を置けない。両軍のマスは重ならない', () => {
    const r = createBattle({ ...base, armies: [base.armies[0], [...base.armies[1], p('infantry', 3, 5, 'hold')]] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.armyErrors?.map((e) => e.code)).toContain('on_wall');
    const o = createBattle({ field: openTerrainField([]), seed: 1, maxTicks: 10, timeout: 'compare', armies: [[p('hq', 5, 10, 'hold'), p('infantry', 1, 10)], [p('hq', 5, 10, 'hold'), p('infantry', 1, 3)]] });
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error.armyErrors?.map((e) => e.code)).toContain('overlap');
  });
  it('陣営0の配置エリアには城壁を置けない', () => {
    const f = castleField();
    for (let c = 0; c < 12; c++) f.terrain[5 * 12 + c] = 'plain';
    for (let c = 0; c < 12; c++) if (c !== 5) f.terrain[11 * 12 + c] = 'wall';
    expect(code({ ...base, field: f, gate: { side: 1, col: 5, row: 11, win: false } })).toMatch(/invalid_field/);
  });
  it('skipZoneCheck の陣営は、配置エリアの外にも置ける（戦場の中なら）', () => {
    const enemy = [p('hq', 5, 1, 'hold'), p('infantry', 5, 8, 'hold')];
    expect(createBattle({ ...base, armies: [base.armies[0], enemy] }).ok).toBe(false);
    expect(createBattle({ ...base, armies: [base.armies[0], enemy], skipZoneCheck: 1 }).ok).toBe(true);
    expect(createBattle({ ...base, armies: [base.armies[0], [...enemy, p('infantry', 5, 16, 'hold')]], skipZoneCheck: 1 }).ok).toBe(false);
  });
});

describe('振り返りに門を出さない', () => {
  it('門のある戦場でも、summarize の units に門は入らず、各部隊に翼がある', async () => {
    const { summarize } = await import('../src/index.ts');
    const r = createBattle(castleSetup('advance', 1));
    if (!r.ok) throw new Error();
    const sum = summarize(r.value);
    expect(sum.units.some((u) => u.id === r.value.gate!.id)).toBe(false);
    expect(sum.units.every((u) => typeof u.wing === 'string')).toBe(true);
  });
});

describe('本陣狙いが、詰まった味方と回り合って下がり続けない', () => {
  it('城の場面（全部が本陣狙い）：陣営0の部隊は、どの刻みでも最初の位置より 1 マス以上うしろへ下がらない', () => {
    // 門の前で味方が詰まる。保った回る側の接線が後ろ向きのまま味方の周りを回ると、門から 3 マスほど下がっていた
    for (const seed of [1, 2, 3]) {
      const r = createBattle(castleSetup('hunt', seed));
      if (!r.ok) throw new Error(r.error.message);
      const s = r.value;
      const y0 = s.units.map((u) => u.y);
      let worst = 0;
      while (!s.outcome && s.tick < 1200) {
        step(s, []);
        for (const u of s.units) {
          if (u.side !== 0 || u.kind === 'hq' || u.status !== 'active') continue;
          worst = Math.max(worst, u.y - (y0[u.id] as number));
        }
      }
      expect(worst, `種 ${seed}`).toBeLessThan(1);
    }
  });
});

describe('門を攻める距離と、門が破れたあとの城壁', () => {
  const W = 12;
  const cell = (s: BattleState, c: number, r: number): Terrain => s.field.terrain[r * W + c]!;
  function scene(stance: 'advance' | 'hunt' = 'advance', seed = 1): BattleState {
    const r = createBattle(castleSetup(stance, seed));
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  }

  it('門は、近接の距離（0.95）より遠い 1.6 まで打てる。門の前に横に並んだ3部隊が同じ刻みに門を打つ', () => {
    const s = scene();
    const g = s.gate!.id;
    // 門 (5.5, 5.5) の下に、歩兵 3 を横に並べる（真ん中は 1.0 先、両脇は斜めで約 1.41 先）
    place(s, 1, 5.5, 6.5);
    place(s, 2, 4.5, 6.5);
    place(s, 3, 6.5, 6.5);
    for (const id of [1, 2, 3]) s.units[id]!.target = g;
    for (const id of [4, 5, 6]) place(s, id, id - 2, 15.5);
    expect(Math.hypot(1, 1)).toBeLessThanOrEqual(T.gateReach);
    const m0 = s.units[g]!.men;
    step(s, []);
    for (const id of [1, 2, 3]) expect(s.units[id]!.attacking, `部隊 ${id}`).toBe(g);
    expect(s.units[g]!.men).toBeLessThan(m0);
    // 1.6 より遠いと打たない
    const t = scene();
    place(t, 1, 5.5, 7.2);
    t.units[1]!.target = t.gate!.id;
    for (const id of [2, 3, 4, 5, 6]) place(t, id, id + 1, 15.5);
    const d0 = Math.hypot(0, 7.2 - 5.5);
    expect(d0).toBeGreaterThan(T.gateReach);
    step(t, []);
    expect(t.units[1]!.attacking).toBeNull();
  });
  it('ふつうの場面でも、門を同時に打つ部隊が2つ以上になる刻みがある', () => {
    const s = scene();
    const g = s.gate!.id;
    let most = 0;
    while (!s.outcome && s.units[g]!.status === 'active' && s.tick < 1800) {
      step(s, []);
      most = Math.max(most, s.units.filter((u) => u.attacking === g).length);
    }
    expect(most).toBeGreaterThanOrEqual(2);
  });
  it('門が全滅した刻みに、門の左右1マスずつの城壁が平地になる。ほかの城壁はそのまま', () => {
    const s = scene();
    const g = s.gate!.id;
    const { col, row } = s.gate!;
    place(s, 1, 5.5, 6.45);
    s.units[1]!.target = g;
    s.units[g]!.men = 0.01;
    for (const id of [2, 3, 4, 5, 6]) place(s, id, 1 + id, 15.5);
    expect(cell(s, col - 1, row)).toBe('wall');
    expect(cell(s, col + 1, row)).toBe('wall');
    step(s, []);
    expect(s.units[g]!.status).toBe('gone');
    expect(cell(s, col - 1, row)).toBe('plain');
    expect(cell(s, col + 1, row)).toBe('plain');
    expect(cell(s, col, row)).toBe('plain');
    for (let c = 0; c < W; c++) if (Math.abs(c - col) > 1) expect(cell(s, c, row), `列 ${c}`).toBe('wall');
  });
  it('崩れたマスに部隊が入れる（次の刻みから押し出されない）。崩れる前は同じ位置から押し出される', () => {
    // 門の左隣のマスの中心に、守備の歩兵 2 を置く。崩れる前は城壁から押し出され、崩れたあとはそのまま立てる
    const stand = (collapse: boolean): { x: number; y: number } => {
      const s = scene();
      const g = s.gate!.id;
      const { col, row } = s.gate!;
      for (const id of [3, 4, 5, 6]) place(s, id, id - 2, 15.5);
      if (collapse) {
        place(s, 1, col + 0.5, 6.45);
        s.units[1]!.target = g;
        s.units[g]!.men = 0.01;
        place(s, 2, 1.5, 12.5);
        step(s, []);
        expect(s.units[g]!.status).toBe('gone');
      }
      s.units[2]!.stance = 'hold';
      s.units[2]!.home = { x: col - 0.5, y: row + 0.5 };
      place(s, 2, col - 0.5, row + 0.5);
      step(s, []);
      return { x: s.units[2]!.x, y: s.units[2]!.y };
    };
    const before = stand(false);
    expect(before.y < 5 - T.wallMargin + 1e-9 || before.y > 6 + T.wallMargin - 1e-9).toBe(true);
    const after = stand(true);
    expect(Math.floor(after.x)).toBe(4);
    expect(Math.floor(after.y)).toBe(5);
  });
  it('門が破れたあとは、崩れた3マスのうち自分の x にいちばん近い列を通る。両脇の真下の部隊は、真ん中を取り合わずにそれぞれの列から入る', () => {
    const s = scene();
    const g = s.gate!.id;
    const { col, row } = s.gate!;
    place(s, 1, col + 0.5, 6.45);
    s.units[1]!.target = g;
    s.units[g]!.men = 0.01;
    place(s, 2, col - 0.5, 6.5);
    place(s, 3, col + 1.5, 6.5);
    for (const id of [4, 5, 6]) place(s, id, id - 2, 15.5);
    step(s, []);
    expect(s.units[g]!.status).toBe('gone');
    const passedAt: Record<number, number> = {};
    const colWhenPassing: Record<number, number> = {};
    for (let i = 0; i < 60 && !s.outcome; i++) {
      step(s, []);
      for (const id of [2, 3]) {
        const u = s.units[id]!;
        if (passedAt[id] === undefined && u.y < row + 0.5) {
          passedAt[id] = s.tick;
          colWhenPassing[id] = Math.floor(u.x);
        }
      }
    }
    // どちらも 2 秒ほどで城壁の行の真ん中を越え、越えたのはそれぞれ自分の真上の列
    expect(passedAt[2]).toBeLessThan(30);
    expect(passedAt[3]).toBeLessThan(30);
    expect(colWhenPassing[2]).toBe(col - 1);
    expect(colWhenPassing[3]).toBe(col + 1);
  });
  it('崩れた城壁は JSON にして戻しても同じで、続きも同じに進む', () => {
    const s = scene();
    const g = s.gate!.id;
    while (!s.outcome && s.units[g]!.status === 'active' && s.tick < 1800) step(s, []);
    expect(s.units[g]!.status).toBe('gone');
    const { col, row } = s.gate!;
    const t: BattleState = JSON.parse(JSON.stringify(s));
    expect(cell(t, col - 1, row)).toBe('plain');
    expect(cell(t, col + 1, row)).toBe('plain');
    for (let i = 0; i < 300 && !s.outcome; i++) {
      step(s, []);
      step(t, []);
    }
    expect(JSON.stringify(t)).toBe(JSON.stringify(s));
  });
});
