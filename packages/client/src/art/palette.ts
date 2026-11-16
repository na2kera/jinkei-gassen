// 色の一覧。平らな塗りだけで描くので、色はここに集めて増やしすぎないようにする。

import type { Side } from '@jinkei/engine';

export const COLOR = {
  bg: 0x1a1a1a,
  plain: 0x5b7a3c,
  zoneA: 0x66873f,
  zoneB: 0x5b7a3c,
  panel: 0x262626,
  button: 0x3a3a3a,
  border: 0xd0d0d0,
  borderDim: 0x5a5a5a,
  text: 0xf0f0f0,
  textDim: 0x7a7a7a,
  selected: 0xd0d0d0,
  selectedText: 0x1a1a1a,
  highlight: 0xf0d040,
  pole: 0x3a2a1a,
  hqFlag: 0xf0d040,
} as const;

/**
 * 色の組（assumptions S11：自軍は藍、敵軍は朱）。main は体、light は前の印と旗。
 * 添字は engine の陣営ではなく「見ている人から見て自軍か（0）敵軍か（1）」。対戦で陣営1の人も、自軍は藍で見える。
 */
export const SIDE_COLOR: Record<Side, { main: number; light: number }> = {
  0: { main: 0x2c4a8c, light: 0x9ab8f0 },
  1: { main: 0xc8402a, light: 0xf4c090 },
};

export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
