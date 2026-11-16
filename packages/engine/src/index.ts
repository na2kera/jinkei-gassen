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
  MAX_UNITS,
  STANDARD_WIDTH,
  STANDARD_HEIGHT,
  STANDARD_ZONE_DEPTH,
} from './army.ts';
export { createBattle, step, remainingRatio } from './battle.ts';
export { canOrder, canOrderView } from './orders.ts';
export { viewFor, summarize } from './view.ts';
export { listTemplates, applyTemplate } from './templates.ts';

/** 標準の手持ち R15：本陣1、歩兵5、盾兵3、騎兵3、弓兵3（design §3.9） */
export const STANDARD_ROSTER = { hq: 1, infantry: 5, shield: 3, cavalry: 3, archer: 3 } as const;
export { PVP_RULES, pvpArmyLimits } from './pvp.ts';
export { recognizeFormation, formationScores, FORMATION_MIN_SCORE, FORMATION_MIN_MARGIN } from './formation.ts';
export { STAR_THRESHOLDS, stageSetup, stageSetupWith, validateStageArmy, starsFor, stageEnemyVisible, stageLineArmy, stanceAllowedInStage, STAGE_MAX_TICKS } from './stage.ts';
export type { Stage, StageAllow, StageEnemyOrder, StageEnemyView } from './stage.ts';
export { STAGES } from './stages.ts';
