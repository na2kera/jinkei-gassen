// 配置の画面で押したマスにいる、見えている敵の部隊を探す（Phaser を使わず、画面なしで確かめられるようにする）。

import type { StageEnemyView } from '@jinkei/engine';
import type { Cell } from '../battle/FieldView.ts';

/**
 * cell にいる敵の部隊。visible には stageEnemyVisible の結果（霧のマスの部隊と方針を含まない）を渡す。
 * 対戦の配置では相手が見えないので、空の配列を渡す（何も見つからない）。
 */
export function enemyAt(visible: readonly StageEnemyView[], cell: Cell): StageEnemyView | null {
  return visible.find((p) => p.col === cell.col && p.row === cell.row) ?? null;
}
