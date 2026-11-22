// 手札のカード（design §15.3）と、配置の画面の遊軍の枠（§15.4）。見た目は Button と同じ枠（ドットの枠、いまの色）で、
// 中に 1 行か 2 行の文字を書く（カードは、1 行目が兵種の名前、2 行目がコストか残りの数）。
// Button と違い、「離したら押した」とは決めない。押し始めをシーンに知らせるだけにして、押したのか引っぱったのかは
// シーン（DeployScene）が決める（deployModel.ts の isDrag）。押せる範囲は Button と同じく名簿（hitRegistry.ts）で広げる。

import Phaser from 'phaser';
import { COLOR, css } from '../art/palette.ts';
import type { Rect } from '../layout.ts';
import { checkFit } from './overflow.ts';
import { drawFrame, type FrameStyle } from './panel.ts';
import { addHitButton } from './hitRegistry.ts';
import { addText } from './text.ts';

/** 2 行のときの、行と行の中心のあいだ（px） */
const LINE_GAP = 18;

export class Card {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly top: Phaser.GameObjects.Text;
  private readonly bottom: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly sceneKey: string;
  private enabled = true;
  private selected = false;
  /** 引っぱっている部隊を離せば何かが起きる、離す先として指が上にある（金の地） */
  private hot = false;
  private visible = true;

  constructor(
    scene: Phaser.Scene,
    readonly rect: Rect,
    line1: string,
    line2: string,
    onDown: (pointer: Phaser.Input.Pointer) => void,
  ) {
    this.sceneKey = scene.scene.key;
    this.gfx = scene.add.graphics();
    this.top = addText(scene, 0, 0, line1).setOrigin(0.5, 0.5);
    this.bottom = addText(scene, 0, 0, line2).setOrigin(0.5, 0.5);
    this.zone = scene.add.zone(rect.x, rect.y, rect.w, rect.h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    addHitButton(scene, rect, 'base', this.zone, line1);
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!this.visible) return;
      onDown(pointer);
    });
    this.redraw();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setLines(line1: string, line2: string): this {
    if (this.top.text !== line1 || this.bottom.text !== line2) {
      this.top.setText(line1);
      this.bottom.setText(line2);
      this.redraw();
    }
    return this;
  }

  setEnabled(v: boolean): this {
    if (this.enabled !== v) {
      this.enabled = v;
      this.redraw();
    }
    return this;
  }

  setSelected(v: boolean): this {
    if (this.selected !== v) {
      this.selected = v;
      this.redraw();
    }
    return this;
  }

  setHot(v: boolean): this {
    if (this.hot !== v) {
      this.hot = v;
      this.redraw();
    }
    return this;
  }

  setVisible(v: boolean): this {
    if (this.visible !== v) {
      this.visible = v;
      this.gfx.setVisible(v);
      this.top.setVisible(v);
      this.bottom.setVisible(v);
    }
    return this;
  }

  /** 表示物を手前に出す（重ねて出す箱の下にならないように） */
  bringToTop(scene: Phaser.Scene): void {
    scene.children.bringToTop(this.gfx);
    scene.children.bringToTop(this.top);
    scene.children.bringToTop(this.bottom);
  }

  destroy(): void {
    this.gfx.destroy();
    this.top.destroy();
    this.bottom.destroy();
    this.zone.destroy();
  }

  private redraw(): void {
    const r = this.rect;
    let style: FrameStyle;
    let text: number;
    if (!this.enabled) {
      style = 'dim';
      text = COLOR.dim;
    } else if (this.selected || this.hot) {
      // 選んでいるカードは、選んでいるボタンと同じ金の地
      style = 'solid';
      text = COLOR.ink;
    } else {
      style = 'line';
      text = COLOR.cream;
    }
    this.gfx.clear();
    drawFrame(this.gfx, r, style);
    const cx = Math.round(r.x + r.w / 2);
    const cy = Math.round(r.y + r.h / 2) - (style === 'solid' ? 1 : 0);
    const two = this.bottom.text !== '';
    this.top.setColor(css(text)).setPosition(cx, two ? cy - LINE_GAP / 2 : cy);
    this.bottom.setColor(css(text)).setPosition(cx, cy + LINE_GAP / 2).setVisible(this.visible && two);
    // 文字が枠の内側からはみ出していないか（開発時だけ記録する）。2 行のときは、1 行ぶんの高さで比べる
    const lineH = two ? r.h / 2 + 2 : r.h;
    checkFit(this.sceneKey, this.top.text, this.top.width, this.top.height, r.w, lineH);
    if (two) checkFit(this.sceneKey, this.bottom.text, this.bottom.width, this.bottom.height, r.w, lineH);
  }
}
