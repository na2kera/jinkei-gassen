// 地形の効果（design §3.8）。
// 地形の判定（速さ、倍率、突入の可否、弓の届く距離、柵の正面）は、すべて刻みの初めの位置と向きで行う。
// そのため、ここの関数は Unit ではなく、刻みの初めの写し（位置と向き）を受け取る。
// 平地だけの戦場では、どの関数も「平地の値」（倍率 1、届く距離は初期値のまま、突入は起きる）を返し、
// 地形を入れる前と1刻みも変わらない（T10）。

import type { Field, Terrain, UnitKind } from './types.ts';
import { T } from './tuning.ts';
import { angleBetween } from './geom.ts';

export type AttackKind = 'melee' | 'arrow' | 'impact';

/** 刻みの初めの位置と向き */
export interface TerrainPos {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

/**
 * マスの境目（整数）とみなす遊び。180° 回した戦いでは、同じはずの座標が丸めで 8.000000000000002 と 4 のように分かれ、
 * 「ちょうど整数か」で比べると片方だけが境目の扱いになる。大きさは、距離の判定の RANGE_EPS（battle.ts）と同じ 1e-9
 */
const CELL_EPS = 1e-9;

/**
 * 座標 v が入るマスの番号（幅 n）。マスの境目（整数との差が CELL_EPS 以内）のときは、戦場の中心に近いほうのマスにする。
 * floor だけで決めると、陣営0の部隊が y = 9.0 で行 9、鏡写しの陣営1の部隊が y = 7.0 で行 7 になり、
 * 鏡写しの位置どうしで地形が食い違って、対称な戦場でも陣営の有利不利が生まれるため。
 * 境目から CELL_EPS より離れた座標は、floor のまま（遊びを入れる前と同じ）。
 */
function cellIndex(v: number, n: number): number {
  const r = Math.round(v);
  if (Math.abs(v - r) <= CELL_EPS) return r > n / 2 ? r - 1 : r;
  return Math.floor(v);
}

/** 位置 (x, y) のマスの地形（部隊の地形は、中心があるマスで決める）。戦場の外は平地として扱う。 */
export function terrainAt(field: Field, x: number, y: number): Terrain {
  const col = cellIndex(x, field.width);
  const row = cellIndex(y, field.height);
  if (col < 0 || row < 0 || col >= field.width || row >= field.height) return 'plain';
  return field.terrain[row * field.width + col] ?? 'plain';
}

/** 戦場に平地以外のマスがあるか（平地だけなら、地形の計算をまるごと飛ばす） */
export function hasTerrain(field: Field): boolean {
  return field.terrain.some((t) => t !== 'plain');
}

/** 速さの倍率（刻みの初めにいるマスの地形で決める） */
export function terrainSpeedMult(field: Field, kind: UnitKind, p: TerrainPos): number {
  switch (terrainAt(field, p.x, p.y)) {
    case 'hill':
      return T.hillSpeedMult;
    case 'forest':
      return kind === 'cavalry' ? T.forestCavalrySpeedMult : T.forestSpeedMult;
    case 'river':
      return T.riverSpeedMult;
    case 'fence':
      return T.fenceSpeedMult;
    default:
      return 1;
  }
}

/** 弓の届く距離（丘の上の弓兵は +1.5） */
export function terrainArcherRange(field: Field, p: TerrainPos): number {
  return terrainAt(field, p.x, p.y) === 'hill' ? T.archerRange + T.hillArcherRangeBonus : T.archerRange;
}

/** 柵の効果がかかるか：受ける側が柵のマスにいて、攻める側が柵のマスにおらず、攻める側が受ける側の正面（50°以内）にいる */
function fenceFront(field: Field, a: TerrainPos, d: TerrainPos): boolean {
  if (terrainAt(field, d.x, d.y) !== 'fence' || terrainAt(field, a.x, a.y) === 'fence') return false;
  return angleBetween(d.fx, d.fy, a.x - d.x, a.y - d.y) <= T.frontAngle;
}

/**
 * 損害の地形の倍率（§3.6.2 の表の「地形」の行）。攻める側と受ける側の、刻みの初めの位置と向きで決める。
 * defenderTerms が false なら、受ける側の地形の分（川・森・柵）をかけない（門への損害）。
 */
export function terrainDamageMult(field: Field, a: TerrainPos, d: TerrainPos, kind: AttackKind, defenderTerms = true): number {
  const ta = terrainAt(field, a.x, a.y);
  const td = terrainAt(field, d.x, d.y);
  let m = 1;
  if (kind === 'melee') {
    if (ta === 'hill' && td !== 'hill') m *= T.hillAttackMult;
    if (ta !== 'hill' && td === 'hill') m *= T.hillDefendMult;
    if (ta === 'river') m *= T.riverAttackMult;
  }
  if (!defenderTerms) return m;
  if (td === 'river') m *= T.riverTakenMult;
  if (kind === 'arrow' && td === 'forest') m *= T.forestArrowTakenMult;
  if (kind !== 'impact' && fenceFront(field, a, d)) m *= kind === 'melee' ? T.fenceMeleeMult : T.fenceArrowMult;
  return m;
}

/** 騎兵の突入が起きるか（攻める側が川の中・森の中、受ける側が森の中、柵の正面では起きない） */
export function terrainAllowsImpact(field: Field, a: TerrainPos, d: TerrainPos): boolean {
  const ta = terrainAt(field, a.x, a.y);
  const td = terrainAt(field, d.x, d.y);
  if (ta === 'river' || ta === 'forest' || td === 'forest') return false;
  if (fenceFront(field, a, d)) return false;
  return true;
}

/** 弓が相手まで通るか。城壁は弓を通す（城壁の上から撃ち合うことを、こう表す）ので、いつも通る */
export function terrainArrowClear(_field: Field, _a: TerrainPos, _d: TerrainPos): boolean {
  return true;
}
