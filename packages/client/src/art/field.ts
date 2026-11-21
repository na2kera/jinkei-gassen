// 戦場の絵。地形ごとのタイルを、FieldView が決めたマスの位置に1枚の絵として貼り合わせる
// （192 マスを別々の絵にするより軽いため）。配置エリアの印は配置の画面だけで重ねる。

import type { Field, Zone } from '@jinkei/engine';
import Phaser from 'phaser';
import type { FieldView } from '../battle/FieldView.ts';
import { COLOR } from './palette.ts';
import type { Rect } from '../layout.ts';
import { groundTerrain } from './tallArt.ts';
import { PLAIN_VARIANTS, ROCK_KEY, TILE, tileKey } from './textures.ts';

let serial = 0;

/**
 * 戦場の背景を作って置く。戻り値は置いた Image（作り直すときは destroy する）。
 * area は描き場所（12列ぶん）。戦場が狭いときは、戦場の外側の列に岩壁を敷く（谷の狭い道を表す）
 */
export function addFieldImage(scene: Phaser.Scene, fv: FieldView, field: Field, area: Rect = fv.rect): Phaser.GameObjects.Image {
  const r = area;
  const key = `field-bg-${serial++}`;
  const tex = scene.textures.createCanvas(key, r.w, r.h);
  if (tex) {
    const ctx = tex.getContext();
    // 戦場の外側（狭い戦場の左右と、斜めや横からで縦が縮んだときの上下）は岩壁。先に全体に敷き、戦場のマスで上書きする
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < r.h; y += TILE) {
      for (let x = 0; x < r.w; x += TILE) {
        const v = ((x / TILE) * 5 + (y / TILE) * 3) % 3;
        const src = scene.textures.get(`${ROCK_KEY}-${v}`).getSourceImage() as HTMLCanvasElement;
        ctx.drawImage(src, x, y);
      }
    }
    for (let row = 0; row < field.height; row++) {
      for (let col = 0; col < field.width; col++) {
        // 横からでは、柵のマスに平地の草を敷く（立てた柵の絵と向きが食い違わないように。art/tallArt.ts）
        const terrain = groundTerrain(fv.art, field.terrain[row * field.width + col] ?? 'plain');
        // 平地の模様は、マスの位置から決まった順で混ぜる（毎回同じ見た目にする）
        const variant = (col * 7 + row * 13 + ((col * row) % 5)) % PLAIN_VARIANTS;
        const src = scene.textures.get(tileKey(terrain, variant)).getSourceImage() as HTMLCanvasElement;
        // 斜めや横からではマスの大きさが変わるので、タイルをマスの矩形に合わせて伸び縮みさせて敷く（ぼかさずに。回さない）
        const c = fv.cellRect(col, row);
        ctx.drawImage(src, c.x - r.x, c.y - r.y, c.w, c.h);
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

/** マスに平たい絵（霧・瓦礫）を1枚置く。マスの矩形に合わせて伸び縮みさせる */
export function addCellImage(scene: Phaser.Scene, fv: FieldView, col: number, row: number, key: string): Phaser.GameObjects.Image {
  const r = fv.cellRect(col, row);
  return scene.add.image(r.x, r.y, key).setOrigin(0, 0).setDisplaySize(r.w, r.h);
}

/** 戦場のまわりの枠（輪郭 2px + 暗い金 2px）。描き場所（area）の外側に付ける */
export function drawFieldFrame(g: Phaser.GameObjects.Graphics, fv: FieldView, area: Rect = fv.rect): void {
  const r = area;
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
