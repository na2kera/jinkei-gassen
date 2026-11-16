// シーンをまたいで持つもの（いまの面、その面の配置、直前の戦いの結果）。
// シーンは向きの切り替えで作り直すことがあるので、消えて困るものはシーンの中に持たない。
// 面ごとの最後の配置と星は save.ts に残す。

import {
  defaultStance,
  STAGES,
  stageSetupWith,
  stanceAllowed,
  stanceAllowedInStage,
  validateStageArmy,
  type BattleSetup,
  type BattleSummary,
  type Placement,
  type Side,
  type Stage,
  type StageEnemyOrder,
  type UnitView,
} from '@jinkei/engine';
import { savedPlacements, savePlacements, starsOf } from './save.ts';

export interface ResultData {
  stageId: string;
  summary: BattleSummary;
  /** 見ていた陣営（勝ち負けと、自軍・敵軍の振り分けに使う） */
  viewer: Side;
  /** 最後の場面の部隊（振り返りで翼と兵種を引くため） */
  units: UnitView[];
}

interface Session {
  stageId: string;
  placements: Placement[];
  result: ResultData | null;
}

const first = STAGES[0];

export const session: Session = {
  stageId: first ? first.id : '',
  placements: [],
  result: null,
};

export function stageById(id: string): Stage | undefined {
  return STAGES.find((s) => s.id === id);
}

export function currentStage(): Stage {
  // STAGES は engine が必ず1面以上持っている
  return stageById(session.stageId) ?? STAGES[0]!;
}

/** 章と番号の順に並べた面（データの並び順に頼らず、章が増えても正しい順で開く・並ぶようにする） */
export function orderedStages(): Stage[] {
  return STAGES.slice().sort((a, b) => a.chapter - b.chapter || a.index - b.index);
}

/** 次の面。最後の面なら null */
export function nextStage(id: string): Stage | null {
  const list = orderedStages();
  const i = list.findIndex((s) => s.id === id);
  return i >= 0 ? (list[i + 1] ?? null) : null;
}

/** 前の面（STAGES の並び）を勝っていれば開く。最初の面はいつも開いている */
export function isUnlocked(stage: Stage): boolean {
  const list = orderedStages();
  const i = list.findIndex((s) => s.id === stage.id);
  if (i <= 0) return true;
  const prev = list[i - 1];
  return !!prev && starsOf(prev.id) > 0;
}

/** STAGES にある章の番号（あとで章が増えたら自動で増える） */
export function chapters(): number[] {
  return [...new Set(STAGES.map((s) => s.chapter))].sort((a, b) => a - b);
}

/** 対戦は、第1章の面をすべて勝ったら開く（decisions §8） */
export function pvpUnlocked(): boolean {
  const ch1 = STAGES.filter((s) => s.chapter === 1);
  return ch1.length > 0 && ch1.every((s) => starsOf(s.id) > 0);
}

/** その面で選べる方針か（engine の兵種の決まりと、面の決まりの両方） */
export function stanceOk(stage: Stage, p: Pick<Placement, 'kind' | 'stance'>): boolean {
  return stanceAllowed(p.kind, p.stance) && stanceAllowedInStage(stage, p.kind, p.stance);
}

/** 置いた途中の配置として使えるか。本陣がない・部隊が足りないのは途中なのでよい。エリアの外や手持ちを超えるものはだめ */
function usable(stage: Stage, placements: Placement[]): boolean {
  const bad = new Set(['invalid_kind', 'invalid_stance', 'invalid_cell', 'out_of_zone', 'overlap', 'over_roster', 'too_many_units']);
  return !validateStageArmy(stage, placements).some((e) => bad.has(e.code));
}

/** 面を開く。前にその面で置いた配置があれば戻す（面のデータが変わって合わなくなっていたら捨てる） */
export function openStage(id: string): Stage {
  const stage = stageById(id) ?? STAGES[0]!;
  session.stageId = stage.id;
  const saved = savedPlacements(stage.id);
  session.placements = saved && usable(stage, saved) ? saved : [];
  return stage;
}

/** 配置を変えたら呼ぶ。面ごとの最後の配置として残す */
export function setPlacements(list: Placement[]): void {
  session.placements = list;
  savePlacements(session.stageId, list);
}

/** ひな形などで並べた配置の方針を、その面で選べるものに直す（選べない方針は兵種の初期設定へ） */
export function fitStances(stage: Stage, list: Placement[]): Placement[] {
  return list.map((p) => (stanceOk(stage, p) ? p : { ...p, stance: defaultStance(p.kind) }));
}

export function armyErrors(placements: Placement[]): ReturnType<typeof validateStageArmy> {
  // 全部隊を置かなくても、本陣と1部隊以上あれば開戦できる
  return validateStageArmy(currentStage(), placements);
}

/** 開戦の設定。myOrders は開発用（見本の号令を予定に入れて確かめる）で、ふつうは空 */
export function battleSetup(myOrders: StageEnemyOrder[] = []): BattleSetup {
  // 種は client が毎回決める（engine は乱数の元を持たない）。同じ配置でも戦いごとに少し違う展開になる
  const seed = (Math.random() * 0x100000000) >>> 0;
  return stageSetupWith(currentStage(), session.placements.map((p) => ({ ...p })), seed, myOrders);
}
