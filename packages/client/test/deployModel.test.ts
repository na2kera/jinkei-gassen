// 配置の「引っぱって置く」操作の計算（design §15.4〜§15.6、§15.10）。Phaser なしで確かめる。
// 離した先ごとの結果の表、予算と部隊数、押す／引っぱるの見分け、本陣の初めのマスと補い方、ひな形、陣形の呼び出し。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultStance,
  PVP_MAPS,
  PVP_RULES,
  pvpArmyLimits,
  pvpField,
  STAGES,
  validateArmy,
  type Field,
  type Kind,
  type Placement,
  type ReserveSetup,
  type Stance,
  type Zone,
} from '@jinkei/engine';
import {
  budgetUsed,
  canAdd,
  canSwapReserve,
  dropResult,
  ensureHq,
  hasNonHq,
  hqHomeCell,
  isDrag,
  placeable,
  pvpHeadText,
  releaseAction,
  recallPlan,
  rosterWithoutReserve,
  templateRoster,
  trimToLimits,
  unitCount,
  type DragSource,
  type DropContext,
  type DropTarget,
  type PvpLimits,
} from '../src/scenes/deployModel.ts';

const FIELD: Field = pvpField('plain');
const ZONE: Zone = FIELD.zones[0];
const BACK = ZONE.row + ZONE.height - 1;
const LIM: PvpLimits = { budget: PVP_RULES.budget, costs: PVP_RULES.costs, maxUnits: PVP_RULES.maxUnits };
const HQ: Placement = { kind: 'hq', col: ZONE.col + 3, row: BACK, stance: 'hold' };
const inf = (col: number, row: number, stance: Stance = 'advance'): Placement => ({ kind: 'infantry', col, row, stance });

function check(list: Placement[], reserve: ReserveSetup | null): ReturnType<typeof validateArmy> {
  return validateArmy(list, ZONE, { ...pvpArmyLimits(), reserve });
}

function ctx(list: Placement[], reserve: ReserveSetup | null, over: Partial<DropContext> = {}): DropContext {
  return { list, reserve, reserveShown: true, canPlace: (c) => placeable(FIELD, ZONE, c), stanceOk: () => true, check, ...over };
}

const cell = (col: number, row: number): DropTarget => ({ type: 'cell', col, row });
const HAND: DropTarget = { type: 'hand' };
const SLOT: DropTarget = { type: 'reserve' };
const OUT: DropTarget = { type: 'none' };
const card = (kind: Kind): DragSource => ({ type: 'card', kind });
const unit = (index: number): DragSource => ({ type: 'unit', index });
const RES: DragSource = { type: 'reserve' };

// ---- 押す／引っぱる ----

test('押し始めから 7px では押した、8px では引っぱった', () => {
  assert.equal(isDrag(false, 100, 100, 107, 100), false);
  assert.equal(isDrag(false, 100, 100, 108, 100), true);
  assert.equal(isDrag(false, 100, 100, 100, 92), true);
});

test('動かす出来事なしで、8px 以上離れた所で離したら引っぱり', () => {
  // 離す出来事の座標だけで見分ける（動かす出来事で already が立っていない）
  assert.equal(isDrag(false, 50, 50, 60, 55), true);
});

test('一度 8px を超えてから元の場所に戻して離しても、押したにならない', () => {
  let dragging = isDrag(false, 0, 0, 20, 0);
  assert.equal(dragging, true);
  dragging = isDrag(dragging, 0, 0, 0, 0);
  assert.equal(dragging, true);
});

test('離したとき：動かさずに離せば押した。8px 以上動いたら、引っぱれる元は離した先へ、引っぱれない元（空の遊軍の枠など）は何も起きない', () => {
  // 押し始め (0,0) → 動かす出来事で 100px → 枠の外で離す。空の枠は引っぱれないが、押したには戻さない
  let moved = isDrag(false, 0, 0, 100, 0);
  moved = isDrag(moved, 0, 0, 100, 0);
  assert.equal(releaseAction(moved, false), 'none');
  assert.equal(releaseAction(moved, true), 'drop');
  // 動かす出来事なしで、離した座標だけが 8px 以上離れている
  assert.equal(releaseAction(isDrag(false, 0, 0, 0, 30), false), 'none');
  // 大きく動かしてから元の場所へ戻して離しても、押したにはならない
  assert.equal(releaseAction(isDrag(isDrag(false, 0, 0, 40, 0), 0, 0, 0, 0), false), 'none');
  // 枠の中で動かさずに離した（7px まで）：押した
  assert.equal(releaseAction(isDrag(false, 0, 0, 7, 0), false), 'tap');
  assert.equal(releaseAction(isDrag(false, 0, 0, 7, 0), true), 'tap');
});

// ---- 本陣の初めのマス ----

test('本陣の初めのマスは、15 面と対戦の 4 つの地図で、エリアの中の置けるマス（いちばん後ろの行の中央を先に）', () => {
  const fields: [string, Field][] = [...STAGES.map((s) => [s.id, s.field] as [string, Field]), ...PVP_MAPS.map((m) => [m.id, pvpField(m.id)] as [string, Field])];
  assert.ok(STAGES.length >= 15);
  for (const [id, f] of fields) {
    const z = f.zones[0];
    const c = hqHomeCell(f, z);
    assert.ok(c, id);
    assert.ok(placeable(f, z, c!), id);
  }
  // 幅 8 のエリアでは、いちばん後ろの行の、左から 4 つ目
  assert.deepEqual(hqHomeCell(FIELD, ZONE), { col: ZONE.col + 3, row: BACK });
});

test('初めのマスがふさがっていれば、同じ行の近い列、なければ 1 つ前の行', () => {
  assert.deepEqual(hqHomeCell(FIELD, ZONE, [{ col: ZONE.col + 3, row: BACK }]), { col: ZONE.col + 2, row: BACK });
  const full = Array.from({ length: ZONE.width }, (_, i) => ({ col: ZONE.col + i, row: BACK }));
  assert.deepEqual(hqHomeCell(FIELD, ZONE, full), { col: ZONE.col + 3, row: BACK - 1 });
});

test('城壁のマスには本陣を置かない', () => {
  const terrain = FIELD.terrain.slice();
  terrain[BACK * FIELD.width + ZONE.col + 3] = 'wall';
  const f: Field = { ...FIELD, terrain };
  assert.deepEqual(hqHomeCell(f, ZONE), { col: ZONE.col + 2, row: BACK });
});

test('本陣のない配置には、本陣を足す（ふさがっていれば近い空きマス）。上限を超えたら後ろの部隊を外す', () => {
  const list = [inf(ZONE.col + 3, BACK), inf(ZONE.col, BACK - 1)];
  const out = ensureHq(list, null, FIELD, ZONE, 11);
  assert.equal(out.length, 3);
  assert.deepEqual(out.find((p) => p.kind === 'hq'), { kind: 'hq', col: ZONE.col + 2, row: BACK, stance: 'hold' });
  assert.equal(validateArmy(out, ZONE, pvpArmyLimits()).length, 0);
  // 11 部隊（本陣なし）＋遊軍に本陣を足すと 13 → 後ろの部隊を外して 11 に収める
  const many = Array.from({ length: 11 }, (_, i) => inf(ZONE.col + (i % 8), BACK - 1 - Math.floor(i / 8)));
  const trimmed = ensureHq(many, { kind: 'archer', stance: 'hold' }, FIELD, ZONE, 11);
  assert.equal(trimmed.length + 1, 11);
  assert.ok(trimmed.some((p) => p.kind === 'hq'));
  // 本陣があれば、そのまま
  assert.deepEqual(ensureHq([HQ], null, FIELD, ZONE, 11), [HQ]);
});

// ---- 予算と部隊数 ----

test('置くたびに使った予算が増え、外すと戻る。遊軍も数える。本陣は 0', () => {
  assert.equal(budgetUsed([HQ], null, LIM.costs), 0);
  assert.equal(unitCount([HQ], null), 1);
  const two = [HQ, inf(ZONE.col, BACK - 1)];
  assert.equal(budgetUsed(two, null, LIM.costs), PVP_RULES.costs.infantry);
  const withRes = budgetUsed(two, { kind: 'cavalry', stance: 'flank' }, LIM.costs);
  assert.equal(withRes, PVP_RULES.costs.infantry + PVP_RULES.costs.cavalry);
  assert.equal(unitCount(two, { kind: 'cavalry', stance: 'flank' }), 3);
  assert.equal(pvpHeadText([HQ], null, LIM), '予算 0/24 部隊 1/11');
  assert.equal(pvpHeadText(two, { kind: 'cavalry', stance: 'flank' }, LIM), `予算 ${withRes}/24 部隊 3/11`);
});

test('予算をちょうど使い切っているとき：盤には足せない、安い兵種へは遊軍を入れ替えられる', () => {
  // 騎兵 4 × 5 ＝ 20 ＋ 遊軍の騎兵 4 ＝ 24
  const list = [HQ, ...Array.from({ length: 5 }, (_, i): Placement => ({ kind: 'cavalry', col: ZONE.col + i, row: BACK - 1, stance: 'flank' }))];
  const reserve: ReserveSetup = { kind: 'cavalry', stance: 'flank' };
  assert.equal(budgetUsed(list, reserve, LIM.costs), 24);
  assert.equal(canAdd('infantry', list, reserve, LIM), false);
  assert.equal(canSwapReserve('infantry', list, reserve, LIM, true), true);
  assert.equal(canSwapReserve('cavalry', list, reserve, LIM, true), true);
  // 遊軍を使えない場面・枠が空なら入れ替えられない
  assert.equal(canSwapReserve('infantry', list, reserve, LIM, false), false);
  assert.equal(canSwapReserve('infantry', list, null, LIM, true), false);
  // カードから枠へ離すと入れ替わる
  const r = dropResult(card('infantry'), SLOT, ctx(list, reserve));
  assert.equal(r.type, 'apply');
  if (r.type === 'apply') assert.deepEqual(r.reserve, { kind: 'infantry', stance: 'advance' });
  // 盤のマスへ離しても置けない
  assert.equal(dropResult(card('infantry'), cell(ZONE.col, BACK - 2), ctx(list, reserve)).type, 'none');
});

test('部隊数は本陣を含めて 11 まで（rules.maxUnits の 10 に +1）。上限ちょうどでも、遊軍の入れ替えはできる', () => {
  const list = [HQ, ...Array.from({ length: 9 }, (_, i) => inf(ZONE.col + (i % 8), BACK - 1 - Math.floor(i / 8)))];
  assert.equal(unitCount(list, null), 10);
  assert.equal(canAdd('infantry', list, null, LIM), true);
  const reserve: ReserveSetup = { kind: 'infantry', stance: 'advance' };
  assert.equal(unitCount(list, reserve), 11);
  assert.equal(canAdd('infantry', list, reserve, LIM), false);
  assert.equal(canSwapReserve('archer', list, reserve, LIM, true), true);
  assert.equal(canAdd('hq', [], null, LIM), false);
});

// ---- 離した先ごとの結果（§15.4 の表） ----

test('カード → 空いたマス：置く（方針はその兵種の初めの値）', () => {
  const r = dropResult(card('archer'), cell(ZONE.col, BACK - 1), ctx([HQ], null));
  assert.equal(r.type, 'apply');
  if (r.type !== 'apply') return;
  assert.deepEqual(r.list[1], { kind: 'archer', col: ZONE.col, row: BACK - 1, stance: defaultStance('archer') });
  assert.equal(r.sound, 'place');
});

test('カード → 部隊のいるマス・エリアの外・通り道・盤の外・手札の欄：何も起きない', () => {
  const c = ctx([HQ], null);
  assert.equal(dropResult(card('infantry'), cell(HQ.col, HQ.row), c).type, 'none');
  assert.equal(dropResult(card('infantry'), cell(ZONE.col, ZONE.row - 1), c).type, 'none');
  // 通り道の列（エリアの左の外）
  assert.equal(dropResult(card('infantry'), cell(ZONE.col - 1, BACK), c).type, 'none');
  assert.equal(dropResult(card('infantry'), OUT, c).type, 'none');
  assert.equal(dropResult(card('infantry'), HAND, c).type, 'none');
});

test('カード → 城壁のマス：何も起きない', () => {
  const terrain = FIELD.terrain.slice();
  terrain[(BACK - 1) * FIELD.width + ZONE.col] = 'wall';
  const f: Field = { ...FIELD, terrain };
  const c = ctx([HQ], null, { canPlace: (x) => placeable(f, ZONE, x) });
  assert.equal(dropResult(card('infantry'), cell(ZONE.col, BACK - 1), c).type, 'none');
});

test('カード → 遊軍の枠：空なら遊軍になる、部隊がいれば入れ替える', () => {
  const a = dropResult(card('cavalry'), SLOT, ctx([HQ, inf(ZONE.col, BACK)], null));
  assert.equal(a.type, 'apply');
  if (a.type === 'apply') assert.deepEqual(a.reserve, { kind: 'cavalry', stance: 'flank' });
  const b = dropResult(card('archer'), SLOT, ctx([HQ, inf(ZONE.col, BACK)], { kind: 'cavalry', stance: 'flank' }));
  assert.equal(b.type, 'apply');
  if (b.type === 'apply') {
    assert.deepEqual(b.reserve, { kind: 'archer', stance: defaultStance('archer') });
    assert.equal(b.list.length, 2);
  }
});

test('盤の部隊 → 空いたマス：動かす。元のマス：変わらない。別の部隊：入れ替える', () => {
  const list = [HQ, inf(ZONE.col, BACK - 1)];
  const a = dropResult(unit(1), cell(ZONE.col + 1, BACK - 2), ctx(list, null));
  assert.equal(a.type, 'apply');
  if (a.type === 'apply') assert.deepEqual(a.list[1], inf(ZONE.col + 1, BACK - 2));
  assert.equal(dropResult(unit(1), cell(ZONE.col, BACK - 1), ctx(list, null)).type, 'same');
  const c = dropResult(unit(1), cell(HQ.col, HQ.row), ctx(list, null));
  assert.equal(c.type, 'apply');
  if (c.type === 'apply') {
    assert.deepEqual(c.list[0], { ...HQ, col: ZONE.col, row: BACK - 1 });
    assert.deepEqual(c.list[1], inf(HQ.col, HQ.row));
  }
  // 本陣も動かせる
  assert.equal(dropResult(unit(0), cell(ZONE.col + 5, BACK), ctx(list, null)).type, 'apply');
});

test('盤の部隊 → 手札の欄：外す（予算が戻る）。そのほか：元へ戻る', () => {
  const list = [HQ, inf(ZONE.col, BACK - 1)];
  const a = dropResult(unit(1), HAND, ctx(list, null));
  assert.equal(a.type, 'apply');
  if (a.type === 'apply') {
    assert.deepEqual(a.list, [HQ]);
    assert.equal(a.sound, 'remove');
    assert.equal(budgetUsed(a.list, a.reserve, LIM.costs), 0);
  }
  assert.equal(dropResult(unit(1), OUT, ctx(list, null)).type, 'none');
  assert.equal(dropResult(unit(1), cell(ZONE.col, ZONE.row - 2), ctx(list, null)).type, 'none');
});

test('盤の部隊 → 遊軍の枠：空なら遊軍になる（方針は引き継ぐ）、部隊がいれば入れ替える（前の遊軍がそのマスへ）', () => {
  const list = [HQ, inf(ZONE.col, BACK - 1, 'hunt')];
  const a = dropResult(unit(1), SLOT, ctx(list, null));
  assert.equal(a.type, 'apply');
  if (a.type === 'apply') {
    assert.deepEqual(a.list, [HQ]);
    assert.deepEqual(a.reserve, { kind: 'infantry', stance: 'hunt' });
  }
  const b = dropResult(unit(1), SLOT, ctx(list, { kind: 'archer', stance: 'hunt' }));
  assert.equal(b.type, 'apply');
  if (b.type === 'apply') {
    assert.deepEqual(b.reserve, { kind: 'infantry', stance: 'hunt' });
    assert.deepEqual(b.list[1], { kind: 'archer', col: ZONE.col, row: BACK - 1, stance: 'hunt' });
  }
  // 移った先で選べない方針は、その兵種の初めの値にする
  const c = dropResult(unit(1), SLOT, ctx(list, null, { stanceOk: (_k, s) => s !== 'hunt' }));
  if (c.type === 'apply') assert.deepEqual(c.reserve, { kind: 'infantry', stance: 'advance' });
  else assert.fail('apply のはず');
});

test('遊軍の枠 → 空いたマス・部隊のいるマス・手札の欄・そのほか', () => {
  const list = [HQ, inf(ZONE.col, BACK - 1)];
  const reserve: ReserveSetup = { kind: 'cavalry', stance: 'hunt' };
  const a = dropResult(RES, cell(ZONE.col + 1, BACK - 1), ctx(list, reserve));
  assert.equal(a.type, 'apply');
  if (a.type === 'apply') {
    assert.equal(a.reserve, null);
    assert.deepEqual(a.list[2], { kind: 'cavalry', col: ZONE.col + 1, row: BACK - 1, stance: 'hunt' });
  }
  const b = dropResult(RES, cell(ZONE.col, BACK - 1), ctx(list, reserve));
  assert.equal(b.type, 'apply');
  if (b.type === 'apply') {
    assert.deepEqual(b.reserve, { kind: 'infantry', stance: 'advance' });
    assert.deepEqual(b.list[1], { kind: 'cavalry', col: ZONE.col, row: BACK - 1, stance: 'hunt' });
  }
  const c = dropResult(RES, HAND, ctx(list, reserve));
  assert.equal(c.type, 'apply');
  if (c.type === 'apply') {
    assert.equal(c.reserve, null);
    assert.equal(c.sound, 'remove');
  }
  assert.equal(dropResult(RES, OUT, ctx(list, reserve)).type, 'none');
  assert.equal(dropResult(RES, SLOT, ctx(list, reserve)).type, 'same');
});

test('本陣は外せない・遊軍にできない（空の枠・部隊のいる枠・手札の欄）。遊軍を本陣のマスへ離しても入れ替えない', () => {
  const list = [HQ, inf(ZONE.col, BACK - 1)];
  assert.equal(dropResult(unit(0), HAND, ctx(list, null)).type, 'none');
  assert.equal(dropResult(unit(0), SLOT, ctx(list, null)).type, 'none');
  assert.equal(dropResult(unit(0), SLOT, ctx(list, { kind: 'archer', stance: 'hold' })).type, 'none');
  assert.equal(dropResult(RES, cell(HQ.col, HQ.row), ctx(list, { kind: 'archer', stance: 'hold' })).type, 'none');
  assert.equal(dropResult(card('hq'), cell(ZONE.col, BACK - 2), ctx(list, null)).type, 'none');
});

test('遊軍を使えない場面では、枠に関わる行は何も起きない', () => {
  const list = [HQ, inf(ZONE.col, BACK - 1)];
  const c = ctx(list, null, { reserveShown: false });
  assert.equal(dropResult(card('archer'), SLOT, c).type, 'none');
  assert.equal(dropResult(unit(1), SLOT, c).type, 'none');
  assert.equal(dropResult(RES, cell(ZONE.col, BACK - 2), c).type, 'none');
});

test('チュートリアル：許された操作だけ（歩兵のカード → 光るマス）', () => {
  const lit = { col: 3, row: 9 };
  const allow = (s: DragSource, t: DropTarget): boolean => s.type === 'card' && s.kind === 'infantry' && t.type === 'cell' && t.col === lit.col && t.row === lit.row;
  const c = ctx([HQ], null, { allow, canPlace: () => true });
  assert.equal(dropResult(card('infantry'), cell(3, 9), c).type, 'apply');
  assert.equal(dropResult(card('infantry'), cell(2, 9), c).type, 'none');
  assert.equal(dropResult(card('archer'), cell(3, 9), c).type, 'none');
  assert.equal(dropResult(unit(0), cell(2, 9), c).type, 'none');
});

test('結果の組が検査に通らなければ、何も起きない（予算超え・部隊数の上限。部隊が足りないのは見ない）', () => {
  const list = [HQ, ...Array.from({ length: 6 }, (_, i): Placement => ({ kind: 'cavalry', col: ZONE.col + i, row: BACK - 1, stance: 'flank' }))];
  // 24 使い切り → 歩兵も置けない
  assert.equal(dropResult(card('infantry'), cell(ZONE.col, BACK - 2), ctx(list, null)).type, 'none');
  // 本陣だけになる外し方は通る（盤の部隊が足りないのは途中の姿）
  const r = dropResult(unit(1), HAND, ctx([HQ, inf(ZONE.col, BACK - 1)], null));
  assert.equal(r.type, 'apply');
});

// ---- ひな形 ----

test('ひな形：置いている部隊だけを並べ替える。本陣だけなら決めた編成', () => {
  const list = [HQ, inf(ZONE.col, BACK - 1), inf(ZONE.col + 1, BACK - 1), { kind: 'archer', col: ZONE.col + 2, row: BACK - 1, stance: 'hold' } as Placement];
  assert.deepEqual(templateRoster(list, PVP_RULES.standardRoster), { hq: 1, infantry: 2, archer: 1 });
  assert.deepEqual(templateRoster([HQ], PVP_RULES.standardRoster), { ...PVP_RULES.standardRoster, hq: 1 });
  // 一人用の、本陣だけのとき：手持ちの全部から遊軍の 1 つを引いたもの
  assert.deepEqual(rosterWithoutReserve({ hq: 1, infantry: 3, cavalry: 1 }, { kind: 'cavalry', stance: 'flank' }), { hq: 1, infantry: 3, cavalry: 0 });
  assert.equal(hasNonHq([HQ]), false);
  assert.equal(hasNonHq(list), true);
});

test('ひな形：標準の編成と遊軍で予算を超えるなら、後ろの部隊から外す（遊軍の枠は空に戻さない）', () => {
  const list = [HQ, ...Array.from({ length: 9 }, (_, i): Placement => ({ kind: 'infantry', col: ZONE.col + (i % 8), row: BACK - 1 - Math.floor(i / 8), stance: 'advance' }))];
  // 歩兵 2 × 9 ＝ 18 ＋ 遊軍の騎兵 4 ＝ 22。部隊数は 11（上限ちょうど）
  const ok = trimToLimits(list, { kind: 'cavalry', stance: 'flank' }, LIM);
  assert.equal(ok.trimmed, false);
  // 歩兵 8 ＋ 騎兵 2 ＋ 遊軍の騎兵で 28・12 部隊 → 後ろから外す
  const cav = (col: number): Placement => ({ kind: 'cavalry', col, row: BACK - 3, stance: 'flank' });
  const over = trimToLimits([...list.slice(0, 9), cav(ZONE.col + 4), cav(ZONE.col + 5)], { kind: 'cavalry', stance: 'flank' }, LIM);
  assert.equal(over.trimmed, true);
  assert.ok(budgetUsed(over.list, { kind: 'cavalry', stance: 'flank' }, LIM.costs) <= 24);
  assert.ok(over.list.some((p) => p.kind === 'hq'));
});

// ---- 陣形の呼び出し ----

const rel = (p: Placement): Placement => ({ ...p, col: p.col - ZONE.col, row: p.row - ZONE.row });

test('陣形の呼び出し（対戦）：兵種ごとの数に関わらず採る。超えたら遊軍 → 後ろの部隊の順に外す', () => {
  const units = [HQ, ...Array.from({ length: 5 }, (_, i): Placement => ({ kind: 'cavalry', col: ZONE.col + i, row: BACK - 1, stance: 'flank' }))].map(rel);
  const base = { field: FIELD, zone: ZONE, reserveShown: true, stanceOk: () => true, currentHq: HQ, pvp: LIM, check };
  // 騎兵 5 ＝ 20。遊軍の弓兵 3 で 23 → 収まる
  const a = recallPlan({ ...base, units, reserve: { kind: 'archer', stance: 'hold' } });
  assert.equal(a.ok, true);
  assert.equal(a.trimmed, false);
  assert.equal(a.list.filter((p) => p.kind === 'cavalry').length, 5);
  assert.deepEqual(a.reserve, { kind: 'archer', stance: 'hold' });
  // 遊軍の騎兵 4 で 24 → 収まる。もう 1 騎足すと 28 → 遊軍を外し（24）、それで収まる
  const more = [...units, rel({ kind: 'cavalry', col: ZONE.col + 5, row: BACK - 1, stance: 'flank' })];
  const b = recallPlan({ ...base, units: more, reserve: { kind: 'cavalry', stance: 'flank' } });
  assert.equal(b.trimmed, true);
  assert.equal(b.reserve, null);
  assert.equal(b.list.filter((p) => p.kind === 'cavalry').length, 6);
  // 遊軍がなく 7 騎（28）→ 後ろの 1 騎を外す
  const seven = [...more, rel({ kind: 'cavalry', col: ZONE.col + 6, row: BACK - 1, stance: 'flank' })];
  const c = recallPlan({ ...base, units: seven, reserve: null });
  assert.equal(c.trimmed, true);
  assert.equal(c.list.filter((p) => p.kind === 'cavalry').length, 6);
  assert.ok(!c.list.some((p) => p.col === ZONE.col + 6 && p.row === BACK - 1));
});

test('陣形の呼び出し：本陣のない陣形・狭い面で本陣がエリアの外になる陣形では、本陣を補う', () => {
  const base = { field: FIELD, zone: ZONE, reserveShown: true, stanceOk: () => true, pvp: LIM, check, reserve: null };
  // 本陣のない陣形：いまの本陣のマスへ
  const a = recallPlan({ ...base, units: [inf(ZONE.col, BACK - 1)].map(rel), currentHq: HQ });
  assert.deepEqual(a.list.find((p) => p.kind === 'hq'), HQ);
  assert.equal(a.ok, true);
  // いまの本陣のマスがふさがっていれば、近い空きマス
  const b = recallPlan({ ...base, units: [inf(HQ.col, HQ.row)].map(rel), currentHq: HQ });
  const hq = b.list.find((p) => p.kind === 'hq');
  assert.ok(hq && !(hq.col === HQ.col && hq.row === HQ.row));
  assert.equal(validateArmy(b.list, ZONE, pvpArmyLimits()).length, 0);
  // 狭いエリア（幅 4）に、幅 8 の陣形の本陣（左から 4 つ目より右）を呼ぶ
  const narrow: Zone = { ...ZONE, width: 4 };
  const units = [{ kind: 'hq', col: 6, row: ZONE.height - 1, stance: 'hold' } as Placement, { kind: 'infantry', col: 1, row: 0, stance: 'advance' } as Placement];
  const c = recallPlan({ ...base, zone: narrow, units, currentHq: { kind: 'hq', col: narrow.col + 1, row: BACK, stance: 'hold' }, check: (l, r) => validateArmy(l, narrow, { ...pvpArmyLimits(), reserve: r }) });
  assert.equal(c.skipped, true);
  assert.equal(c.ok, true);
  assert.equal(c.list.filter((p) => p.kind === 'hq').length, 1);
  assert.equal(validateArmy(c.list, narrow, pvpArmyLimits()).length, 0);
});

test('陣形の呼び出し（一人用）：手持ちの数を超える部隊は除く。遊軍は手持ちが残るときだけ', () => {
  const units = [HQ, inf(ZONE.col, BACK - 1), inf(ZONE.col + 1, BACK - 1), inf(ZONE.col + 2, BACK - 1)].map(rel);
  const base = { field: FIELD, zone: ZONE, reserveShown: true, stanceOk: () => true, currentHq: HQ, check };
  const a = recallPlan({ ...base, units, reserve: { kind: 'infantry', stance: 'advance' }, roster: { hq: 1, infantry: 2 } });
  assert.equal(a.list.filter((p) => p.kind === 'infantry').length, 2);
  assert.equal(a.reserve, null);
  assert.equal(a.skipped, true);
  const b = recallPlan({ ...base, units: units.slice(0, 2), reserve: { kind: 'infantry', stance: 'advance' }, roster: { hq: 1, infantry: 2 } });
  assert.deepEqual(b.reserve, { kind: 'infantry', stance: 'advance' });
  assert.equal(b.skipped, false);
});

// ---- 矩形（§15.2） ----

test('配置の操作の欄：カード・ひな形・遊軍の枠・「開戦」「完了」が欄からはみ出さず、重ならない（縦長 3 つと横長）', async () => {
  const { computeLayout, deployPanel, LANDSCAPE_H, LANDSCAPE_W } = await import('../src/layout.ts');
  type R = { x: number; y: number; w: number; h: number };
  const overlaps = (a: R, b: R): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (a: R, b: R): boolean => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  for (const l of [computeLayout(390, 760), computeLayout(402, 713), computeLayout(375, 547), computeLayout(LANDSCAPE_W, LANDSCAPE_H)]) {
    const d = deployPanel(l);
    for (const withReserve of [true, false]) {
      const rects: [string, R][] = [
        ['back', d.back],
        ['mute', d.mute],
        ...d.cards.map((r, i): [string, R] => [`card${i}`, r]),
        ...d.templates.map((r, i): [string, R] => [`tpl${i}`, r]),
        ['formations', d.formations],
        ...(withReserve ? ([['reserve', d.reserve], ['start', d.start]] as [string, R][]) : ([['start', d.startFull]] as [string, R][])),
      ];
      for (const [n, r] of rects) assert.ok(inside(r, l.panel), `${l.mode} ${l.height} ${n}`);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i]![1], rects[j]![1]), `${l.mode} ${l.height} ${rects[i]![0]} ${rects[j]![0]}`);
      }
    }
    assert.equal(d.cards.length, 4);
    // 手札の欄は、カード 4 枚の場所を合わせた矩形
    assert.deepEqual(d.hand, { x: d.cards[0]!.x, y: d.cards[0]!.y, w: d.cards[3]!.x + d.cards[3]!.w - d.cards[0]!.x, h: d.cards[0]!.h });
    if (l.mode === 'portrait') {
      assert.deepEqual(
        d.cards.map((c) => [c.x - l.panel.x, c.y - l.panel.y, c.w, c.h]),
        [0, 77, 154, 231].map((x) => [x, 36, 73, 44]),
      );
      assert.deepEqual([d.reserve.w, d.start.w, d.startFull.w], [96, 204, 304]);
    }
  }
});
