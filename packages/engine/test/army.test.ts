// 配置の検査・値段・既定の方針・翼・作成時の検査（design §3.2、§3.4）
import { describe, expect, it } from 'vitest';
import { armyCost, createBattle, defaultStance, plainField, validateArmy, wingOf, type Placement } from '../src/index.ts';
import { p } from './helpers.ts';

const zone0 = plainField().zones[0];
const lim = { maxUnits: 16 };

function codes(ps: Placement[], limits: Parameters<typeof validateArmy>[2] = lim): string[] {
  return validateArmy(ps, zone0, limits).map((e) => e.code);
}

describe('validateArmy', () => {
  it('正しい配置は誤りなし', () => {
    expect(codes([p('hq', 5, 15, 'hold'), p('infantry', 5, 10)])).toEqual([]);
  });
  it('エリアの外', () => {
    expect(codes([p('hq', 5, 15, 'hold'), p('infantry', 5, 9)])).toContain('out_of_zone');
  });
  it('マスの重なり', () => {
    expect(codes([p('hq', 5, 15, 'hold'), p('infantry', 5, 10), p('shield', 5, 10, 'hold')])).toContain('overlap');
  });
  it('本陣は必ず1つ（requireHq の既定）。requireHq: false なら0でもよいが2つは不可', () => {
    expect(codes([p('infantry', 5, 10)])).toContain('hq_count');
    expect(codes([p('hq', 5, 15, 'hold'), p('hq', 6, 15, 'hold'), p('infantry', 5, 10)])).toContain('hq_count');
    expect(codes([p('infantry', 5, 10)], { maxUnits: 16, requireHq: false })).toEqual([]);
  });
  it('本陣が選べる方針は守備と前進だけ', () => {
    expect(codes([p('hq', 5, 15, 'flank'), p('infantry', 5, 10)])).toContain('invalid_stance');
    expect(codes([p('hq', 5, 15, 'advance'), p('infantry', 5, 10)])).toEqual([]);
  });
  it('マスは整数', () => {
    expect(codes([p('hq', 5, 15, 'hold'), p('infantry', 5.5, 10)])).toContain('invalid_cell');
  });
  it('部隊数の上限と、本陣以外の下限', () => {
    const many = [p('hq', 0, 15, 'hold'), ...Array.from({ length: 16 }, (_, i) => p('infantry', i % 12, 10 + Math.floor(i / 12)))];
    expect(codes(many)).toContain('too_many_units');
    expect(codes([p('hq', 5, 15, 'hold')])).toContain('too_few_units');
  });
  it('予算', () => {
    const army = [p('hq', 5, 15, 'hold'), p('cavalry', 0, 10, 'flank'), p('cavalry', 1, 10, 'flank')];
    expect(codes(army, { maxUnits: 16, budget: 7 })).toContain('over_budget');
    expect(codes(army, { maxUnits: 16, budget: 8 })).toEqual([]);
  });
});

describe('armyCost / defaultStance', () => {
  it('既定の値段は S1（歩兵2・盾兵3・弓兵3・騎兵4・本陣0）', () => {
    expect(armyCost([p('hq', 0, 0), p('infantry', 0, 0), p('shield', 0, 0), p('archer', 0, 0), p('cavalry', 0, 0)])).toBe(12);
    expect(armyCost([p('infantry', 0, 0)], { infantry: 5 })).toBe(5);
  });
  it('初期の方針', () => {
    expect(defaultStance('infantry')).toBe('advance');
    expect(defaultStance('shield')).toBe('hold');
    expect(defaultStance('cavalry')).toBe('flank');
    expect(defaultStance('archer')).toBe('advance');
    expect(defaultStance('hq')).toBe('hold');
  });
});

describe('wingOf', () => {
  it('12列：陣営0は 0〜3 が左翼、4〜7 が中央、8〜11 が右翼。陣営1は左右が逆', () => {
    const f = { width: 12 };
    expect([0, 3, 4, 7, 8, 11].map((c) => wingOf(c, f, 0))).toEqual(['left', 'left', 'center', 'center', 'right', 'right']);
    expect([0, 3, 4, 7, 8, 11].map((c) => wingOf(c, f, 1))).toEqual(['right', 'right', 'center', 'center', 'left', 'left']);
  });
  it('幅が3で割れないときは、列の中心で分ける', () => {
    const f = { width: 10 };
    expect(Array.from({ length: 10 }, (_, c) => wingOf(c, f, 0))).toEqual([
      'left', 'left', 'left', 'center', 'center', 'center', 'center', 'right', 'right', 'right',
    ]);
  });
});

describe('createBattle の検査（例外を投げずにエラーを返す）', () => {
  it('配置の誤りは invalid_army で返す', () => {
    const r = createBattle({ field: plainField(), armies: [[p('infantry', 5, 10)], [p('hq', 5, 0, 'hold'), p('infantry', 5, 5)]], seed: 1, maxTicks: 10, timeout: 'compare' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('invalid_army');
      expect(r.error.side).toBe(0);
    }
  });
  it('地形の長さが合わない戦場は invalid_field', () => {
    const f = plainField();
    f.terrain = f.terrain.slice(1);
    const r = createBattle({ field: f, armies: [[], []], seed: 1, maxTicks: 10, timeout: 'compare' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_field');
  });
  it('maxTicks が正しくないと invalid_setup', () => {
    const r = createBattle({ field: plainField(), armies: [[], []], seed: 1, maxTicks: 0, timeout: 'compare' });
    expect(r.ok).toBe(false);
  });
  it('初期状態：id は陣営0の配列の順、続けて陣営1。士気100、兵数は最大、向きは自陣営の前', () => {
    const r = createBattle({
      field: plainField(),
      armies: [[p('hq', 5, 15, 'hold'), p('cavalry', 2, 10, 'flank')], [p('hq', 5, 0, 'hold'), p('archer', 3, 5)]],
      seed: 1,
      maxTicks: 10,
      timeout: 'compare',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = r.value.units;
    expect(u.map((x) => [x.id, x.side, x.kind])).toEqual([[0, 0, 'hq'], [1, 0, 'cavalry'], [2, 1, 'hq'], [3, 1, 'archer']]);
    expect(u[1]).toMatchObject({ x: 2.5, y: 10.5, fx: 0, fy: -1, men: 60, maxMen: 60, morale: 100, status: 'active', target: null, order: null });
    expect(u[3]).toMatchObject({ fx: 0, fy: 1, men: 80 });
    expect(JSON.parse(JSON.stringify(r.value))).toEqual(r.value);
  });
});
