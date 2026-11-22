// @jinkei/engine の公開窓口。client と server はここから import する。

export const ENGINE_VERSION = 1;

export * from './types.ts';
export { DT, KIND_STATS, DEFAULT_COSTS } from './tuning.ts';
export { MAX_ORDERS, ROUT_TICKS } from './tuning.ts';
export type { KindStats } from './tuning.ts';
export {
  plainField,
  wingOf,
  defaultStance,
  stanceAllowed,
  armyCost,
  validateArmy,
  reserveErrors,
  MAX_UNITS,
  STANDARD_WIDTH,
  STANDARD_HEIGHT,
  STANDARD_ZONE_DEPTH,
  STANDARD_ZONE_WIDTH,
  STANDARD_LANE,
} from './army.ts';
export { createBattle, step, remainingRatio } from './battle.ts';
export { canOrder, canOrderView } from './orders.ts';
export { canSummon, canSummonView } from './reserve.ts';
export { viewFor, summarize } from './view.ts';
export { listTemplates, applyTemplate } from './templates.ts';

/**
 * 総当たりと合格条件の手持ち（design §3.9）。仮の値：R10（本陣1、歩兵3、盾兵2、騎兵2、弓兵2）。
 * main の R15（歩5・盾3・騎3・弓3。15 部隊）は部隊数の上限 11 を超えるので、実験の枝（exp/grid-tuning）で
 * 通り道つきの盤を測ったときの R10 を入れている。最終の値は design §13.3 で決める。
 */
export const STANDARD_ROSTER = { hq: 1, infantry: 3, shield: 2, cavalry: 2, archer: 2 } as const;
export { PVP_RULES, pvpArmyLimits } from './pvp.ts';
export { recognizeFormation, formationScores, FORMATION_MIN_SCORE, FORMATION_MIN_MARGIN } from './formation.ts';
export { STAR_THRESHOLDS, stageSetup, stageSetupWith, validateStageArmy, starsFor, stageEnemyVisible, stageLineArmy, stanceAllowedInStage, STAGE_MAX_TICKS } from './stage.ts';
export type { Stage, StageAllow, StageEnemyOrder, StageEnemyView, StageReserveCall } from './stage.ts';
export { STAGES } from './stages.ts';
export { PVP_MAPS, pvpField } from './maps.ts';
export type { PvpMapId } from './maps.ts';
export { isGate } from './battle.ts';
export { terrainAt } from './terrain.ts';
export { TUTORIAL_STAGE, TUTORIAL_ARMY, TUTORIAL_STANCE, TUTORIAL_ORDER_TICK, TUTORIAL_ORDER, TUTORIAL_SEED, tutorialSetup } from './tutorial.ts';
