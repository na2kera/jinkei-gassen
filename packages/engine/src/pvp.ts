// 対戦の予算（design §3.4 の PVP_RULES、assumptions S1、decisions §22）。

import { MAX_UNITS } from './army.ts';
import { DEFAULT_COSTS } from './tuning.ts';
import type { ArmyLimits, Kind, Roster } from './types.ts';

/**
 * 対戦の予算と値段。maxUnits は本陣以外の部隊数の上限。
 * standardRoster は、時間切れで配置がないときの既定の編成と、本陣しか置いていないときのひな形に使う編成
 * （decisions §22：本陣1・歩兵4・盾兵2・騎兵1・弓兵2。値段 24 ちょうど）。
 */
export const PVP_RULES: { budget: number; costs: Record<Kind, number>; maxUnits: number; standardRoster: Roster } = {
  budget: 24,
  costs: { ...DEFAULT_COSTS },
  maxUnits: MAX_UNITS - 1,
  standardRoster: { hq: 1, infantry: 4, shield: 2, cavalry: 1, archer: 2 },
};

/** validateArmy にそのまま渡せる、対戦の配置の条件（本陣1つが必須、本陣以外は 1〜10、予算 24） */
export function pvpArmyLimits(): ArmyLimits {
  return {
    maxUnits: PVP_RULES.maxUnits + 1,
    minUnits: 1,
    budget: PVP_RULES.budget,
    costs: { ...PVP_RULES.costs },
    requireHq: true,
  };
}
