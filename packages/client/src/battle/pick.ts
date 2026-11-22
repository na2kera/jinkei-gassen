// 押した所から部隊を選ぶ（design §14.4）。描いた側（部隊の絵）が返す、いま見えている兵の矩形から選ぶ。
// Phaser を読まない計算だけにして、画面なしで確かめられるようにする。

/** いま見えている兵 1 体の、画面の矩形と前後の値 */
export interface HitBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

/** 部隊のまん中の足もとの画面の点 */
export interface SquadCenter {
  id: number;
  x: number;
  y: number;
}

/** 矩形を広げる幅（px） */
export const PICK_GROW = 2;
/** どの矩形にも入らないとき、部隊のまん中から選べる離れ（px） */
export const PICK_NEAR = 12;

/**
 * 1. 矩形を上下左右に 2px 広げ、押した点が入る矩形のうち、兵の depth がいちばん大きい（手前の）ものの部隊。
 * 2. なければ、centers のうち押した点から 12px 以内でいちばん近い部隊（centers を渡さなければ使わない）。
 * 3. それもなければ null
 */
export function pickSquad(boxes: readonly HitBox[], centers: readonly SquadCenter[] | null, sx: number, sy: number): number | null {
  let best: HitBox | null = null;
  for (const b of boxes) {
    if (sx < b.x - PICK_GROW || sy < b.y - PICK_GROW || sx > b.x + b.w + PICK_GROW || sy > b.y + b.h + PICK_GROW) continue;
    if (!best || b.depth > best.depth) best = b;
  }
  if (best) return best.id;
  if (!centers) return null;
  let near: { id: number; d: number } | null = null;
  for (const c of centers) {
    const d = Math.hypot(c.x - sx, c.y - sy);
    if (d <= PICK_NEAR && (!near || d < near.d)) near = { id: c.id, d };
  }
  return near ? near.id : null;
}
