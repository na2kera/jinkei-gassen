// 対戦用の戦場（decisions §9-2）。engine の PVP_MAPS から、setup に入るたびにランダムに1つ選ぶ。
// 部屋は id だけを保存し、戦場は id から作り直す（engine の pvpField）。

import { PVP_MAPS, pvpField, type Field, type PvpMapId } from '@jinkei/engine';

export function isMapId(v: unknown): v is PvpMapId {
  return typeof v === 'string' && PVP_MAPS.some((m) => m.id === v);
}

/** 戦場を選ぶ。fixed（テストで決めた戦場）があればそれ、なければ PVP_MAPS から crypto.getRandomValues で選ぶ */
export function pickMap(fixed: string | null = null): PvpMapId {
  if (isMapId(fixed)) return fixed;
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return PVP_MAPS[(a[0] ?? 0) % PVP_MAPS.length]?.id ?? 'plain';
}

/** id から戦場を作る。知らない id（保存した部屋が古い場合など）は平原にする */
export function fieldOf(map: string): Field {
  return pvpField(isMapId(map) ? map : 'plain');
}
