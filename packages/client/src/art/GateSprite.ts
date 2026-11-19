// 門の絵（design §3.8）。城壁の切れ目に立つ扉。旗・兵・方針の印は付けない。
// 耐久は絵の壊れ具合（3段階）で示し、全滅したら門のマスと両隣の城壁のマスを瓦礫（通れる）の絵に変える。
// 瓦礫にするかどうかは、届く場面の field ではなく、BattleView.gate の状態（gone）で決める
// （engine は門が破れると両隣の城壁を平地に変えるが、平地と同じ絵では、門が破れた所だと分からないため）。

import type { Field } from '@jinkei/engine';
import type Phaser from 'phaser';
import type { FieldView } from '../battle/FieldView.ts';
import { addCellImage } from './field.ts';
import { placeTallCell, tallArt } from './tallArt.ts';
import { RUBBLE_KEY } from './textures.ts';

export class GateSprite {
  private readonly img: Phaser.GameObjects.Image;
  private readonly rubble: Phaser.GameObjects.Image[] = [];
  private stage: 0 | 1 | 2 = 0;
  private broken = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly fv: FieldView,
    private readonly field: Field,
    readonly col: number,
    readonly row: number,
    private readonly layer: Phaser.GameObjects.Container,
  ) {
    // 絵と置き方は視点の絵の組で決まる（真上は平たく敷き、立てる視点では、マスの手前の端に下の端を合わせて立てる）。
    // 奥のものから描く視点では、並べる値を depth に入れる
    // 将軍では、マスの手前の辺の幅に合わせて伸び縮みさせる（遠近のない視点では倍率 1）
    const a = tallArt(fv.art, 'gate')!;
    this.img = scene.add.image(0, 0, a.key).setOrigin(a.originX, a.originY);
    const at = placeTallCell(a, fv, col, row, { w: this.img.width, h: this.img.height });
    this.img.setPosition(at.x, at.y).setScale(at.scaleX, at.scaleY);
    if (fv.depthSorted) this.img.setDepth(at.depth);
    layer.add(this.img);
  }

  /** 耐久の割合から、壊れ具合を決める（3分の2より上は無傷、3分の1より上はひび、それ以下は大きく割れる） */
  setHealth(ratio: number): void {
    const stage: 0 | 1 | 2 = ratio > 2 / 3 ? 0 : ratio > 1 / 3 ? 1 : 2;
    if (stage === this.stage) return;
    this.stage = stage;
    this.img.setTexture(tallArt(this.fv.art, 'gate', { stage })!.key);
  }

  get isBroken(): boolean {
    return this.broken;
  }

  /** 破れた。門のマスと、両隣の城壁のマスを瓦礫にする。戻り値は瓦礫にしたマスの中心（演出の場所） */
  breakOpen(): { x: number; y: number; col: number }[] {
    if (this.broken) return [];
    this.broken = true;
    this.img.setVisible(false);
    const centers: { x: number; y: number; col: number }[] = [];
    for (const c of [this.col - 1, this.col, this.col + 1]) {
      if (c < 0 || c >= this.field.width) continue;
      const t = this.field.terrain[this.row * this.field.width + c];
      // 門のマスと、両隣のうち城壁のマスだけ（field は開戦時のものなので、崩れる前の城壁が入っている）
      if (c !== this.col && t !== 'wall') continue;
      const r = this.fv.cellRect(c, this.row);
      // 瓦礫は平たい絵なので、立てる視点でもマスの形に合わせて敷き（将軍は走査線で台形に描く）、どの部隊よりも下に描く
      const img = addCellImage(this.scene, this.fv, c, this.row, RUBBLE_KEY).setDepth(-1e6);
      this.layer.add(img);
      this.rubble.push(img);
      // 演出の場所：遠近つきではマスの中心（矩形の中心は台形の中心からずれる）。ほかの視点はいままでどおり矩形の中心
      const mid = this.fv.perspective ? this.fv.cellCenter(c, this.row) : { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      centers.push({ x: mid.x, y: mid.y, col: c });
    }
    return centers;
  }

  destroy(): void {
    this.img.destroy();
    for (const r of this.rubble) r.destroy();
  }
}
