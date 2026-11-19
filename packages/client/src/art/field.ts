// 戦場の絵。地形ごとのタイルを、FieldView が決めたマスの位置に1枚の絵として貼り合わせる
// （192 マスを別々の絵にするより軽いため）。配置エリアの印は配置の画面だけで重ねる。

import type { Field, Zone } from '@jinkei/engine';
import Phaser from 'phaser';
import type { FieldView } from '../battle/FieldView.ts';
import { COLOR, css } from './palette.ts';
import type { Rect } from '../layout.ts';
import { BACKDROP_H, BACKDROP_W, backdropKey } from './backdrop.ts';
import { groundTerrain } from './tallArt.ts';
import { PLAIN_VARIANTS, ROCK_KEY, TILE, tileKey } from './textures.ts';

let serial = 0;

/**
 * 戦場の背景を作って置く。戻り値は置いた Image（作り直すときは destroy する）。
 * area は描き場所（12列ぶん）。戦場が狭いときは、戦場の外側の列に岩壁を敷く（谷の狭い道を表す）
 */
export function addFieldImage(scene: Phaser.Scene, fv: FieldView, field: Field, area: Rect = fv.rect, backdrop?: string): Phaser.GameObjects.Image {
  const r = area;
  const key = `field-bg-${serial++}`;
  const tex = scene.textures.createCanvas(key, r.w, r.h);
  if (tex && fv.perspective) {
    paintPerspectiveField(scene, tex.getContext(), fv, field, r, backdrop);
    tex.refresh();
  } else if (tex) {
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

/** 平地のタイルの模様の番号（マスの位置から決まった順で混ぜる。戦場の外の仮のマスでも負にならないようにする） */
function plainVariant(col: number, row: number): number {
  const m = (n: number, k: number): number => ((n % k) + k) % k;
  return m(col * 7 + row * 13 + m(col * row, 5), PLAIN_VARIANTS);
}

/** 岩壁のタイルの番号（3種） */
function rockVariant(col: number, row: number): number {
  return (((col * 5 + row * 3) % 3) + 3) % 3;
}

function sourceOf(scene: Phaser.Scene, key: string): CanvasImageSource {
  return scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
}

/**
 * 走査線でマスに絵を描く、地形・霧・瓦礫で共通の処理（将軍。design §5.8.3 補足2・5）。
 * 画面の矩形 box の中を、整数の行ごとに FieldView.scanSpans で区間に分け、srcOf が返すタイルの該当する1行（高さ 1px）の
 * 使う範囲（tx0〜tx1。枠の端をまたぐマスでは、枠の外の分を切り落とした範囲）を、区間の左端から右端まで伸ばして描く
 * （ぼかさない）。ctx の原点は box の左上。srcOf が null の区間は描かない
 */
export function paintScanCells(
  ctx: CanvasRenderingContext2D,
  fv: FieldView,
  box: Rect,
  srcOf: (dcol: number, drow: number) => CanvasImageSource | null,
): void {
  ctx.imageSmoothingEnabled = false;
  for (let sy = box.y; sy < box.y + box.h; sy++) {
    for (const sp of fv.scanSpans(sy, box.x, box.x + box.w, TILE)) {
      const src = srcOf(sp.dcol, sp.drow);
      if (src) ctx.drawImage(src, sp.tx0, sp.tileRow, sp.tx1 - sp.tx0, 1, sp.x0 - box.x, sy - box.y, sp.x1 - sp.x0, 1);
    }
  }
}

/**
 * 将軍の戦場の絵（描き場所ぜんぶ）：描き場所の上の端から戦場の奥の辺（rect の上の端）までは遠景の絵（288 × 192。
 * なければ空の色のべた塗り）、その下は走査線でタイルを敷く。奥の辺より向こうの地面は描かない
 * （design §5.8.3「遠景の絵を戦場の奥の辺まで下ろす」）。戦場の外の列は、12 列より狭い戦場では岩壁
 */
function paintPerspectiveField(scene: Phaser.Scene, ctx: CanvasRenderingContext2D, fv: FieldView, field: Field, r: Rect, backdrop?: string): void {
  ctx.imageSmoothingEnabled = false;
  const topH = Math.max(0, Math.min(r.h, fv.rect.y - r.y));
  const bk = backdrop ? backdropKey(backdrop) : '';
  const img = bk && scene.textures.exists(bk) ? (scene.textures.get(bk).getSourceImage() as HTMLImageElement) : null;
  if (img && img.width === BACKDROP_W && img.height === BACKDROP_H && topH === BACKDROP_H) {
    ctx.drawImage(img, 0, 0);
  } else {
    ctx.fillStyle = css(COLOR.sky);
    ctx.fillRect(0, 0, r.w, topH);
  }
  // 戦場の奥の辺から下だけを敷く（ctx の原点を、その矩形の左上にずらす）
  const ground = { x: r.x, y: r.y + topH, w: r.w, h: r.h - topH };
  ctx.save();
  ctx.translate(0, topH);
  paintScanCells(ctx, fv, ground, (dcol, drow) => {
    const { col, row } = fv.cellOfDisplay(dcol, drow);
    if (dcol >= 0 && dcol < field.width && drow >= 0 && drow < field.height) {
      const terrain = groundTerrain(fv.art, field.terrain[row * field.width + col] ?? 'plain');
      return sourceOf(scene, tileKey(terrain, plainVariant(col, row)));
    }
    // 戦場の外の列（12 列より狭い戦場の左右）は岩壁。12 列の戦場では、奥の辺より手前に外の列は入らない
    return sourceOf(scene, `${ROCK_KEY}-${rockVariant(col, row)}`);
  });
  ctx.restore();
}

/**
 * マスに平たい絵（霧・瓦礫）を1枚置く。遠近のない視点では、マスの矩形に合わせて伸び縮みさせる（いままでどおり）。
 * 遠近つき（将軍）では、マスを囲む矩形の大きさの絵を作り、地形と同じ走査線の方法でマスの形に描く
 * （作った絵は、置いた Image と一緒に消す）
 */
export function addCellImage(scene: Phaser.Scene, fv: FieldView, col: number, row: number, key: string): Phaser.GameObjects.Image {
  const r = fv.cellRect(col, row);
  if (!fv.perspective) return scene.add.image(r.x, r.y, key).setOrigin(0, 0).setDisplaySize(r.w, r.h);
  const tkey = `cell-img-${serial++}`;
  const tex = scene.textures.createCanvas(tkey, Math.max(1, r.w), Math.max(1, r.h));
  if (tex) {
    const src = sourceOf(scene, key);
    paintScanCells(tex.getContext(), fv, r, (dcol, drow) => {
      const c = fv.cellOfDisplay(dcol, drow);
      return c.col === col && c.row === row ? src : null;
    });
    tex.refresh();
  }
  const img = scene.add.image(r.x, r.y, tkey).setOrigin(0, 0);
  img.once(Phaser.GameObjects.Events.DESTROY, () => {
    if (scene.textures.exists(tkey)) scene.textures.remove(tkey);
  });
  return img;
}

/**
 * 将軍のとき、描き場所の外側（画面の端まで）を画面の地の色の板4枚で覆い、その上に戦場の枠を描き直す（design §5.8.3 補足7）。
 * 戦場の絵・兵・演出・旗と印の層より上、UI の層より下に置く。枠は drawFieldFrame と同じ形・同じ色（輪の形で描く）
 */
export function drawOutsideBoards(g: Phaser.GameObjects.Graphics, area: Rect, screenW: number, screenH: number): void {
  const a = area;
  g.fillStyle(COLOR.bg, 1);
  g.fillRect(0, 0, screenW, a.y - 4);
  g.fillRect(0, a.y + a.h + 4, screenW, screenH - (a.y + a.h + 4));
  g.fillRect(0, a.y - 4, a.x - 4, a.h + 8);
  g.fillRect(a.x + a.w + 4, a.y - 4, screenW - (a.x + a.w + 4), a.h + 8);
  ring(g, COLOR.dim, a.x - 4, a.y - 4, a.w + 8, a.h + 8);
  ring(g, COLOR.outline, a.x - 2, a.y - 2, a.w + 4, a.h + 4);
}

/** 矩形の内側 2px の輪 */
function ring(g: Phaser.GameObjects.Graphics, color: number, x: number, y: number, w: number, h: number): void {
  g.fillStyle(color, 1);
  g.fillRect(x, y, w, 2);
  g.fillRect(x, y + h - 2, w, 2);
  g.fillRect(x, y + 2, 2, h - 4);
  g.fillRect(x + w - 2, y + 2, 2, h - 4);
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
