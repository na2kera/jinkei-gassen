// ステージ（design §3.10）。面のデータの型と、面を戦いに直す関数。面の中身は stages.ts。

import { defaultStance, MAX_UNITS, validateArmy } from './army.ts';
import { isDenseArray, isObject } from './input.ts';
import { applyTemplate } from './templates.ts';
import type { ArmyError, BattleSetup, BattleSummary, Field, Kind, OrderKind, OrderTarget, Placement, Roster, Side, Stance } from './types.ts';

export interface StageEnemyOrder {
  atSec: number;
  target: OrderTarget;
  kind: OrderKind;
}

export interface StageAllow {
  /** 配置の画面で選べる方針。空の配列なら方針の切り替えを出さず、どの部隊も兵種の初期設定の方針で動く。省略するとすべて選べる */
  stances?: Stance[];
  /** 号令を出せるか。省略すると出せる */
  orders?: boolean;
  /** 配置の画面でひな形を出すか。省略すると出す */
  templates?: boolean;
}

export interface Stage {
  id: string;
  chapter: 1 | 2 | 3;
  index: number;
  name: string;
  /** 配置画面に出す1行。説明は面の作りで伝える */
  hint: string;
  field: Field;
  /** 手持ち。本陣は必ず1 */
  roster: Roster;
  /** 敵の配置と方針 */
  enemy: Placement[];
  enemyOrders?: StageEnemyOrder[];
  win: { type: 'defeat' } | { type: 'survive' } | { type: 'gate' };
  /** 第1章で、まだ教えていない操作を隠す */
  allow?: StageAllow;
  /** 配置中に見せない敵のマス */
  fog?: { col: number; row: number }[];
  /** 勝てる配置の見本（テスト用。画面には出さない） */
  solution: Placement[];
  /** 見本で出す号令（テスト用。画面には出さない）。号令が開く面で、配置と号令の組で勝つ見本にするため */
  solutionOrders?: StageEnemyOrder[];
}

/** 配置の画面に見せる敵の部隊。方針は含めない */
export interface StageEnemyView {
  kind: Kind;
  col: number;
  row: number;
}

/** 面の戦いの最長の刻み数（3分） */
export const STAGE_MAX_TICKS = 1800;

/** 面と自軍の配置から、戦いの設定を作る。win を時間切れの扱いに、enemyOrders を予定された号令に直す */
export function stageSetup(stage: Stage, placements: Placement[], seed: number): BattleSetup {
  return stageSetupWith(stage, placements, seed, []);
}

/** stageSetup に、自軍の予定された号令（見本の号令など）を足したもの */
export function stageSetupWith(stage: Stage, placements: Placement[], seed: number, myOrders: StageEnemyOrder[]): BattleSetup {
  const mine = myOrders.map((o) => ({ tick: Math.round(o.atSec * 10), side: 0 as Side, target: o.target, kind: o.kind }));
  // 門を破る面（gate）は段階4。それまでは、ふつうの面と同じく時間切れで負けにする
  const timeout: BattleSetup['timeout'] = stage.win.type === 'survive' ? 'side0_wins' : 'side0_loses';
  return {
    field: stage.field,
    armies: [placements, stage.enemy],
    seed,
    maxTicks: STAGE_MAX_TICKS,
    timeout,
    scriptedOrders: [...mine, ...(stage.enemyOrders ?? []).map((o) => ({ tick: Math.round(o.atSec * 10), side: 1 as Side, target: o.target, kind: o.kind }))],
  };
}

/** その面で選べる方針か（兵種の初期設定の方針は、いつでもよい） */
export function stanceAllowedInStage(stage: Stage, kind: Kind, stance: Stance): boolean {
  if (stance === defaultStance(kind)) return true;
  const list = stage.allow?.stances;
  return list === undefined || list.includes(stance);
}

/**
 * 面の配置を調べる。validateArmy（エリア・重なり・本陣1つ・部隊数）に加えて、兵種ごとの数が手持ちを超えていないこと、
 * その面で選べる方針であること。全部隊を置いていなくてもよい。どんな値を渡されても例外を投げない。
 */
export function validateStageArmy(stage: Stage, placements: Placement[]): ArmyError[] {
  if (!isObject(stage) || !isObject(stage.field) || !isDenseArray(stage.field.zones)) {
    return [{ code: 'invalid_cell', message: '面が正しくない' }];
  }
  const zone = stage.field.zones[0];
  const errors = validateArmy(placements, zone as never, { maxUnits: MAX_UNITS, requireHq: true });
  if (!isDenseArray(placements)) return errors;
  const count: Partial<Record<Kind, number>> = {};
  placements.forEach((p, index) => {
    if (!isObject(p) || typeof p.kind !== 'string') return;
    count[p.kind] = (count[p.kind] ?? 0) + 1;
    if (typeof p.stance === 'string' && !errors.some((e) => e.index === index && e.code === 'invalid_stance') && !stanceAllowedInStage(stage, p.kind, p.stance)) {
      errors.push({ code: 'invalid_stance', index, message: `この面では ${p.kind} に方針 ${p.stance} を選べない` });
    }
  });
  for (const [kind, n] of Object.entries(count) as [Kind, number][]) {
    const have = stage.roster[kind] ?? 0;
    if (n > have) errors.push({ code: 'over_roster', message: `${kind} が手持ちより多い: ${n} > ${have}` });
  }
  return errors;
}

/** 星の境目：残った兵の割合が [0] 以上で2つ、[1] 以上で3つ */
export const STAR_THRESHOLDS: readonly [number, number] = [0.5, 0.7];

/** 星（勝ったときだけ1以上）：残った兵の割合が STAR_THRESHOLDS[1]（0.7）以上で3つ、[0]（0.5）以上で2つ、それ未満で1つ。負けと引き分けは0 */
export function starsFor(summary: BattleSummary, side: Side): 0 | 1 | 2 | 3 {
  if (!isObject(summary) || summary.winner !== side) return 0;
  const r = summary.remaining?.[side];
  if (typeof r !== 'number' || !Number.isFinite(r)) return 1;
  if (r >= STAR_THRESHOLDS[1]) return 3;
  if (r >= STAR_THRESHOLDS[0]) return 2;
  return 1;
}

/** 配置の画面に見せる敵：霧のマスを除き、方針を含めない */
export function stageEnemyVisible(stage: Stage): StageEnemyView[] {
  const fog = new Set((stage.fog ?? []).map((c) => `${c.col},${c.row}`));
  return stage.enemy.filter((p) => !fog.has(`${p.col},${p.row}`)).map((p) => ({ kind: p.kind, col: p.col, row: p.row }));
}

/**
 * その面に、横陣のひな形をそのまま置いた配置（テストと sim の比べ用）。
 * 方針を出さない面では、方針を兵種の初期設定に直す。
 */
export function stageLineArmy(stage: Stage): Placement[] {
  const ps = applyTemplate('line', stage.roster, stage.field.zones[0], 0);
  return ps.map((p) => (stanceAllowedInStage(stage, p.kind, p.stance) ? p : { ...p, stance: defaultStance(p.kind) }));
}
