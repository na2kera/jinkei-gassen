// 柵・城壁・城門の立体（design §16）。4 方向の絵から削り出すのではなく、マスの中の位置から手続きで箱を埋める（つながる向きで形が変わるため）。
// 試作（proto17v2/art.js の procModel・wallFill・gateFill・fenceFill、main.js の buildProps・lineDepth）を、1マス 32px で写した。
// 城門の傷み具合（gate1・gate2）は試作にないので、design §16.2 の案（扉の板を抜く → 大きく割る。新しい色なし）で作る。
// Phaser も DOM も読まない（画面なしのテストと、ワーカーの両方から使う）。

import type { Field } from '@jinkei/engine';
import { makeModel, type Model } from './carve.ts';
import type { Dims } from './parts.ts';

/** 1マスの大きさ（盤の px）と、型のまわりの余白（隣とつながる所の輪郭を消すため） */
export const TS = 32;
export const TM = 4;
/** 型の箱の 1 辺（40） */
export const TW = TS + TM * 2;

/** 型（城壁 4・城門 3・柵 4） */
export const PROP_IDS = ['wallEW', 'wallE', 'wallW', 'wall', 'gate0', 'gate1', 'gate2', 'fenceEW', 'fenceE', 'fenceW', 'fence'] as const;
export type PropId = (typeof PROP_IDS)[number];
export type PropFamily = 'wall' | 'gate' | 'fence';

/** 型の系統（枠は系統ごとにそろえる。design §16.4） */
export function familyOf(id: PropId): PropFamily {
  return id.startsWith('wall') ? 'wall' : id.startsWith('gate') ? 'gate' : 'fence';
}

export function familyIds(f: PropFamily): PropId[] {
  return PROP_IDS.filter((id) => familyOf(id) === f);
}

/** 型の高さ（箱の層の数） */
export const PROP_H: Readonly<Record<PropFamily, number>> = { wall: 24, gate: 27, fence: 12 };

/** つながる向き（城壁も柵も、東西だけ。design §16.1） */
export interface Conn {
  readonly E: boolean;
  readonly W: boolean;
}

type Fill = (x: number, y: number, z: number) => string | null;

/** 城壁：中央の柱（12 × 12）と、つながる側への腕。上に狭間（凹凸）。試作の wallFill（南北のつながりは使わない） */
function wallFill(conn: Conn): Fill {
  const A = TS / 2 - 6;
  const B = TS / 2 + 6;
  const body = (x: number, y: number): boolean =>
    (x >= A && x < B && y >= A && y < B) || (conn.W && y >= A && y < B && x < A && x >= -TM) || (conn.E && y >= A && y < B && x >= B && x < TS + TM);
  const HB = 18;
  // 試作は、東西だけにつながるときは x、どちらでもないとき（柱）は x + y で目地をずらす
  const ew = conn.E || conn.W;
  return (x, y, z) => {
    if (!body(x, y)) return null;
    if (z < HB) {
      // 石積み：4 段ごとに目地、目地の縦は段ごとにずらす
      if (z % 4 === 0) return 'f';
      const row = Math.floor(z / 4);
      const along = ew ? x : x + y;
      if ((((along + row * 4) % 8) + 8) % 8 === 0) return 'f';
      return row % 2 ? 'j' : 't';
    }
    if (z < HB + 4) {
      // 狭間：外側の縁（厚み 2）に、4 おきの凸
      const edge = !body(x - 2, y) || !body(x + 2, y) || !body(x, y - 2) || !body(x, y + 2);
      const k = ew ? x : x + y;
      if (edge && ((k % 8) + 8) % 8 < 4) return z === HB + 3 ? 'T' : 't';
      return null;
    }
    return null;
  };
}

/** 城門の傷み具合で抜く所（x・z の両端を含む範囲。design §16.2） */
type Hole = readonly [number, number, number, number];
const GATE_HOLES: readonly (readonly Hole[])[] = [
  [],
  [
    [9, 12, 6, 11],
    [18, 22, 2, 7],
    [21, 23, 13, 15],
  ],
  [
    [9, 12, 6, 11],
    [18, 22, 2, 7],
    [21, 23, 13, 15],
    [13, 18, 0, 12],
    [9, 12, 0, 5],
    [10, 12, 16, 17],
    [19, 21, 16, 17],
  ],
];

/** 城門（東西につながる向き）：両脇の柱、上の梁、木の扉、屋根。試作の gateFill に、傷み具合の段 stage の穴を足したもの */
function gateFill(stage: 0 | 1 | 2): Fill {
  const holes = GATE_HOLES[stage]!;
  const M = TS / 2;
  const inner: Fill = (x, y, z) => {
    const inY = y >= M - 6 && y < M + 6;
    if (z >= 24) {
      // 屋根：寄棟（1 段ごとに内へ）
      const i = (z - 24) * 2;
      if (x >= -2 + i && x < TS + 2 - i && y >= M - 9 + i && y < M + 9 - i) return z === 26 ? 'V' : 'K';
      return null;
    }
    if (!inY) return null;
    if (x < -TM || x >= TS + TM) return null;
    if (x < 8 || x >= TS - 8) return z % 4 === 0 ? 'f' : Math.floor(z / 4) % 2 ? 'j' : 't'; // 柱（両脇の壁とつながる）
    if (z >= 16) return z % 4 === 0 ? 'f' : 't'; // 梁
    // 扉（厚み 4、前後とも木）
    if (y < M - 2 || y >= M + 2) return null;
    if (z === 3 || z === 8 || z === 13) return x % 6 === 2 || x % 6 === 3 ? 'N' : 'I';
    return x === M - 1 || x === M ? 'V' : 'W';
  };
  if (holes.length === 0) return inner;
  return (x, y, z) => {
    // 扉と梁の所だけを抜く（柱と屋根は残す）
    if (z < 24 && x >= 8 && x < TS - 8 && holes.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) return null;
    return inner(x, y, z);
  };
}

/** 柵（東西）：太さ 2 の杭を 8 おき、横木 2 本（太さ 2）。型の中では北の縁（縁から 2〜4px）に立てる。試作の fenceFill（1マス 32） */
function fenceFill(): Fill {
  const P = TS % 6 === 0 ? 6 : 8;
  return (x, y, z) => {
    if (y < 2 || y >= 4) return null;
    const post = ((((x - 2) % P) + P) % P) < 2;
    if (post && z < 11) return z >= 9 ? 'C' : 'P';
    if (z === 3 || z === 4 || z === 7 || z === 8) return 'w';
    return null;
  };
}

/** 型の箱：own は自分のマスの中（＋つながる側へ 1）、mask は余白にはみ出した所（輪郭を描かない所）。試作の procModel */
export interface PropVox {
  readonly dims: Dims;
  readonly own: Uint8Array;
  /** はみ出した所がなければ null */
  readonly mask: Uint8Array | null;
}

function procVox(H: number, fill: Fill, conn: Conn): PropVox {
  const n = TW * TW * H;
  const own = new Uint8Array(n);
  const mask = new Uint8Array(n);
  let anyMask = false;
  const lo = TM;
  const hi = TM + TS;
  const inOwn = (x: number, y: number): boolean => x >= lo - (conn.W ? 1 : 0) && x < hi + (conn.E ? 1 : 0) && y >= lo && y < hi;
  for (let z = 0; z < H; z++)
    for (let y = 0; y < TW; y++)
      for (let x = 0; x < TW; x++) {
        const c = fill(x - TM, y - TM, z);
        if (!c) continue;
        const i = (z * TW + y) * TW + x;
        if (inOwn(x, y)) own[i] = c.charCodeAt(0);
        else {
          mask[i] = c.charCodeAt(0);
          anyMask = true;
        }
      }
  return { dims: { W: TW, D: TW, H }, own, mask: anyMask ? mask : null };
}

/** 型 id のつながり方 */
function connOfId(id: PropId): Conn {
  if (id.startsWith('gate')) return { E: true, W: true };
  const s = id.replace(/^(wall|fence)/, '');
  return { E: s.includes('E'), W: s.includes('W') };
}

/** 型 id の箱 */
export function propVox(id: PropId): PropVox {
  const f = familyOf(id);
  const conn = connOfId(id);
  const fill = f === 'wall' ? wallFill(conn) : f === 'gate' ? gateFill(Number(id.slice(4)) as 0 | 1 | 2) : fenceFill();
  return procVox(PROP_H[f], fill, conn);
}

/** 型 id の型（本体と、輪郭を描かない所） */
export interface PropModel {
  readonly m: Model;
  readonly mask: Model | null;
}

export function propModel(id: PropId): PropModel {
  const v = propVox(id);
  return { m: makeModel(v.dims, v.own), mask: v.mask ? makeModel(v.dims, v.mask) : null };
}

// ---- 戦場のマスと型 ----

/** 門のマス（engine の門。field.terrain では平地） */
export interface GateCell {
  readonly col: number;
  readonly row: number;
}

export type PropKind = 'wall' | 'gate' | 'fence';

/** 門が破れたときに崩れるマス（門と、両隣のうち城壁のマス。戦場の端で切る。engine の wallsOfGate・collapseBesideGate と同じ） */
function collapsed(field: Field, gate: GateCell | null, col: number, row: number): boolean {
  if (!gate || row !== gate.row || Math.abs(col - gate.col) > 1) return false;
  return col === gate.col || field.terrain[row * field.width + col] === 'wall';
}

/** マスの立った地形（なければ null）。broken なら、崩れた 3 マスは何もないとして数える */
export function propKindAt(field: Field, gate: GateCell | null, col: number, row: number, broken: boolean): PropKind | null {
  if (col < 0 || row < 0 || col >= field.width || row >= field.height) return null;
  if (broken && collapsed(field, gate, col, row)) return null;
  if (gate && gate.col === col && gate.row === row) return 'gate';
  const t = field.terrain[row * field.width + col];
  return t === 'wall' ? 'wall' : t === 'fence' ? 'fence' : null;
}

/**
 * つながり方（design §16.2）。城壁は東西の隣が城壁か門なら、そちらへつながる。柵は東西の隣が柵ならつながる。
 * 盤の端はつながらない。門はいつも東西。立った地形でないマスは null
 */
export function connOf(field: Field, gate: GateCell | null, col: number, row: number, broken: boolean): Conn | null {
  const k = propKindAt(field, gate, col, row, broken);
  if (!k) return null;
  if (k === 'gate') return { E: true, W: true };
  const ok = (c: number): boolean => {
    const n = propKindAt(field, gate, c, row, broken);
    return k === 'wall' ? n === 'wall' || n === 'gate' : n === 'fence';
  };
  return { E: ok(col + 1), W: ok(col - 1) };
}

/** 柵を立てる縁：盤のまん中より下（自軍の側）の行は北の縁、上の行は南の縁（design §16.2） */
export function fenceEdge(field: Pick<Field, 'height'>, row: number): 'N' | 'S' {
  return row + 0.5 >= field.height / 2 ? 'N' : 'S';
}

/** つながり方の型（城壁・柵）。南の縁の柵は 180° 回して使うので、片側だけつながる型は東西を入れ替えて選ぶ */
export function connName(base: 'wall' | 'fence', conn: Conn, swap = false): PropId {
  const E = swap ? conn.W : conn.E;
  const W = swap ? conn.E : conn.W;
  return `${base}${E ? 'E' : ''}${W ? 'W' : ''}` as PropId;
}

/** 線（城壁・城門。兵との前後を直す。design §16.5） */
export interface DepthLine {
  /** 線のまん中（戦場の座標。マス） */
  readonly x: number;
  readonly y: number;
  /** 線の絵の厚みの半分と高さ（盤の px） */
  readonly T: number;
  readonly Hb: number;
}

/** 1 マスの立った地形の置き方 */
export interface PropPlace {
  readonly col: number;
  readonly row: number;
  readonly kind: PropKind;
  readonly id: PropId;
  /** 回す量（向きの番号。北の縁の柵・城壁・城門は 0、南の縁の柵は 18） */
  readonly rot: number;
  /** depth を取る点（戦場の座標。城壁と城門はマスのまん中、柵は柵の線の上の点） */
  readonly dx: number;
  readonly dy: number;
  /** 前後を直す線（城壁と城門だけ） */
  readonly line: DepthLine | null;
}

/** 柵の線の、マスのまん中からの距離（盤の px。縁から 3px の内側） */
export const FENCE_LINE = TS / 2 - 3;
const WALL_LINE = { T: 6, Hb: 22 } as const;
const GATE_LINE = { T: 9, Hb: 27 } as const;

/** 戦場の立った地形を全部並べる。門の傷み具合の段 stage と、破れたか broken を見る */
export function propPlaces(field: Field, gate: GateCell | null, stage: 0 | 1 | 2 = 0, broken = false, n = 36): PropPlace[] {
  const out: PropPlace[] = [];
  for (let row = 0; row < field.height; row++)
    for (let col = 0; col < field.width; col++) {
      const kind = propKindAt(field, gate, col, row, broken);
      if (!kind) continue;
      const conn = connOf(field, gate, col, row, broken)!;
      const cx = col + 0.5;
      const cy = row + 0.5;
      if (kind === 'fence') {
        const edge = fenceEdge(field, row);
        const s = edge === 'S';
        const dy = cy + ((s ? 1 : -1) * FENCE_LINE) / TS;
        out.push({ col, row, kind, id: connName('fence', conn, s), rot: s ? n / 2 : 0, dx: cx, dy, line: null });
      } else if (kind === 'wall') {
        out.push({ col, row, kind, id: connName('wall', conn), rot: 0, dx: cx, dy: cy, line: { x: cx, y: cy, ...WALL_LINE } });
      } else {
        out.push({ col, row, kind, id: `gate${stage}`, rot: 0, dx: cx, dy: cy, line: { x: cx, y: cy, ...GATE_LINE } });
      }
    }
  return out;
}

/** 立った地形があるか（地形の揃いを頼むか） */
export function hasProps(field: Field, gate: GateCell | null): boolean {
  return propPlaces(field, gate).length > 0;
}

// ---- 向きの組（design §16.3） ----

export type TerrainGroup = 'A' | 'B';
export const TERRAIN_GROUPS: readonly TerrainGroup[] = ['A', 'B'];

/** 型の回す量と、返した表示かから、要る向きの組 */
export function groupOf(rot: number, flipped: boolean, n = 36): TerrainGroup {
  return (rot === n / 2) !== flipped ? 'B' : 'A';
}

/** 戦場と表示（返すか）から、要る向きの組（立った地形がなければ空） */
export function terrainGroups(field: Field, gate: GateCell | null, flipped: boolean, n = 36): TerrainGroup[] {
  const set = new Set<TerrainGroup>();
  for (const p of propPlaces(field, gate, 0, false, n)) set.add(groupOf(p.rot, flipped, n));
  return TERRAIN_GROUPS.filter((g) => set.has(g));
}

// ---- 兵との前後（design §16.5） ----

/** 兵の絵の大きめの範囲（盤の px。兵の大きさ ÷ 盤の縮み を掛ける） */
const SOLDIER_BOX = { w: 15, up: 38, down: 8 } as const;
/** 線の絵の半分の長さ（型の箱の半分） */
const LINE_HALF = TW / 2;

/**
 * 城壁と城門の線ごとに、兵の depth を、線のどちら側にいるかで直す。
 * theta は盤の回転（返した表示なら 180° 足す）、(x, y) は兵の足もと（戦場の座標）、depth は足もとの depth、
 * lineDepths は線ごとの絵の depth、sz は 兵の大きさ ÷ 盤の縮み
 */
export function lineDepth(lines: readonly DepthLine[], lineDepths: readonly number[], theta: number, x: number, y: number, depth: number, sz: number): number {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // 線を斜め後ろより横から見ているときは、足もとの depth のまま
  if (Math.abs(c) < 0.5) return depth;
  const ac = Math.abs(c);
  const as = Math.abs(s);
  const w = SOLDIER_BOX.w * sz;
  const up = SOLDIER_BOX.up * sz;
  const down = SOLDIER_BOX.down * sz;
  let out = depth;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]!;
    const along = (x - L.x) * TS;
    const perp = (y - L.y) * TS;
    const fx = along * c - perp * s;
    const fy = 0.75 * (along * s + perp * c);
    const Xb = LINE_HALF * ac + L.T * as;
    const Yb = 0.75 * (LINE_HALF * as + L.T * ac);
    if (!(Math.abs(fx) <= Xb + w && fy - up <= Yb && fy + down >= -Yb - L.Hb)) continue;
    const d = lineDepths[i]!;
    const D = out - d;
    if (perp * c > 0) {
      if (D < 0.5) out = d + 0.5 + 0.01 * D;
    } else if (D > -0.5) out = d - 0.5 + 0.01 * D;
  }
  return out;
}

/**
 * 城壁の行の切れ目（門のマス）。戦闘の画面の最初の組み立てでは、場面（view.gate）がまだ届かないので、ここから門の位置を決める
 * （1 コマだけ「門なし・切り口の閉じた城壁」が出ないように）。城壁が 1 行で切れ目が 1 マスのときだけ返す（engine の readWalls と同じ形）
 */
export function gateFromWalls(field: Field): GateCell | null {
  const rows = new Set<number>();
  for (let i = 0; i < field.terrain.length; i++) if (field.terrain[i] === 'wall') rows.add(Math.floor(i / field.width));
  if (rows.size !== 1) return null;
  const row = [...rows][0]!;
  const gaps: number[] = [];
  for (let c = 0; c < field.width; c++) if (field.terrain[row * field.width + c] !== 'wall') gaps.push(c);
  return gaps.length === 1 ? { col: gaps[0]!, row } : null;
}
