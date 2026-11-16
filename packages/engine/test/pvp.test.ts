// 対戦の予算（PVP_RULES）
import { describe, expect, it } from 'vitest';
import { applyTemplate, armyCost, plainField, PVP_RULES, pvpArmyLimits, STANDARD_ROSTER, validateArmy, type Placement } from '../src/index.ts';

const zone = plainField().zones[0];

describe('PVP_RULES', () => {
  it('予算 36、値段は既定の値段（本陣 0）、本陣以外の上限 15', () => {
    expect(PVP_RULES.budget).toBe(36);
    expect(PVP_RULES.costs).toEqual({ infantry: 2, shield: 3, archer: 3, cavalry: 4, hq: 0 });
    expect(PVP_RULES.maxUnits).toBe(15);
  });
  it('予算ちょうどは通り、1 超えると落ちる', () => {
    // 歩兵2（4）+ 騎兵8（32）= 36
    const exact: Placement[] = [
      { kind: 'hq', col: 5, row: 15, stance: 'hold' },
      ...Array.from({ length: 2 }, (_, i) => ({ kind: 'infantry' as const, col: i, row: 10, stance: 'advance' as const })),
      ...Array.from({ length: 8 }, (_, i) => ({ kind: 'cavalry' as const, col: i, row: 11, stance: 'flank' as const })),
    ];
    expect(armyCost(exact, PVP_RULES.costs)).toBe(36);
    expect(validateArmy(exact, zone, pvpArmyLimits())).toEqual([]);
    const over = [...exact, { kind: 'infantry' as const, col: 2, row: 10, stance: 'advance' as const }];
    expect(armyCost(over, PVP_RULES.costs)).toBe(38);
    expect(validateArmy(over, zone, pvpArmyLimits()).map((e) => e.code)).toEqual(['over_budget']);
    // 1 だけ超える：盾兵1つを足して 39 → 予算 38 の条件では通り、36 では落ちる
    const limits = pvpArmyLimits();
    const over1 = [...exact.slice(0, -1), { kind: 'cavalry' as const, col: 7, row: 11, stance: 'flank' as const }, { kind: 'archer' as const, col: 9, row: 11, stance: 'advance' as const }];
    expect(armyCost(over1, PVP_RULES.costs)).toBe(39);
    expect(validateArmy(over1, zone, { ...limits, budget: 39 })).toEqual([]);
    expect(validateArmy(over1, zone, { ...limits, budget: 38 }).map((e) => e.code)).toEqual(['over_budget']);
  });
  it('本陣は1つ必須、本陣以外は 1〜15', () => {
    expect(validateArmy([{ kind: 'infantry', col: 0, row: 10, stance: 'advance' }], zone, pvpArmyLimits()).map((e) => e.code)).toContain('hq_count');
    expect(validateArmy([{ kind: 'hq', col: 0, row: 15, stance: 'hold' }], zone, pvpArmyLimits()).map((e) => e.code)).toContain('too_few_units');
    const sixteen: Placement[] = [{ kind: 'hq', col: 0, row: 15, stance: 'hold' }, ...Array.from({ length: 16 }, (_, i) => ({ kind: 'infantry' as const, col: i % 12, row: 10 + Math.floor(i / 12), stance: 'advance' as const }))];
    expect(validateArmy(sixteen, zone, { ...pvpArmyLimits(), budget: 100 }).map((e) => e.code)).toContain('too_many_units');
  });
  it('標準の手持ち R15 は値段 40 で予算を超えるので、既定の編成は予算に収まる別の編成（36 ちょうど）', () => {
    expect(armyCost(applyTemplate('line', STANDARD_ROSTER, zone, 0), PVP_RULES.costs)).toBe(40);
    const def = applyTemplate('line', PVP_RULES.standardRoster, zone, 0);
    expect(armyCost(def, PVP_RULES.costs)).toBe(36);
    expect(validateArmy(def, zone, pvpArmyLimits())).toEqual([]);
  });
});
