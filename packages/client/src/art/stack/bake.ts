// 焼く（design §14.2・§14.3）：型を角度ごとに「回す・縦をつぶす（0.75 倍）・1 層ごとに 1px 上へ積む・明暗・輪郭」を 1 回で、
// 1 枚の絵（Uint32Array。1 画素 = 0xAABBGGRR。リトルエンディアンでは RGBA の並びのバイトになる）に描く。
// 試作（proto17v2/art.js）の bakeGeom・bakeOne・bakeSet の並べ方を写した。Phaser も DOM も読まない。

import type { Model } from './carve.ts';
import { ART } from '../palette.ts';
import { colorsFor, SHADE, TEAM_CHARS } from './parts.ts';

/** 向きの数（10° 刻み。design §14.3）。72 にすれば試作と同じ 5° 刻みに戻る（番号の式・枚数・並べ方は、どれもこの値から決まる） */
export const ANGLES = 36;
/** 縦のつぶし（どの向きでも同じ） */
export const SQUASH = 0.75;
/** 1 枚の絵の幅と高さの上限 */
export const TEX_MAX = 2048;

/** 0xRRGGBB → 0xAABBGGRR（不透明） */
export function abgr(c: number): number {
  return (0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0;
}

const OUTLINE_ABGR = abgr(ART.outline);

/** 光：画面の左上から（画面の座標で、地面の上の向き。x 右、y 手前） */
const LIGHT = ((): [number, number] => {
  const x = -0.8;
  const y = 0.35;
  const l = Math.hypot(x, y);
  return [x / l, y / l];
})();

/** 枠の大きさと、足もと（立てる中心の地面）の枠の中の位置 */
export interface Geom {
  readonly fw: number;
  readonly fh: number;
  readonly ax: number;
  readonly ay: number;
}

/** 半径 R・高さ H の型を、大きさ s で焼くときの枠 */
export function bakeGeom(R: number, H: number, s: number): Geom {
  const r = Math.ceil(R * s) + 1;
  const rs = Math.ceil(R * SQUASH * s) + 1;
  const fw = 2 * r + 2;
  const fh = 2 * rs + Math.ceil(H * s) + 3;
  return { fw, fh, ax: fw / 2, ay: rs + Math.ceil(H * s) + 1 };
}

/** 文字の番号 → 色（ABGR）。陣営ごと */
export type ColorTable = Uint32Array;

/** 陣営の色の表（文字の番号で引く） */
export function colorTable(team: 0 | 1): ColorTable {
  const t = new Uint32Array(128);
  const cm = colorsFor(team);
  for (const k of Object.keys(cm)) t[k.charCodeAt(0)] = abgr(cm[k]!);
  return t;
}

/** 明暗の表：文字の番号 → [影の側, 上の面] の番号（明暗のない文字は 0） */
const SHADE_DARK = new Uint8Array(128);
const SHADE_TOP = new Uint8Array(128);
for (const k of Object.keys(SHADE)) {
  const [dk, tp] = SHADE[k]!;
  SHADE_DARK[k.charCodeAt(0)] = dk.charCodeAt(0);
  SHADE_TOP[k.charCodeAt(0)] = tp.charCodeAt(0);
}

/** 焼くときの作業用の配列（枠 1 つぶん。使い回す） */
export function scratchFor(g: Geom): Int32Array {
  return new Int32Array(g.fw * g.fh);
}

/**
 * 型 m を角度 angle（画面で時計回り。ラジアン）、大きさ s で、buf（幅 bw）の (ox, oy) から fw × fh に描く。
 * vi は枠 1 つぶんの作業用の配列。
 */
export function bakeOne(buf: Uint32Array, bw: number, ox: number, oy: number, g: Geom, m: Model, angle: number, s: number, cmap: ColorTable, vi: Int32Array): void {
  const { fw, fh, ax, ay } = g;
  vi.fill(-1);
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const sq = SQUASH * s;
  for (let z = 0; z < m.H; z++) {
    const Rz = m.layerR[z]!;
    if (Rz < 0) continue;
    const cy = ay - z * s;
    const y0 = Math.max(0, Math.floor(cy - Rz * sq - 1));
    const y1 = Math.min(fh - 1, Math.ceil(cy + Rz * sq + 1));
    const x0 = Math.max(0, Math.floor(ax - Rz * s - 1));
    const x1 = Math.min(fw - 1, Math.ceil(ax + Rz * s + 1));
    const base = z * m.D * m.W;
    for (let py = y0; py <= y1; py++) {
      const dy = (py + 0.5 - cy) / sq;
      for (let px = x0; px <= x1; px++) {
        const dx = (px + 0.5 - ax) / s;
        const ix = Math.floor(dx * c + dy * sn + m.cx);
        const iy = Math.floor(-dx * sn + dy * c + m.cy);
        if (ix < 0 || iy < 0 || ix >= m.W || iy >= m.D) continue;
        const i = base + iy * m.W + ix;
        if (m.vox[i]) vi[py * fw + px] = i;
      }
    }
  }
  // 明暗と色
  for (let p = 0; p < fw * fh; p++) {
    const i = vi[p]!;
    if (i < 0) continue;
    const ch = m.vox[i]!;
    let tone = ch;
    const top = SHADE_TOP[ch]!;
    if (top) {
      if (m.topOpen[i]) tone = top;
      else {
        const nx = m.nx[i]!;
        const ny = m.ny[i]!;
        const sx = nx * c - ny * sn;
        const sy = nx * sn + ny * c;
        const d = sx * LIGHT[0] + sy * LIGHT[1];
        if (d < -0.45) tone = SHADE_DARK[ch]!;
      }
    }
    buf[(oy + Math.floor(p / fw)) * bw + ox + (p % fw)] = cmap[tone]!;
  }
  // 輪郭：重ねた結果のまわりに 1 回（4 方向）
  if (m.outline) {
    for (let py = 0; py < fh; py++)
      for (let px = 0; px < fw; px++) {
        const p = py * fw + px;
        if (vi[p]! >= 0) continue;
        if ((px > 0 && vi[p - 1]! >= 0) || (px < fw - 1 && vi[p + 1]! >= 0) || (py > 0 && vi[p - fw]! >= 0) || (py < fh - 1 && vi[p + fw]! >= 0)) {
          buf[(oy + py) * bw + ox + px] = OUTLINE_ABGR;
        }
      }
  }
}

/** 角度の番号 a（0..N−1。負や N 以上でもよい）の角度（ラジアン） */
export function angleOf(a: number, n = ANGLES): number {
  const i = ((a % n) + n) % n;
  return (i / n) * Math.PI * 2;
}

/** 敵軍の色の置き換え（自軍の陣営の 3 色 → 敵軍の 3 色） */
export function teamSwap(): Map<number, number> {
  const t0 = colorTable(0);
  const t1 = colorTable(1);
  const m = new Map<number, number>();
  for (const ch of TEAM_CHARS) m.set(t0[ch.charCodeAt(0)]!, t1[ch.charCodeAt(0)]!);
  return m;
}

/** 自軍の 1 コマを、色を置き換えて写す（敵軍の絵。形の計算をしない） */
export function copySwapped(buf: Uint32Array, bw: number, from: readonly [number, number], to: readonly [number, number], g: Geom, swap: Map<number, number>): void {
  for (let y = 0; y < g.fh; y++)
    for (let x = 0; x < g.fw; x++) {
      const v = buf[(from[1] + y) * bw + from[0] + x]!;
      buf[(to[1] + y) * bw + to[0] + x] = swap.get(v) ?? v;
    }
}

/** 1 枚の絵の並べ方（1 行に入るコマの数・絵の幅と高さ）。design §14.3 */
export interface Layout {
  readonly perRow: number;
  readonly w: number;
  readonly h: number;
}

export function sheetLayout(g: Geom, count: number): Layout {
  const perRow = Math.floor(TEX_MAX / g.fw);
  const w = Math.min(perRow, count) * g.fw;
  const h = Math.ceil(count / perRow) * g.fh;
  if (h > TEX_MAX) throw new Error(`焼いた絵が大きすぎる：${w}×${h}`);
  return { perRow, w, h };
}

/** コマ i の絵の中の位置 */
export function slotPos(l: Layout, g: Geom, i: number): [number, number] {
  return [(i % l.perRow) * g.fw, Math.floor(i / l.perRow) * g.fh];
}

/** 焼いた 1 枚の実際の絵の範囲（足もとから左・右・上・下に何 px 出ているか）。何も描いていなければ全部 0 */
export interface Extent {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
}

export function extentOf(buf: Uint32Array, bw: number, ox: number, oy: number, g: Geom): Extent {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < g.fh; y++)
    for (let x = 0; x < g.fw; x++) {
      if (!buf[(oy + y) * bw + ox + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return { left: 0, right: 0, up: 0, down: 0 };
  return { left: g.ax - x0, right: x1 + 1 - g.ax, up: g.ay - y0, down: y1 + 1 - g.ay };
}

/** 1 コマの中の、自軍の陣営の色（main・light）の点の数（本陣の 2 体のとき、幟が広く見える護衛を選ぶため。design §14.8） */
export function teamPixels(buf: Uint32Array, bw: number, ox: number, oy: number, g: Geom): number {
  const t0 = colorTable(0);
  const a = t0['a'.charCodeAt(0)]!;
  const b = t0['b'.charCodeAt(0)]!;
  let n = 0;
  for (let y = 0; y < g.fh; y++)
    for (let x = 0; x < g.fw; x++) {
      const v = buf[(oy + y) * bw + ox + x];
      if (v === a || v === b) n++;
    }
  return n;
}
