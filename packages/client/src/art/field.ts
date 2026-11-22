// 戦場のまわりの枠と、配置エリアの印（立体の画面でも使う小さな関数。地面の絵は art/stack/ground.ts）。

import type { Zone } from '@jinkei/engine';
import type Phaser from 'phaser';
import { COLOR } from './palette.ts';
import type { Rect } from '../layout.ts';

/** 戦場のまわりの枠（輪郭 2px + 暗い金 2px）。描き場所（area）の外側に付ける */
export function drawFieldFrame(g: Phaser.GameObjects.Graphics, fv: { rect: Rect }, area: Rect = fv.rect): void {
  const r = area;
  g.fillStyle(COLOR.dim, 1);
  g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  g.fillStyle(COLOR.outline, 1);
  g.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
}

/**
 * 配置エリアの印（配置の画面だけ）。エリアの縁を、2px の点線で囲む。自軍は明るく、敵軍は暗く。
 * 塗りつぶさないのは、草地の絵を隠さず、エリアの境目だけが分かればよいため。
 */
export function drawZone(g: Phaser.GameObjects.Graphics, fv: { cellRect(col: number, row: number): Rect }, zone: Zone, color: number): void {
  const a = fv.cellRect(zone.col, zone.row);
  const b = fv.cellRect(zone.col + zone.width - 1, zone.row + zone.height - 1);
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  g.fillStyle(color, 1);
  for (let x = x0; x < x1; x += 8) {
    g.fillRect(x, y0, 4, 2);
    g.fillRect(x, y1 - 2, 4, 2);
  }
  for (let y = y0; y < y1; y += 8) {
    g.fillRect(x0, y, 2, 4);
    g.fillRect(x1 - 2, y, 2, 4);
  }
}
