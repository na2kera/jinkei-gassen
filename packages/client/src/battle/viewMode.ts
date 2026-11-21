// 戦闘の画面の視点の種類と、視点のボタンで回す順（design §5.8.1）。
// Phaser も保存の口も使わない計算だけにして、画面なしで確かめられるようにする。
// 将軍の視点は、盤を変えるときになくした（design §13.8、decisions §22）。保存に残っていたら真上として読む。

/** 真上・斜め・横から */
export type ViewMode = 'top' | 'oblique' | 'side';

/** 視点のボタンで回す順（真上 → 斜め → 横から → 真上） */
export const VIEW_CYCLE: readonly ViewMode[] = ['top', 'oblique', 'side'];

/** 保存してある値を視点に直す。知らない値（なくした将軍の視点を含む）は真上 */
export function parseView(v: unknown): ViewMode {
  return VIEW_CYCLE.includes(v as ViewMode) ? (v as ViewMode) : 'top';
}

/** 視点のボタンを押したときの、次の視点 */
export function nextView(v: ViewMode): ViewMode {
  const i = VIEW_CYCLE.indexOf(v);
  return VIEW_CYCLE[(i + 1) % VIEW_CYCLE.length]!;
}
