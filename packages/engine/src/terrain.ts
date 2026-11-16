// 地形の効果を差し込む場所（design §3.8）。
// 段階1〜3はすべて平地として扱うので、どの関数も「平地の値」を返す。
// 段階4で効果を入れるときは、このファイルの関数の中身だけを変えればよいように、
// 移動・損害・突入・弓の距離の計算は、地形に関わる部分を必ずここを通して求める。

import type { Field, Terrain, Unit } from './types.ts';
import { T } from './tuning.ts';

export type AttackKind = 'melee' | 'arrow' | 'impact';

/** 位置 (x, y) のマスの地形。戦場の外は平地として扱う。 */
export function terrainAt(field: Field, x: number, y: number): Terrain {
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (col < 0 || row < 0 || col >= field.width || row >= field.height) return 'plain';
  return field.terrain[row * field.width + col] ?? 'plain';
}

/** 速さの倍率（いまの位置から、動きたい向きへ動くとき） */
export function terrainSpeedMult(_field: Field, _unit: Unit, _dirX: number, _dirY: number): number {
  return 1;
}

/** 攻める側の倍率（丘の上から、川の中から、など） */
export function terrainAttackMult(_field: Field, _attacker: Unit, _defender: Unit, _kind: AttackKind): number {
  return 1;
}

/** 受ける側の倍率（丘・森・川・柵） */
export function terrainTakenMult(_field: Field, _attacker: Unit, _defender: Unit, _kind: AttackKind): number {
  return 1;
}

/** 騎兵の突入が起きるか（森の中・柵の中の相手には起きない） */
export function terrainAllowsImpact(_field: Field, _attacker: Unit, _defender: Unit): boolean {
  return true;
}

/** 弓の届く距離（丘の上で伸びる） */
export function terrainArcherRange(_field: Field, _archer: Unit): number {
  return T.archerRange;
}

/** 弓が相手まで通るか（城壁は弓も越えない）。段階4で射線の判定を入れる */
export function terrainArrowClear(_field: Field, _archer: Unit, _target: Unit): boolean {
  return true;
}
