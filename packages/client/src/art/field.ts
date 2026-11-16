// 戦場の絵。地形ごとのタイルを、FieldView が決めたマスの位置に1枚の絵として貼り合わせる
// （192 マスを別々の絵にするより軽いため）。配置エリアの印は配置の画面だけで重ねる。

import type { Field, Zone } from '@jinkei/engine';
import Phaser from 'phaser';
import type { FieldView } from '../battle/FieldView.ts';
import { COLOR } from './palette.ts';
import { PLAIN_VARIANTS, tileKey } from './textures.ts';

let serial = 0;

/** 戦場の背景を作って置く。戻り値は置いた Image（作り直すときは destroy する） */
export function addFieldImage(scene: Phaser.Scene, fv: FieldView, field: Field): Phaser.GameObjects.Image {
  const r = fv.rect;
  const key = `field-bg-${serial++}`;
  const tex = scene.textures.createCanvas(key, r.w, r.h);
  if (tex) {
    const ctx = tex.getContext();
    for (let row = 0; row < field.height; row++) {
      for (let col = 0; col < field.width; col++) {
        const terrain = field.terrain[row * field.width + col] ?? 'plain';
        // 平地の模様は、マスの位置から決まった順で混ぜる（毎回同じ見た目にする）
        const variant = (col * 7 + row * 13 + ((col * row) % 5)) % PLAIN_VARIANTS;
        const src = scene.textures.get(tileKey(terrain, variant)).getSourceImage() as HTMLCanvasElement;
        const c = fv.cellRect(col, row);
        ctx.drawImage(src, c.x - r.x, c.y - r.y);
      }
    }
    tex.refresh();
  }
  const img = scene.add.image(r.x, r.y, key).setOrigin(0, 0);
  // 作り直すたびにテクスチャが増えないよう、絵と一緒に消す
  img.once(Phaser.GameObjects.Events.DESTROY, () => {
    if (scene.textures.exists(key)) scene.textures.remove(key);
  });
  return img;
}

/** 戦場のまわりの枠（輪郭 2px + 暗い金 2px） */
export function drawFieldFrame(g: Phaser.GameObjects.Graphics, fv: FieldView): void {
  const r = fv.rect;
  g.fillStyle(COLOR.dim, 1);
  g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  g.fillStyle(COLOR.outline, 1);
  g.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
}

/**
 * 配置エリアの印（配置の画面だけ）。エリアの縁を、2px の点線で囲む。自軍は明るく、敵軍は暗く。
 * 塗りつぶさないのは、草地の絵を隠さず、エリアの境目だけが分かればよいため。
 */
export function drawZone(g: Phaser.GameObjects.Graphics, fv: FieldView, zone: Zone, color: number): void {
  const a = fv.cellRect(zone.col, zone.row);
  const b = fv.cellRect(zone.col + zone.width - 1, zone.row + zone.height - 1);
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  g.fillStyle(color, 1);
  for (let x = x0; x < x1; x += 8) {
    g.fillRect(x, y0, 4, 2);
    g.fillRect(x, y1 - 2, 4, 2);
  }
  for (let y = y0; y < y1; y += 8) {
    g.fillRect(x0, y, 2, 4);
    g.fillRect(x1 - 2, y, 2, 4);
  }
}
