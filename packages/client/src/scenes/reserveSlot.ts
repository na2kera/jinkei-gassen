// 配置の画面の「遊軍」の枠（design §7.8）で使う数え方。Phaser を使わない計算だけにして、画面なしで確かめられるようにする。
// 遊軍は手持ちから1部隊を回したもの。1人用の手持ちの残りは「手持ち − 戦場に置いた数 − 遊軍（その兵種なら1）」で数える。
// 枠への出し入れ・ひな形・陣形の呼び出しは deployModel.ts（design §15）が受け持つ。

import type { Kind, Placement, ReserveSetup, Roster } from '@jinkei/engine';

/** その兵種の、まだ置いていない数（戦場と遊軍の枠の両方を引く） */
export function remainingOf(roster: Roster, list: readonly Placement[], reserve: ReserveSetup | null, kind: Kind): number {
  const placed = list.filter((p) => p.kind === kind).length;
  return (roster[kind] ?? 0) - placed - (reserve && reserve.kind === kind ? 1 : 0);
}
