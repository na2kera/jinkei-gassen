// ボタン。枠と塗りは Graphics、押せる範囲は Zone で持つ（Container の当たり判定は原点がずれやすいため）。
// 押したボタンの上で離したときだけ反応する。マウスとタッチで同じに動く。

import Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import type { Rect } from '../layout.ts';
import { drawBox } from './panel.ts';
import { addText, type FontSize } from './text.ts';

export class Button {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private enabled = true;
  private selected = false;
  private pressed = false;

  constructor(
    scene: Phaser.Scene,
    readonly rect: Rect,
    text: string,
    private readonly onTap: () => void,
    size: FontSize = 16,
  ) {
    this.gfx = scene.add.graphics();
    this.label = addText(scene, 0, 0, text, size).setOrigin(0.5, 0.5);
    this.zone = scene.add.zone(rect.x, rect.y, rect.w, rect.h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      if (!this.enabled) return;
      this.pressed = true;
      this.redraw();
    });
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
      if (!this.pressed) return;
      this.pressed = false;
      this.redraw();
    });
    this.zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      // タッチがキャンセルされたとき（OS のジェスチャーなど）も Phaser は up として届けるので、押した状態を戻すだけにする
      const fire = this.pressed && this.enabled && !pointer.wasCanceled;
      this.pressed = false;
      this.redraw();
      if (fire) this.onTap();
    });
    this.redraw();
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  setEnabled(v: boolean): this {
    if (this.enabled !== v) {
      this.enabled = v;
      if (!v) this.pressed = false;
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

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 表示物を Container に入れる（まとめて消すため） */
  addTo(c: Phaser.GameObjects.Container): this {
    c.add([this.gfx, this.label, this.zone]);
    return this;
  }

  setDepth(d: number): this {
    this.gfx.setDepth(d);
    this.label.setDepth(d);
    this.zone.setDepth(d);
    return this;
  }

  destroy(): void {
    this.gfx.destroy();
    this.label.destroy();
    this.zone.destroy();
  }

  private redraw(): void {
    const r = this.rect;
    const inverted = this.enabled && (this.selected || this.pressed);
    const fill = inverted ? COLOR.selected : COLOR.button;
    const border = this.enabled ? COLOR.border : COLOR.borderDim;
    const text = !this.enabled ? COLOR.textDim : inverted ? COLOR.selectedText : COLOR.text;
    this.gfx.clear();
    drawBox(this.gfx, r, fill, border);
    this.label.setColor(`#${text.toString(16).padStart(6, '0')}`);
    // 文字の位置も整数の px に揃える
    this.label.setPosition(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2));
  }
}
