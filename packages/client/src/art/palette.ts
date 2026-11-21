// 色の一覧。平らな塗りだけで描くので、色はここに集めて増やしすぎないようにする。
// 画面の枠と文字の色は、採用されたドット調の見本（超富豪の look-pixel）に合わせ、暗い焦げ茶の地に金の枠にしている。

export const COLOR = {
  // 画面
  bg: 0x100d08,
  panel: 0x1d1810,
  panel2: 0x2a2216,
  outline: 0x0a0806,
  gold: 0xe2b93b,
  goldHi: 0xffe9a0,
  goldLo: 0x9a6e1a,
  dim: 0x6b5a36,
  cream: 0xf4ecd2,
  muted: 0xa8997a,
  ink: 0x1c1820,
  red: 0xc8463a,
  highlight: 0xffe9a0,

  // 戦場
  grass1: 0x55762f,
  grass2: 0x4c6b2a,
  grass3: 0x648638,
  zone: 0x2a2216,
  pole: 0x3a2a14,
} as const;

/**
 * 色の組（assumptions S11：自軍は藍、敵軍は朱）。main は服、light は明るい側、dark は影。
 * 添字は engine の陣営ではなく「見ている人から見て自軍か（0）敵軍か（1）」。対戦で陣営1の人も、自軍は藍で見える。
 */
export const SIDE_COLOR: Record<0 | 1, { main: number; light: number; dark: number }> = {
  0: { main: 0x2c4a8c, light: 0x7d9de0, dark: 0x1a2a52 },
  1: { main: 0xc8402a, light: 0xf2925e, dark: 0x6e1e14 },
};

/** 兵の絵で使う、陣営によらない色 */
export const ART = {
  outline: 0x16100a,
  iron: 0x7c7f88,
  metal: 0xdcdcd2,
  wood: 0x8a5a2a,
  bronze: 0xc0904a,
  bronzeLo: 0x7e5a26,
  hat: 0xc8a060,
  bow: 0x6a3a1a,
  horse: 0x7a4a24,
  horseLo: 0x4a2c14,
  gold: 0xe2b93b,
  skin: 0xe0b080,
} as const;

export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
