// 城壁と門（design §3.8）。城壁は、戦場を端から端まで横切る1行としてだけ置き、その行の1マスだけを平地にして門を置く。
// 通り道（門の手前の中心 → 門の中心 → 行き先）と、城壁のマスから部隊を押し出す処理をここにまとめる。

import type { Field } from './types.ts';
import { T } from './tuning.ts';

/** 城壁の行と、切れ目（門のマス）の列 */
export interface WallInfo {
  row: number;
  gapCol: number;
}

/** 城壁の形を調べる。城壁がなければ null、形が正しければ WallInfo、正しくなければ理由の文字列 */
export function readWalls(field: Field): WallInfo | null | string {
  const rows = new Set<number>();
  for (let i = 0; i < field.terrain.length; i++) if (field.terrain[i] === 'wall') rows.add(Math.floor(i / field.width));
  if (rows.size === 0) return null;
  if (rows.size > 1) return '城壁は1行だけ';
  const row = [...rows][0] as number;
  if (row <= 0 || row >= field.height - 1) return '城壁の行は、戦場のいちばん端には置けない';
  const gaps: number[] = [];
  for (let c = 0; c < field.width; c++) if (field.terrain[row * field.width + c] !== 'wall') gaps.push(c);
  if (gaps.length !== 1) return '城壁の行は、1マスだけを切れ目（門のマス）にする';
  const gapCol = gaps[0] as number;
  if (field.terrain[row * field.width + gapCol] !== 'plain') return '門のマスは平地にする';
  return { row, gapCol };
}

/** 門のある戦場の城壁（門が破れて両隣が崩れたあとも、城壁の行と門の列は同じ） */
export function wallsOfGate(gate: { row: number; col: number }): WallInfo {
  return { row: gate.row, gapCol: gate.col };
}

/** 門が破れたら、門のマスの左右1マスずつの城壁を平地に変える（次の刻みから、3マスの幅で通れる） */
export function collapseBesideGate(field: Field, gate: { row: number; col: number }): void {
  for (const c of [gate.col - 1, gate.col + 1]) {
    if (c < 0 || c >= field.width) continue;
    const i = gate.row * field.width + c;
    if (field.terrain[i] === 'wall') field.terrain[i] = 'plain';
  }
}

/** 城壁がある戦場なら WallInfo（形は createBattle で調べ済みとする） */
export function wallsOf(field: Field): WallInfo | null {
  const w = readWalls(field);
  return typeof w === 'string' ? null : w;
}

/** 城壁の行のどちら側か：上（y が小さい）は -1、下は +1、城壁の行の中（切れ目）は 0 */
export function sideOfWall(w: WallInfo, y: number): -1 | 0 | 1 {
  if (y < w.row) return -1;
  if (y > w.row + 1) return 1;
  return 0;
}

/** 門のマスの中心 */
export function gateCenter(w: WallInfo): { x: number; y: number } {
  return { x: w.gapCol + 0.5, y: w.row + 0.5 };
}

/**
 * 通り道：部隊が (px, py) にいて、行き先が (dx, dy) のとき、いま向かう点。
 * 行き先が城壁の行をはさんで反対側（または門のマスそのもの）なら、①門のマスの自分の側の1マス手前の中心 → ②門のマスの中心 → ③行き先。
 * ①は、門のマスの中心から x の差が 0.3 以内で、城壁の行のすぐ隣の行にいれば、済んだものとする。
 * waypoint は、向かう点が行き先そのものでない（途中の点）かどうか。
 */
export function routeTo(w: WallInfo | null, px: number, py: number, dx: number, dy: number): { x: number; y: number; waypoint: boolean } {
  if (!w) return { x: dx, y: dy, waypoint: false };
  const su = sideOfWall(w, py);
  const sd = sideOfWall(w, dy);
  if (su === 0 || sd === su) return { x: dx, y: dy, waypoint: false };
  const g = gateCenter(w);
  const nearX = Math.abs(px - g.x) <= T.gateApproachTolerance;
  const adjacent = su < 0 ? py >= w.row - 1 : py <= w.row + 2;
  if (nearX && adjacent) return sd === 0 ? { x: dx, y: dy, waypoint: false } : { x: g.x, y: g.y, waypoint: true };
  return { x: g.x, y: su < 0 ? w.row - 0.5 : w.row + 1.5, waypoint: true };
}

/** 2点のあいだの道のりの長さ。城壁の行をはさんで反対側なら、門のマスの中心を通る折れ線の長さ */
export function pathLength(w: WallInfo | null, px: number, py: number, qx: number, qy: number): number {
  if (w) {
    const a = sideOfWall(w, py);
    const b = sideOfWall(w, qy);
    if (a !== 0 && b !== 0 && a !== b) {
      const g = gateCenter(w);
      return Math.hypot(g.x - px, g.y - py) + Math.hypot(qx - g.x, qy - g.y);
    }
  }
  return Math.hypot(qx - px, qy - py);
}

/**
 * 部隊の中心を、城壁のマスから 0.45 より内側に入れない（戦場の端と同じ扱い）。
 * 城壁のマスの中に入ってしまったときは、刻みの初めにいた側（prevY）へ押し戻す。
 */
export function pushOutOfWalls(w: WallInfo, field: Field, pos: { x: number; y: number }, prevY: number): void {
  const m = T.wallMargin;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const c0 = Math.floor(pos.x) - 1;
    for (let c = c0; c <= c0 + 2; c++) {
      // いまの地形で城壁のマスだけを見る（門が破れて崩れた城壁は平地になっている）
      if (c < 0 || c >= field.width || field.terrain[w.row * field.width + c] !== 'wall') continue;
      const qx = Math.min(c + 1, Math.max(c, pos.x));
      const qy = Math.min(w.row + 1, Math.max(w.row, pos.y));
      const ddx = pos.x - qx;
      const ddy = pos.y - qy;
      const d = Math.hypot(ddx, ddy);
      if (d >= m - 1e-12) continue;
      if (d < 1e-12) {
        // マスの中に入った：来た側へ、縦に押し戻す
        pos.y = prevY < w.row + 0.5 ? w.row - m : w.row + 1 + m;
      } else {
        pos.x = qx + (ddx / d) * m;
        pos.y = qy + (ddy / d) * m;
      }
      moved = true;
    }
    if (!moved) return;
  }
}

/** 位置 (x, y) が城壁のマスから 0.45 以上離れているか（テスト用。いまの地形で見る） */
export function clearOfWalls(w: WallInfo, field: Field, x: number, y: number): boolean {
  for (let c = 0; c < field.width; c++) {
    if (field.terrain[w.row * field.width + c] !== 'wall') continue;
    const qx = Math.min(c + 1, Math.max(c, x));
    const qy = Math.min(w.row + 1, Math.max(w.row, y));
    if (Math.hypot(x - qx, y - qy) < T.wallMargin - 1e-9) return false;
  }
  return true;
}
