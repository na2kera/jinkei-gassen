// 戦闘の画面の盤の向きと、視点のボタンで回す順（design §14.11）。
// Phaser も保存の口も使わない計算だけにして、画面なしで確かめられるようにする。
// 真上・斜め・将軍の視点は、立体にしたときになくした（decisions §24）。

import type { BoardDir } from './camera.ts';

/** 右斜め 30°・左斜め −30°・横 90°・後ろ 0° */
export type ViewMode = BoardDir;

/** 視点のボタンで回す順（右斜め → 左斜め → 横 → 後ろ → 右斜め。試作と同じ） */
export const VIEW_CYCLE: readonly ViewMode[] = ['right', 'left', 'side', 'back'];

/**
 * 保存してある値を向きに直す。いまの 4 つはそのまま（'side' は前の版でも横なので、そのまま横として読む）。
 * 'top'・'oblique'・なくした将軍の視点など、ほかの知らない値は右斜め（保存の版は上げない）
 */
export function parseView(v: unknown): ViewMode {
  return VIEW_CYCLE.includes(v as ViewMode) ? (v as ViewMode) : 'right';
}

/** 立体の画面の盤の向き（parseView と同じ） */
export function boardDirOf(v: unknown): BoardDir {
  return parseView(v);
}

/** 視点のボタンを押したときの、次の向き */
export function nextView(v: ViewMode): ViewMode {
  const i = VIEW_CYCLE.indexOf(v);
  return VIEW_CYCLE[(i + 1) % VIEW_CYCLE.length]!;
}
