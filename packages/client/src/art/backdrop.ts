// 将軍の視点の、地平線より上の遠景の絵（design §5.8.3 補足12）。
// 1人用は面の id、対戦は pvp-<地図の id> を名前にし、public/backdrops/<名前>.png を BootScene でまとめて読む。
// 読めなかった絵（ない・壊れている・大きさが違う）は、使うときに空の色（COLOR.sky）のべた塗りで代える。

import { PVP_MAPS, STAGES } from '@jinkei/engine';

export const BACKDROP_W = 288;
export const BACKDROP_H = 96;

/** 遠景の絵のテクスチャの鍵（ほかのテクスチャの鍵と重ならないよう、前に付ける） */
export function backdropKey(name: string): string {
  return `backdrop-${name}`;
}

/** 対戦の地図の遠景の名前 */
export function pvpBackdrop(map: string): string {
  return `pvp-${map}`;
}

/** 読む絵の名前（1人用の面の id と、対戦の地図） */
export function backdropNames(): string[] {
  return [...STAGES.map((s) => s.id), ...PVP_MAPS.map((m) => pvpBackdrop(m.id))];
}
