// 文字。DotGothic16 の 16px と 32px だけを使う（ユーザーの好み。縁取りや影は付けない）。

import Phaser from 'phaser';
import { COLOR, css } from '../art/palette.ts';

export const FONT_FAMILY = 'DotGothic16';
export type FontSize = 16 | 32;

export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  size: FontSize = 16,
  color: number = COLOR.cream,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, str, {
    fontFamily: FONT_FAMILY,
    fontSize: `${size}px`,
    color: css(color),
  });
}
