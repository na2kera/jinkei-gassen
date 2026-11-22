// 立体の部隊の、体の数・並び・型の選び方（design §14.8）。画面なしで確かめられるように、Phaser を読まない。
// 試作（proto17v2/main.js）の countFor・slotOffset・modelFor を写した。古い並び（art/formation.ts の slotsOf）は道具のために残す。

import type { Kind } from '@jinkei/engine';
import type { ModelId } from './parts.ts';

/** 兵の残りの割合 → 体の数（本陣も同じ） */
export function countFor(ratio: number): 0 | 1 | 2 | 3 {
  if (ratio > 0.66) return 3;
  if (ratio > 0.34) return 2;
  if (ratio > 0) return 1;
  return 0;
}

/**
 * 並び（[横, 前後]。前後は負が前＝敵の方）。単位は 1マス 36px で決めた試作の値で、使うときに 32/36 を掛ける。
 * 3 体：前のまん中、後ろの左右。2 体：横に並ぶ。1 体：まん中。
 */
const SLOTS: Record<1 | 2 | 3, readonly (readonly [number, number])[]> = {
  3: [
    [0, -7.5],
    [-8.5, 6.5],
    [8.5, 6.5],
  ],
  2: [
    [-6.5, 0],
    [6.5, 0],
  ],
  1: [[0, 0]],
};

/** 1マスの大きさ（盤の px） */
const CELL_PX = 32;

/**
 * n 体の部隊の slot 番目の兵の、部隊のまん中からの位置（盤の px。u 右・v 下）。heading は部隊の向き（ラジアン。0 が右、π/2 が下）。
 * spread は並びの間隔の倍率（敗走で広げる）。
 */
export function slotOffset(heading: number, slot: number, n: 1 | 2 | 3, spread = 1): { u: number; v: number } | null {
  const L = SLOTS[n][slot];
  if (!L) return null;
  const f = [Math.cos(heading), Math.sin(heading)] as const;
  const r = [-Math.sin(heading), Math.cos(heading)] as const;
  const q = (CELL_PX / 36) * spread;
  return { u: (L[0] * r[0] - L[1] * f[0]) * q, v: (L[0] * r[1] - L[1] * f[1]) * q };
}

/**
 * 兵の型。歩兵・盾兵・弓兵・騎兵は同じ型を並べる。
 * 本陣は、3 体なら 将（前）・幟の護衛 B（後ろの左）・幟の護衛 A（後ろの右）。
 * 2 体なら 将と、いまの向きで幟が広く見えるほうの護衛（guardAWider：焼いたときに数えた陣営の色の点の数で A が B 以上か）。
 * 1 体なら、旗を背負った将。
 */
export function modelFor(kind: Kind, n: 1 | 2 | 3, slot: number, guardAWider = true): ModelId {
  if (kind !== 'hq') return kind;
  if (n === 1) return 'generalF';
  if (n === 2) return slot === 0 ? 'general' : guardAWider ? 'guardA' : 'guardB';
  return (['general', 'guardB', 'guardA'] as const)[slot] ?? 'general';
}
