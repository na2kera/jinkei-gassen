// 対戦用の戦場（design §3.8）。どれも上下・左右に対称で、地形は中間地帯の4行（行 6〜9）だけに置き、配置エリアは平地。

import { plainField } from './army.ts';
import type { Field, Terrain } from './types.ts';

export type PvpMapId = 'plain' | 'hill' | 'river' | 'forest';

export const PVP_MAPS: { id: PvpMapId; name: string }[] = [
  { id: 'plain', name: '平原' },
  { id: 'hill', name: '中央の丘' },
  { id: 'river', name: '中央の川' },
  { id: 'forest', name: '両脇の森' },
];

/** 中間地帯の行（標準の 12 × 16 の戦場で、行 6〜9） */
const MIDDLE_ROWS = [6, 7, 8, 9];

/** 対戦用の戦場を作る。知らない id なら平原 */
export function pvpField(id: PvpMapId): Field {
  const f = plainField();
  const set = (col: number, row: number, t: Terrain): void => {
    f.terrain[row * f.width + col] = t;
  };
  if (id === 'hill') {
    // 中央の4列 × 中間地帯の中の2行
    for (const row of [7, 8]) for (let col = 4; col <= 7; col++) set(col, row, 'hill');
  } else if (id === 'river') {
    // 中間地帯の中の2行が、端から端まで川
    for (const row of [7, 8]) for (let col = 0; col < f.width; col++) set(col, row, 'river');
  } else if (id === 'forest') {
    // 左の3列と右の3列 × 中間地帯の4行
    for (const row of MIDDLE_ROWS) for (const col of [0, 1, 2, 9, 10, 11]) set(col, row, 'forest');
  }
  return f;
}
