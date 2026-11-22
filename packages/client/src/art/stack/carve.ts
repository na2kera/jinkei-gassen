// 削り出し（design §14.2）：部品ごとに「4 つの絵すべてが覆う所」を残し、1px の箱の集まり（型）にする。
// 試作（proto17v2/art.js）の carve・makeModel を写した。焼いた絵が試作と同じになるよう、計算の順と型（Float32Array）をそろえている。
// 試作は箱を文字の配列で持っていたが、ここでは文字の番号（Uint8Array。0 は空）で持つ（ワーカーで軽くするため。中身は同じ）。

import type { Dims, Entry, Part } from './parts.ts';

/** 立体の型：箱（文字の番号）と、上が空いているか・横の面の向き（明暗に使う）・半径 */
export interface Model {
  readonly W: number;
  readonly D: number;
  readonly H: number;
  /** (z * D + y) * W + x の箱の文字の番号。0 は空 */
  readonly vox: Uint8Array;
  readonly topOpen: Uint8Array;
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  /** 立てる中心からいちばん遠い箱の角までの距離 */
  readonly R: number;
  /** 層ごとの R（箱のない層は −1） */
  readonly layerR: Float32Array;
  readonly cx: number;
  readonly cy: number;
  readonly outline: boolean;
}

/** 空の箱の並び */
export function emptyVox(dims: Dims): Uint8Array {
  return new Uint8Array(dims.W * dims.D * dims.H);
}

/** 部品の 4 つの絵の大きさがそろっているか確かめる */
function checkPart(p: Part, label: string): void {
  const w = p.top[0]!.length;
  const d = p.top.length;
  const h = p.front.length;
  const back = p.back ?? p.front;
  const bad =
    p.top.some((r) => r.length !== w) ||
    p.side.length !== h ||
    p.side.some((r) => r.length !== d) ||
    p.front.some((r) => r.length !== w) ||
    back.length !== h ||
    back.some((r) => r.length !== w);
  if (bad) throw new Error(`部品の大きさが合わない：${label} ${JSON.stringify(p.front[0])}`);
}

/**
 * 部品 1 つを削り出して vox に書く（仕事の区切りは部品 1 つ。design §14.3）。
 * 色は面している側の絵から取る。上が空いている所は真上の絵。
 */
export function carvePart(dims: Dims, vox: Uint8Array, entry: Entry, label: string): void {
  const { W, D, H } = dims;
  const [p, ox, oy, oz] = entry;
  checkPart(p, label);
  const w = p.top[0]!.length;
  const d = p.top.length;
  const h = p.front.length;
  const back = p.back ?? p.front;
  const at = (rows: readonly string[], r: number, c: number): string => rows[r]![c]!;
  let inside = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < w && y < d && z < h && at(p.top, y, x) !== '.' && at(p.side, h - 1 - z, y) !== '.' && at(p.front, h - 1 - z, x) !== '.' && at(back, h - 1 - z, x) !== '.';
  if (p.round) {
    const base = inside;
    // 層ごとに、前の絵が覆う x の範囲と、横の絵が覆う y の範囲の楕円（試作は毎回求めていた。値は同じで、先に 1 度だけ求める）
    const ell = Array.from({ length: h }, (_, z) => {
      const fr = p.front[h - 1 - z]!;
      const sr = p.side[h - 1 - z]!;
      const xs = [...fr].map((c, i) => (c !== '.' ? i : -1)).filter((i) => i >= 0);
      const ys = [...sr].map((c, i) => (c !== '.' ? i : -1)).filter((i) => i >= 0);
      if (xs.length === 0 || ys.length === 0) return null;
      const xa = xs[0]!;
      const xb = xs[xs.length - 1]!;
      const ya = ys[0]!;
      const yb = ys[ys.length - 1]!;
      return { cx: (xa + xb + 1) / 2, rx: (xb + 1 - xa) / 2, cy: (ya + yb + 1) / 2, ry: (yb + 1 - ya) / 2 };
    });
    inside = (x, y, z) => {
      if (!base(x, y, z)) return false;
      const e = ell[z]!;
      const ex = (x + 0.5 - e.cx) / e.rx;
      const ey = (y + 0.5 - e.cy) / e.ry;
      return ex * ex + ey * ey <= 1.05;
    };
  }
  const run = (x: number, y: number, z: number, dx: number, dy: number, dz: number): number => {
    let k = 1;
    while (inside(x + dx * k, y + dy * k, z + dz * k)) k++;
    return k;
  };
  for (let z = 0; z < h; z++)
    for (let y = 0; y < d; y++)
      for (let x = 0; x < w; x++) {
        if (!inside(x, y, z)) continue;
        const cand: [number, string][] = [
          [run(x, y, z, 0, 0, 1), at(p.top, y, x)],
          [run(x, y, z, 0, -1, 0), at(p.front, h - 1 - z, x)],
          [run(x, y, z, 0, 1, 0), at(back, h - 1 - z, x)],
          [run(x, y, z, -1, 0, 0), at(p.side, h - 1 - z, y)],
          [run(x, y, z, 1, 0, 0), at(p.side, h - 1 - z, y)],
        ];
        // 同じ近さなら、前・後ろ・横の絵を優先する（つぶした画面では、横の面の方が大きく見えるため）
        let best = cand[1]!;
        for (const c of cand.slice(2)) if (c[0] < best[0]) best = c;
        if (cand[0]![0] < best[0]) best = cand[0]!;
        const X = ox + x;
        const Y = oy + y;
        const Z = oz + z;
        if (X < 0 || Y < 0 || Z < 0 || X >= W || Y >= D || Z >= H) throw new Error(`部品がはみ出す：${label} (${X},${Y},${Z})`);
        vox[(Z * D + Y) * W + X] = best[1].charCodeAt(0);
      }
}

/** 部品の並びをまとめて削り出す */
export function carve(dims: Dims, entries: readonly Entry[], label: string): Uint8Array {
  const vox = emptyVox(dims);
  for (const e of entries) carvePart(dims, vox, e, label);
  return vox;
}

/** 削り出した箱から、型（面の向き・半径）を作る */
export function makeModel(dims: Dims, vox: Uint8Array, opts: { cx?: number; cy?: number; outline?: boolean } = {}): Model {
  const { W, D, H } = dims;
  const at = (x: number, y: number, z: number): number => (x >= 0 && y >= 0 && z >= 0 && x < W && y < D && z < H ? vox[(z * D + y) * W + x]! : 0);
  const n = W * D * H;
  const topOpen = new Uint8Array(n);
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  let R = 0;
  const layerR = new Float32Array(H).fill(-1);
  const cx = opts.cx ?? W / 2;
  const cy = opts.cy ?? D / 2;
  const around: readonly (readonly [number, number, number])[] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 0.6],
    [1, -1, 0.6],
    [-1, 1, 0.6],
    [-1, -1, 0.6],
  ];
  for (let z = 0; z < H; z++)
    for (let y = 0; y < D; y++)
      for (let x = 0; x < W; x++) {
        const i = (z * D + y) * W + x;
        if (!vox[i]) continue;
        topOpen[i] = at(x, y, z + 1) ? 0 : 1;
        let ax = 0;
        let ay = 0;
        for (const [dx, dy, wgt] of around) {
          if (!at(x + dx, y + dy, z)) {
            ax += dx * wgt;
            ay += dy * wgt;
          }
        }
        const l = Math.hypot(ax, ay);
        if (l > 0) {
          nx[i] = ax / l;
          ny[i] = ay / l;
        }
        const r = Math.hypot(Math.max(Math.abs(x - cx), Math.abs(x + 1 - cx)), Math.max(Math.abs(y - cy), Math.abs(y + 1 - cy)));
        R = Math.max(R, r);
        layerR[z] = Math.max(layerR[z]!, r);
      }
  return { W, D, H, vox, topOpen, nx, ny, R, layerR, cx, cy, outline: opts.outline !== false };
}

/** 箱の数（削り出しが変わっていないことを確かめるため） */
export function voxelCount(m: Model): number {
  let n = 0;
  for (const v of m.vox) if (v) n++;
  return n;
}
