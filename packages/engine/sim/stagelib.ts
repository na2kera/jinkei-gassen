// 面の実測（テストと sim stage で共有する）
import { applyTemplate, defaultStance, listTemplates, stanceAllowedInStage, type TemplateId } from '../src/index.ts';
import { createBattle, stageLineArmy, stageSetupWith, starsFor, step, summarize, type BattleState, type Placement, type Stage, type StageEnemyOrder } from '../src/index.ts';

/** 面の種（20個。固定の一覧） */
export const STAGE_SEEDS: number[] = Array.from({ length: 20 }, (_, i) => 5000 + i * 104723);

export function runStage(stage: Stage, placements: Placement[], seed: number, onTick?: (s: BattleState) => void, myOrders: StageEnemyOrder[] = []): BattleState {
  const r = createBattle(stageSetupWith(stage, placements, seed, myOrders));
  if (!r.ok) throw new Error(`面 ${stage.id} の戦いを作れない: ${r.error.message} ${JSON.stringify(r.error.armyErrors ?? [])}`);
  const s = r.value;
  while (!s.outcome) {
    step(s, []);
    onTick?.(s);
  }
  return s;
}

export interface StageStats {
  wins: number;
  starsMean: number;
  remainingMean: number;
  secondsMean: number;
}

export function stageStats(stage: Stage, placements: Placement[], seeds = STAGE_SEEDS, myOrders: StageEnemyOrder[] = []): StageStats {
  let wins = 0;
  let stars = 0;
  let rem = 0;
  let sec = 0;
  for (const seed of seeds) {
    const sm = summarize(runStage(stage, placements, seed, undefined, myOrders));
    if (sm.winner === 0) wins++;
    stars += starsFor(sm, 0);
    rem += sm.remaining[0];
    sec += sm.seconds;
  }
  return { wins, starsMean: stars / seeds.length, remainingMean: rem / seeds.length, secondsMean: sec / seeds.length };
}

/** 見本の配置と見本の号令で */
export function solutionStats(stage: Stage, seeds = STAGE_SEEDS): StageStats {
  return stageStats(stage, stage.solution, seeds, stage.solutionOrders ?? []);
}

export function lineStats(stage: Stage, seeds = STAGE_SEEDS): StageStats {
  return stageStats(stage, stageLineArmy(stage), seeds);
}

/** ひな形をそのまま置いた配置（方針を出さない面では、初期設定の方針に直す） */
export function stageTemplateArmy(stage: Stage, id: TemplateId): Placement[] {
  return applyTemplate(id, stage.roster, stage.field.zones[0], 0).map((p) =>
    stanceAllowedInStage(stage, p.kind, p.stance) ? p : { ...p, stance: defaultStance(p.kind) },
  );
}

/** 7つのひな形それぞれの勝ち数（号令なし） */
export function templateWins(stage: Stage, seeds = STAGE_SEEDS): { id: TemplateId; wins: number; starsMean: number }[] {
  return listTemplates().map(({ id }) => {
    const r = stageStats(stage, stageTemplateArmy(stage, id), seeds);
    return { id, wins: r.wins, starsMean: r.starsMean };
  });
}

/**
 * 配置の並べ替え（置く順だけを変える）。画面は置いた順に id を振り、id は同点の割り方に使われるので、
 * 見本や星3つの配置が、置く順に頼って勝っていないことを確かめるのに使う
 */
export const ORDER_PERMS: { name: string; apply: <T>(a: T[]) => T[] }[] = [
  { name: '逆順', apply: (a) => a.slice().reverse() },
  { name: '半分で回す', apply: (a) => a.slice(Math.floor(a.length / 2)).concat(a.slice(0, Math.floor(a.length / 2))) },
  { name: '奇数番が先', apply: (a) => [...a.filter((_, i) => i % 2 === 1), ...a.filter((_, i) => i % 2 === 0)] },
];
