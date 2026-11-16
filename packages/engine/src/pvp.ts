// 対戦の予算（design §3.4 の PVP_RULES、assumptions S1）。

import { MAX_UNITS } from './army.ts';
import { DEFAULT_COSTS } from './tuning.ts';
import type { ArmyLimits, Kind, Roster } from './types.ts';

/**
 * 対戦の予算と値段。maxUnits は本陣以外の部隊数の上限。
 * standardRoster は、時間切れで配置がないときの既定の編成。標準の手持ち R15（本陣1・歩兵5・盾兵3・騎兵3・弓兵3）は
 * 値段が 40 で予算 36 を超えるので、騎兵を1つ減らした編成（値段 36 ちょうど）にしている。
 */
export const PVP_RULES: { budget: number; costs: Record<Kind, number>; maxUnits: number; standardRoster: Roster } = {
  budget: 36,
  costs: { ...DEFAULT_COSTS },
  maxUnits: MAX_UNITS - 1,
  standardRoster: { hq: 1, infantry: 5, shield: 3, cavalry: 2, archer: 3 },
};

/** validateArmy にそのまま渡せる、対戦の配置の条件（本陣1つが必須、本陣以外は 1〜15、予算 36） */
export function pvpArmyLimits(): ArmyLimits {
  return {
    maxUnits: PVP_RULES.maxUnits + 1,
    minUnits: 1,
    budget: PVP_RULES.budget,
    costs: { ...PVP_RULES.costs },
    requireHq: true,
  };
}
