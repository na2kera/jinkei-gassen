// 部隊の上に出す、文字の箱の置き場所（戦闘の画面の兵数と士気、配置の画面の敵の兵種で共通）。
// Phaser を使わない計算だけにして、画面なしで確かめられるようにする。

import type { Point } from '../battle/FieldView.ts';
import type { Rect } from '../layout.ts';

/**
 * 幅 w・高さ h の箱を、画面の点 p にいる部隊の上に置く左上の位置。上に入らなければ下に置く。
 * 横は戦場 f の中に収め、座標は 2px 単位にそろえる。lift は部隊の足もとから箱の下の端までの離れ。
 */
export function unitBoxAt(f: Rect, p: Point, w: number, h: number, lift: number): Point {
  // 指で隠れないよう部隊の上に出し、戦場の中に収める
  const x = Math.round(Math.max(f.x, Math.min(f.x + f.w - w, p.x - w / 2)) / 2) * 2;
  const y = Math.round((p.y - lift - h >= f.y ? p.y - lift - h : p.y + 20) / 2) * 2;
  return { x, y };
}
