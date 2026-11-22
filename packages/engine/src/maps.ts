// 対戦用の戦場（design §3.8、§13.4）。どれも上下・左右に対称で、地形は両軍の配置エリアのあいだの行（標準の盤で行 4〜7）だけに置き、
// 配置エリアは平地。行は配置エリアから、列は戦場の幅から計算する（盤の大きさを直書きしない）。

import { plainField, wingOf } from './army.ts';
import type { Field, Terrain } from './types.ts';

export type PvpMapId = 'plain' | 'hill' | 'river' | 'forest';

export const PVP_MAPS: { id: PvpMapId; name: string }[] = [
  { id: 'plain', name: '平原' },
  { id: 'hill', name: '中央の丘' },
  { id: 'river', name: '中央の川' },
  { id: 'forest', name: '両脇の森' },
];

/** 両軍の配置エリアのあいだの行（陣営1のエリアのすぐ下から、陣営0のエリアのすぐ上まで） */
export function middleRows(f: Pick<Field, 'zones'>): number[] {
  const rows: number[] = [];
  for (let r = f.zones[1].row + f.zones[1].height; r < f.zones[0].row; r++) rows.push(r);
  return rows;
}

/** 対戦用の戦場を作る。知らない id なら平原 */
export function pvpField(id: PvpMapId): Field {
  const f = plainField();
  const W = f.width;
  const mid = middleRows(f);
  // あいだの内側の2行（あいだの行のまん中の2行）
  const inner = mid.slice(Math.floor(mid.length / 2) - 1, Math.floor(mid.length / 2) + 1);
  const set = (col: number, row: number, t: Terrain): void => {
    f.terrain[row * W + col] = t;
  };
  if (id === 'hill') {
    // 号令の「中央」の列（標準の盤で列 3〜6）× あいだの内側の2行。通り道には掛けない
    for (const row of inner) for (let col = 0; col < W; col++) if (wingOf(col, f, 0) === 'center') set(col, row, 'hill');
  } else if (id === 'river') {
    // あいだの内側の2行が、端から端まで川（通り道も含む）
    for (const row of inner) for (let col = 0; col < W; col++) set(col, row, 'river');
  } else if (id === 'forest') {
    // 左の3列と右の3列（通り道を含む）× あいだの全部の行。まん中だけが開いている
    for (const row of mid) for (let k = 0; k < 3; k++) {
      set(k, row, 'forest');
      set(W - 1 - k, row, 'forest');
    }
  }
  return f;
}
