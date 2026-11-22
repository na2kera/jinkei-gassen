// 部隊の中の兵の並び（design §5.3、§5.8.1）。Phaser を使わない計算だけにして、画面なしで確かめられるようにする。
// 立体の画面では使わない（立体の部隊の並びは art/stack/squad.ts）。ポスターと OGP の道具が古い兵の絵と並びを使うので、そのために残す。

import type { Kind } from '@jinkei/engine';
import { shapeOf, soldierReach, type Dir4, type SoldierShape } from './textures.ts';

export interface Slot {
  lx: number;
  ly: number;
  shape: SoldierShape;
}

// 並びの間隔は、1マス 32px に合わせて、24px のときの約 4/3 倍にした整数の px（design §13.8）。
// 部隊どうしの中心は 0.9 マス（28.8px）まで近づくので、unitReach を全兵種で 14.4px 未満に収める

/** 歩兵・盾兵・弓兵：3×3。並びの順は前の列から（兵が減るときは後ろから消す） */
const FOOT: { lx: number; ly: number }[] = [];
for (const ly of [-5, 0, 5]) for (const lx of [-7, 0, 7]) FOOT.push({ lx, ly });
/** 騎兵：馬が大きいので 2×2 */
const CAVALRY = [
  { lx: -4, ly: -5 },
  { lx: 4, ly: -5 },
  { lx: -4, ly: 5 },
  { lx: 4, ly: 5 },
];
/** 本陣：まん中に将、四隅に護衛 */
const HQ_GUARDS = [
  { lx: -7, ly: -5 },
  { lx: 7, ly: -5 },
  { lx: -7, ly: 5 },
  { lx: 7, ly: 5 },
];

/** 兵種ごとの兵の並び（ly が負なら前の列、lx が正なら部隊の右手） */
export function slotsOf(kind: Kind): Slot[] {
  if (kind === 'hq') {
    return [{ lx: 0, ly: 0, shape: 'general' }, ...HQ_GUARDS.map((o) => ({ ...o, shape: 'guard' as const }))];
  }
  const shape = shapeOf(kind);
  return (kind === 'cavalry' ? CAVALRY : FOOT).map((o) => ({ ...o, shape }));
}

/** 敗走で散らばるときの、兵ごとのずれ（毎回同じになるよう固定の値） */
export const SCATTER = Array.from({ length: 9 }, (_, i) => ({ x: ((i * 37) % 11) / 10 - 0.5, y: ((i * 53) % 13) / 12 - 0.5 }));

/** 画面の上での向きから、兵の4方向の絵を選ぶ（古い絵の並びの検査に使う） */
export function dirOf(dx: number, dy: number): Dir4 {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy < 0 ? 0 : 2;
}

/** 部隊の絵が中心からどこまで届くか（並びを回しても、この値を超えない。真上の絵で測る） */
export function unitReach(kind: Kind): number {
  return Math.max(...slotsOf(kind).map((s) => Math.hypot(s.lx, s.ly) + soldierReach(s.shape)));
}
