// 部隊の中の兵の並び（design §5.3、§5.8.1）。Phaser を使わない計算だけにして、画面なしで確かめられるようにする。
// 兵ごとのずれ（lx, ly。px で書いてある）は、戦場の座標の上で部隊の向きに回してから、FieldView.shiftOnScreen で画面に直す
// （画面に直したあとの向きから直角の向きを作らない。縮みの比が縦横で違うと、並びがゆがむため）。

import type { Kind } from '@jinkei/engine';
import type { FieldView, Point } from '../battle/FieldView.ts';
import { shapeOf, soldierReach, type Dir4, type SoldierShape } from './textures.ts';

export interface Slot {
  lx: number;
  ly: number;
  shape: SoldierShape;
}

/** 歩兵・盾兵・弓兵：3×3。並びの順は前の列から（兵が減るときは後ろから消す） */
const FOOT: { lx: number; ly: number }[] = [];
for (const ly of [-4, 0, 4]) for (const lx of [-5, 0, 5]) FOOT.push({ lx, ly });
/** 騎兵：馬が大きいので 2×2 */
const CAVALRY = [
  { lx: -3, ly: -4 },
  { lx: 3, ly: -4 },
  { lx: -3, ly: 4 },
  { lx: 3, ly: 4 },
];
/** 本陣：まん中に将、四隅に護衛 */
const HQ_GUARDS = [
  { lx: -5, ly: -4 },
  { lx: 5, ly: -4 },
  { lx: -5, ly: 4 },
  { lx: 5, ly: 4 },
];

/** 兵種ごとの兵の並び（ly が負なら前の列、lx が正なら部隊の右手） */
export function slotsOf(kind: Kind): Slot[] {
  if (kind === 'hq') {
    return [{ lx: 0, ly: 0, shape: 'general' }, ...HQ_GUARDS.map((o) => ({ ...o, shape: 'guard' as const }))];
  }
  const shape = shapeOf(kind);
  return (kind === 'cavalry' ? CAVALRY : FOOT).map((o) => ({ ...o, shape }));
}

/** 敗走で散らばるときの、兵ごとのずれ（毎回同じになるよう固定の値） */
export const SCATTER = Array.from({ length: 9 }, (_, i) => ({ x: ((i * 37) % 11) / 10 - 0.5, y: ((i * 53) % 13) / 12 - 0.5 }));

/** 画面の上での向き（FieldView.facingOnScreen）から、兵の4方向の絵を選ぶ */
export function dirOf(dx: number, dy: number): Dir4 {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy < 0 ? 0 : 2;
}

/** 部隊の絵が中心からどこまで届くか（並びを回しても、この値を超えない。真上の絵で測る） */
export function unitReach(kind: Kind): number {
  return Math.max(...slotsOf(kind).map((s) => Math.hypot(s.lx, s.ly) + soldierReach(s.shape)));
}

/**
 * 兵1人の足もとの画面の px。c は部隊の中心（画面の px）、at は同じ点の戦場の座標、
 * (fx, fy) は部隊の向き（戦場の座標の単位ベクトル）。並びの「右」は、前を時計回りに 90° 回した向き。
 * 戦場の上でのずれは「右へ lx」−「前へ ly」で、2つの項のまま FieldView.shiftOnScreen に渡す
 */
export function soldierPoint(fv: FieldView, c: Point, at: Point, fx: number, fy: number, lx: number, ly: number): Point {
  const rx = -fy;
  const ry = fx;
  return fv.shiftOnScreen(c.x, c.y, at.x, at.y, lx * rx, lx * ry, ly * fx, ly * fy);
}

/** 部隊の足もとから、数字の箱の下の端までの離れ（立った兵は絵の高さの分だけ上に離す） */
export function unitLift(fv: FieldView, x: number, y: number): number {
  return fv.standing ? 34 * fv.spriteScale(x, y) : 20;
}
