// 部隊に添える小さな印（5×5 の点を、7×7 の暗い札の上に描く）。
// 方針の印は配置の画面の自軍だけに、号令の印は戦闘中の号令がかかっている部隊に付ける。

import type { OrderKind, Stance } from '@jinkei/engine';
import type Phaser from 'phaser';
import { COLOR } from './palette.ts';
import { drawRows } from './textures.ts';

const STANCE_ICON: Record<Stance, string[]> = {
  // 前進：上向きの矢
  advance: ['..x..', '.xxx.', 'x.x.x', '..x..', '..x..'],
  // 守備：盾
  hold: ['xxxxx', 'x...x', 'x...x', '.x.x.', '..x..'],
  // 迂回：横へ回ってから上へ曲がる矢
  flank: ['...x.', '..xxx', '...x.', '...x.', 'xxxx.'],
  // 本陣狙い：的
  hunt: ['..x..', '.x.x.', 'x.x.x', '.x.x.', '..x..'],
};

const ORDER_ICON: Record<OrderKind, string[]> = {
  // 突撃：上向きの山形が2つ
  charge: ['..x..', '.x.x.', 'x.x.x', '.x.x.', 'x...x'],
  // 堅守：塗りつぶした盾
  brace: ['xxxxx', 'xxxxx', 'xxxxx', '.xxx.', '..x..'],
  // 後退：下向きの山形が2つ
  retreat: ['x...x', '.x.x.', 'x.x.x', '.x.x.', '..x..'],
};

/** 号令の札の色。突撃は赤、堅守は金、後退は暗い色で、形と色の両方で分ける */
const ORDER_PLATE: Record<OrderKind, number> = {
  charge: COLOR.red,
  brace: COLOR.goldLo,
  retreat: COLOR.ink,
};

function plate(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
  g.fillStyle(COLOR.outline, 1);
  g.fillRect(x, y, 7, 7);
  g.fillStyle(color, 1);
  g.fillRect(x + 1, y + 1, 5, 5);
}

/** (x, y) は札の左上 */
export function drawStanceIcon(g: Phaser.GameObjects.Graphics, stance: Stance, x: number, y: number): void {
  plate(g, x, y, COLOR.ink);
  drawRows(g, STANCE_ICON[stance], x + 1, y + 1, { x: COLOR.cream });
}

export function drawOrderIcon(g: Phaser.GameObjects.Graphics, kind: OrderKind, x: number, y: number): void {
  plate(g, x, y, ORDER_PLATE[kind]);
  drawRows(g, ORDER_ICON[kind], x + 1, y + 1, { x: COLOR.cream });
}

/** 太鼓（号令の文字の横に出す）。12×10 */
const DRUM = [
  '..kkkkkkkk..',
  '.kcccccccck.',
  'kcccccccccck',
  'kwwwwwwwwwwk',
  'kwrwwwwwwrwk',
  'kwwwwwwwwwwk',
  'kwrwwwwwwrwk',
  'kwwwwwwwwwwk',
  '.kwwwwwwwwk.',
  '..kkkkkkkk..',
];

export function drawDrum(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  drawRows(g, DRUM, x, y, { k: COLOR.outline, c: COLOR.cream, w: COLOR.red, r: COLOR.gold });
}
