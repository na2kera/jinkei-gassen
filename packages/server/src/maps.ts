// 対戦用の戦場（decisions §9-2）。段階3は平原だけ。
// 段階4で戦場を足すときは、MAPS に id と作り方を足し、pickMap の候補に入れる。部屋は id だけを保存する。

import { plainField, type Field } from '@jinkei/engine';

export const MAPS: Readonly<Record<string, () => Field>> = Object.freeze({
  plain: () => plainField(),
});

/** 対戦で選べる戦場の id。毎回ここからランダムに1つ選ぶ */
const PVP_MAP_IDS: readonly string[] = ['plain'];

export function pickMap(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return PVP_MAP_IDS[(a[0] ?? 0) % PVP_MAP_IDS.length] ?? 'plain';
}

/** id から戦場を作る。知らない id（保存した部屋が古い場合など）は平原にする */
export function fieldOf(map: string): Field {
  const make = Object.hasOwn(MAPS, map) ? MAPS[map] : undefined;
  return (make ?? MAPS['plain'] ?? plainField)();
}
