// 丘の高さ（design §14.7）：盤の 1px ごとの高さの表と、点の高さ。見た目だけ（丘の効果は engine のまま）。
// 試作（proto17v2/main.js）の buildHeight・heightAt を写した。Phaser も DOM も読まない。

/** 丘のいちばん高い所の上の限り（px） */
export const HILL_MAX = 9;
/** 丘の縁から、この距離（px）で最も高くなる */
export const HILL_RAMP = 30;

/** 高さの表（盤の px ごと。w × h） */
export interface HeightMap {
  readonly w: number;
  readonly h: number;
  readonly data: Float32Array;
}

/**
 * 丘のマスの中の点について、丘でないマス（盤の外も含む）までの距離を求め、半径 6px の箱のぼかしを 2 回かけ、
 * hmax × なめらかな段(min(1, 距離 / ramp)) にする。丘でないマスは 0。
 */
export function buildHeight(cols: number, rows: number, cell: number, isHill: (c: number, r: number) => boolean, hmax = HILL_MAX, ramp = HILL_RAMP): HeightMap {
  const w = cols * cell;
  const h = rows * cell;
  const hm = new Float32Array(w * h);
  const hill = (c: number, r: number): boolean => r >= 0 && r < rows && c >= 0 && c < cols && isHill(c, r);
  // 丘でないマス（盤の外も含む）の四角までの距離。丘のマスの中だけ求める
  const others: [number, number][] = [];
  for (let r = -1; r <= rows; r++) for (let c = -1; c <= cols; c++) if (!hill(c, r)) others.push([c * cell, r * cell]);
  const ease = (t: number): number => t * t * (3 - 2 * t);
  const dist = new Float32Array(w * h);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!hill(c, r)) continue;
      const near = others.filter(([x, y]) => Math.abs(x - c * cell) <= 3 * cell && Math.abs(y - r * cell) <= 3 * cell);
      for (let py = r * cell; py < (r + 1) * cell; py++)
        for (let px = c * cell; px < (c + 1) * cell; px++) {
          const X = px + 0.5;
          const Y = py + 0.5;
          let d = 1e9;
          for (const [x0, y0] of near) {
            const dx = Math.max(x0 - X, 0, X - (x0 + cell));
            const dy = Math.max(y0 - Y, 0, Y - (y0 + cell));
            d = Math.min(d, Math.hypot(dx, dy));
          }
          dist[py * w + px] = d;
        }
    }
  // 箱のぼかしを 2 回（角と稜線を丸める。ぼかしは傾きを大きくしない）
  const blur = (src: Float32Array, rad: number): Float32Array => {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -rad; x <= rad; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * rad + 1);
        acc += src[y * w + Math.min(w - 1, x + rad + 1)]! - src[y * w + Math.max(0, x - rad)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -rad; y <= rad; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * rad + 1);
        acc += tmp[Math.min(h - 1, y + rad + 1) * w + x]! - tmp[Math.max(0, y - rad) * w + x]!;
      }
    }
    return out;
  };
  const sm = blur(blur(dist, 6), 6);
  for (let i = 0; i < w * h; i++) {
    const px = i % w;
    const py = Math.floor(i / w);
    if (!hill(Math.floor(px / cell), Math.floor(py / cell))) continue;
    hm[i] = hmax * ease(Math.min(1, sm[i]! / ramp));
  }
  return { w, h, data: hm };
}

/** 盤の上の点 (u, v)（盤のまん中が原点。盤の px）の高さ（近い 4 点の重み付き） */
export function heightAt(hm: HeightMap, u: number, v: number): number {
  const { w, h, data } = hm;
  const x = u + w / 2 - 0.5;
  const y = v + h / 2 - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const g = (xx: number, yy: number): number => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : data[yy * w + xx]!);
  return g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy) + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy;
}

/** 戦場の丘の高さの表（丘のない戦場は null） */
export function fieldHeight(field: { width: number; height: number; terrain: readonly string[] }): HeightMap | null {
  if (!field.terrain.includes('hill')) return null;
  return buildHeight(field.width, field.height, 32, (c, r) => field.terrain[r * field.width + c] === 'hill');
}
