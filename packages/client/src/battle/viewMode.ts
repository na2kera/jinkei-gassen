// 戦闘の画面の視点の種類と、視点のボタンで回す順（design §5.8.1）。
// Phaser も保存の口も使わない計算だけにして、画面なしで確かめられるようにする。

/** 真上・斜め・横から・将軍 */
export type ViewMode = 'top' | 'oblique' | 'side' | 'general';

export const VIEW_MODES: readonly ViewMode[] = ['top', 'oblique', 'side', 'general'];

/** 視点のボタンで回す順（真上 → 斜め → 横から → 将軍 → 真上） */
export const VIEW_CYCLE: readonly ViewMode[] = ['top', 'oblique', 'side', 'general'];

/** 保存してある値を視点に直す。知らない値は真上 */
export function parseView(v: unknown): ViewMode {
  return VIEW_MODES.includes(v as ViewMode) ? (v as ViewMode) : 'top';
}

/** いま使える視点に直す（回す順に入っていない視点が保存されていたら、真上として扱う） */
export function usableView(v: ViewMode): ViewMode {
  return VIEW_CYCLE.includes(v) ? v : 'top';
}

/** 視点のボタンを押したときの、次の視点 */
export function nextView(v: ViewMode): ViewMode {
  const i = VIEW_CYCLE.indexOf(usableView(v));
  return VIEW_CYCLE[(i + 1) % VIEW_CYCLE.length]!;
}
