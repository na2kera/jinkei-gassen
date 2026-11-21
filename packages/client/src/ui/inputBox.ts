// 入力欄の、canvas の親（#game）の中での位置と大きさ（design §12.2）。Phaser を読まない計算だけ。
// 欄は親の中に position: absolute で置くので、「canvas の矩形 − 親の矩形」に、内部の座標 × 倍率を足す。
// canvas と親は一緒に動く（iOS がキーボードでページをずらしても）ので、差は変わらない。

import type { Rect } from '../layout.ts';

/** getBoundingClientRect の値のうち、使う所だけ */
export interface Box {
  left: number;
  top: number;
  width: number;
}

/** 入力欄の、親の中での位置と大きさ（px）。canvas と parent は getBoundingClientRect の値、gameW は内部の幅 */
export function inputBox(
  canvas: Box,
  parent: Box,
  gameW: number,
  rect: Rect,
): { left: number; top: number; width: number; height: number; k: number } {
  const k = canvas.width / gameW;
  return {
    left: canvas.left - parent.left + rect.x * k,
    top: canvas.top - parent.top + rect.y * k,
    width: rect.w * k,
    height: rect.h * k,
    k,
  };
}
