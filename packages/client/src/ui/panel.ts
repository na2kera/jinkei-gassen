// 平らな塗りと 2px の枠だけでできた箱。角丸・影・半透明は使わない。

import type Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import type { Rect } from '../layout.ts';

export function drawBox(
  g: Phaser.GameObjects.Graphics,
  r: Rect,
  fill: number = COLOR.panel,
  border: number = COLOR.border,
): void {
  g.fillStyle(border, 1);
  g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle(fill, 1);
  g.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
}
