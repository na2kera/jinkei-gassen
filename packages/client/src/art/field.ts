// 戦場の仮の絵。平地だけ（地形の絵は段階4）。配置エリアはマスが分かるように市松に塗る。

import type { Field } from '@jinkei/engine';
import type Phaser from 'phaser';
import type { FieldView } from '../battle/FieldView.ts';
import { COLOR } from './palette.ts';

function inZone(col: number, row: number, z: Field['zones'][number]): boolean {
  return col >= z.col && col < z.col + z.width && row >= z.row && row < z.row + z.height;
}

export function drawField(g: Phaser.GameObjects.Graphics, fv: FieldView, field: Field): void {
  for (let row = 0; row < field.height; row++) {
    for (let col = 0; col < field.width; col++) {
      const zoned = inZone(col, row, field.zones[0]) || inZone(col, row, field.zones[1]);
      const color = zoned ? ((col + row) % 2 === 0 ? COLOR.zoneA : COLOR.zoneB) : COLOR.plain;
      const r = fv.cellRect(col, row);
      g.fillStyle(color, 1);
      g.fillRect(r.x, r.y, r.w, r.h);
    }
  }
}
