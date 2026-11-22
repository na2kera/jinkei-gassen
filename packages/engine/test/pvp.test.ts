// 対戦の予算（PVP_RULES。decisions §22）
import { describe, expect, it } from 'vitest';
import { applyTemplate, armyCost, MAX_UNITS, plainField, PVP_RULES, pvpArmyLimits, validateArmy, type Placement } from '../src/index.ts';

const zone = plainField().zones[0];
/** 配置エリアの左から i 番目の列、前から j 番目の行 */
const col = (i: number): number => zone.col + i;
const row = (j: number): number => zone.row + j;
const back = row(zone.height - 1);

describe('PVP_RULES', () => {
  it('予算 24、値段は既定の値段（本陣 0）、本陣以外の上限 11（MAX_UNITS − 1）', () => {
    expect(PVP_RULES.budget).toBe(24);
    expect(PVP_RULES.costs).toEqual({ infantry: 2, shield: 3, archer: 3, cavalry: 4, hq: 0 });
    expect(PVP_RULES.maxUnits).toBe(11);
    expect(PVP_RULES.maxUnits).toBe(MAX_UNITS - 1);
  });
  it('予算ちょうどは通り、1 超えると落ちる', () => {
    // 歩兵2（4）+ 騎兵5（20）= 24
    const exact: Placement[] = [
      { kind: 'hq', col: col(4), row: back, stance: 'hold' },
      ...Array.from({ length: 2 }, (_, i) => ({ kind: 'infantry' as const, col: col(i), row: row(0), stance: 'advance' as const })),
      ...Array.from({ length: 5 }, (_, i) => ({ kind: 'cavalry' as const, col: col(i), row: row(1), stance: 'flank' as const })),
    ];
    expect(armyCost(exact, PVP_RULES.costs)).toBe(24);
    expect(validateArmy(exact, zone, pvpArmyLimits())).toEqual([]);
    const over = [...exact, { kind: 'infantry' as const, col: col(2), row: row(0), stance: 'advance' as const }];
    expect(armyCost(over, PVP_RULES.costs)).toBe(26);
    expect(validateArmy(over, zone, pvpArmyLimits()).map((e) => e.code)).toEqual(['over_budget']);
    // 1 だけ超える：騎兵1つを弓兵と騎兵に替えて 27 → 予算 27 の条件では通り、26 では落ちる
    const limits = pvpArmyLimits();
    const over1 = [...exact.slice(0, -1), { kind: 'cavalry' as const, col: col(5), row: row(1), stance: 'flank' as const }, { kind: 'archer' as const, col: col(7), row: row(1), stance: 'advance' as const }];
    expect(armyCost(over1, PVP_RULES.costs)).toBe(27);
    expect(validateArmy(over1, zone, { ...limits, budget: 27 })).toEqual([]);
    expect(validateArmy(over1, zone, { ...limits, budget: 26 }).map((e) => e.code)).toEqual(['over_budget']);
  });
  it('本陣は1つ必須、本陣以外は 1〜11', () => {
    expect(validateArmy([{ kind: 'infantry', col: col(0), row: row(0), stance: 'advance' }], zone, pvpArmyLimits()).map((e) => e.code)).toContain('hq_count');
    expect(validateArmy([{ kind: 'hq', col: col(0), row: back, stance: 'hold' }], zone, pvpArmyLimits()).map((e) => e.code)).toContain('too_few_units');
    const cells = (n: number): Placement[] =>
      Array.from({ length: n }, (_, i) => ({ kind: 'infantry' as const, col: col(i % zone.width), row: row(Math.floor(i / zone.width)), stance: 'advance' as const }));
    const hq: Placement = { kind: 'hq', col: col(0), row: back, stance: 'hold' };
    expect(validateArmy([hq, ...cells(PVP_RULES.maxUnits)], zone, { ...pvpArmyLimits(), budget: 100 })).toEqual([]);
    expect(validateArmy([hq, ...cells(PVP_RULES.maxUnits + 1)], zone, { ...pvpArmyLimits(), budget: 100 }).map((e) => e.code)).toContain('too_many_units');
  });
  it('既定の編成（本陣・歩4・盾2・騎1・弓2）は、ひな形で並べると予算ちょうどで、対戦の条件を通る', () => {
    const def = applyTemplate('line', PVP_RULES.standardRoster, zone, 0);
    expect(def.length).toBe(10);
    expect(armyCost(def, PVP_RULES.costs)).toBe(24);
    expect(validateArmy(def, zone, pvpArmyLimits())).toEqual([]);
  });
});
