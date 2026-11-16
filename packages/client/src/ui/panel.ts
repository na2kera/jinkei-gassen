// 枠。採用されたドット調の見本（超富豪の look-pixel）と同じ作り：輪郭・金の線・中の塗りを 2px 単位で重ね、
// 四隅は 2px の段で欠く（角丸ではなく、ドットの段）。グラデーション・影・半透明は使わない。

import type Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import type { Rect } from '../layout.ts';

const U = 2;

/** 四隅を u px の段で2つ欠いた八角形を塗る（inset だけ内側に） */
function octagon(g: Phaser.GameObjects.Graphics, r: Rect, inset: number, color: number): void {
  const x = r.x + inset;
  const y = r.y + inset;
  const w = r.w - inset * 2;
  const h = r.h - inset * 2;
  if (w <= 0 || h <= 0) return;
  g.fillStyle(color, 1);
  g.fillRect(x + 2 * U, y, w - 4 * U, h);
  g.fillRect(x, y + 2 * U, w, h - 4 * U);
  g.fillRect(x + U, y + U, w - 2 * U, h - 2 * U);
}

export type FrameStyle = 'line' | 'dim' | 'hot' | 'solid';

/**
 * 枠を描く。
 * - line: 輪郭・金の線・暗い地（ふつうの箱とボタン）
 * - dim: 線が暗い（押せないボタン）
 * - hot: 線が明るい（選んでいる・押している）
 * - solid: 金の地（大事なボタン。上と左が明るく、下と右が暗い）
 */
export function drawFrame(g: Phaser.GameObjects.Graphics, r: Rect, style: FrameStyle = 'line'): void {
  octagon(g, r, 0, COLOR.outline);
  if (style === 'solid') {
    octagon(g, r, U, COLOR.gold);
    g.fillStyle(COLOR.goldHi, 1);
    g.fillRect(r.x + 2 * U, r.y + U, r.w - 4 * U, U);
    g.fillRect(r.x + U, r.y + 2 * U, U, r.h - 4 * U);
    g.fillStyle(COLOR.goldLo, 1);
    g.fillRect(r.x + 2 * U, r.y + r.h - 2 * U, r.w - 4 * U, U);
    g.fillRect(r.x + r.w - 2 * U, r.y + 2 * U, U, r.h - 4 * U);
    return;
  }
  const line = style === 'dim' ? COLOR.dim : style === 'hot' ? COLOR.goldHi : COLOR.gold;
  octagon(g, r, U, line);
  octagon(g, r, 2 * U, style === 'hot' ? 0x3a2c0c : COLOR.panel);
}

/** 文字を載せる箱（号令の表示、兵数の表示、方針の切り替えなど） */
export function drawBox(g: Phaser.GameObjects.Graphics, r: Rect): void {
  drawFrame(g, r, 'line');
}
