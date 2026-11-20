// ボタン。枠と塗りは Graphics、押せる範囲は Zone で持つ（Container の当たり判定は原点がずれやすいため）。
// 押したボタンの上で離したときだけ反応する。マウスとタッチで同じに動く。
// 見た目は panel.ts の枠：ふつうは金の線、選んでいる・押しているときは明るい線、押せないときは暗い線。
// 「開戦」「もう一度」のような大事なボタンは primary にして、金の地で目立たせる。

import Phaser from 'phaser';
import { COLOR, css } from '../art/palette.ts';
import type { Rect } from '../layout.ts';
import { drawFrame, type FrameStyle } from './panel.ts';
import { addText, type FontSize } from './text.ts';
import { checkFit } from './overflow.ts';

export interface ButtonOptions {
  size?: FontSize;
  primary?: boolean;
}

export class Button {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private primary: boolean;
  private enabled = true;
  private selected = false;
  private pressed = false;

  constructor(
    scene: Phaser.Scene,
    readonly rect: Rect,
    text: string,
    private readonly onTap: () => void,
    options: ButtonOptions = {},
  ) {
    this.primary = options.primary ?? false;
    this.gfx = scene.add.graphics();
    this.label = addText(scene, 0, 0, text, options.size ?? 16).setOrigin(0.5, 0.5);
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
    if (this.label.text !== text) {
      this.label.setText(text);
      checkFit(this.label.scene.scene.key, text, this.label.width, this.label.height, this.rect.w, this.rect.h);
    }
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

  /** 主のボタンの見た目にするか（チュートリアルの点滅で、主の見た目とふつうの見た目を入れ替えるため） */
  setPrimary(v: boolean): this {
    if (this.primary !== v) {
      this.primary = v;
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

  destroy(): void {
    this.gfx.destroy();
    this.label.destroy();
    this.zone.destroy();
  }

  private redraw(): void {
    const r = this.rect;
    let style: FrameStyle;
    let text: number;
    if (!this.enabled) {
      style = 'dim';
      text = COLOR.dim;
    } else if (this.primary || this.selected || this.pressed) {
      // 大事なボタンと、選んでいるボタンは金の地。押している間は明るい線にして、押したことが分かるようにする
      style = this.pressed && !this.selected ? 'hot' : 'solid';
      text = style === 'solid' ? COLOR.ink : COLOR.goldHi;
    } else {
      style = 'line';
      text = COLOR.cream;
    }
    this.gfx.clear();
    drawFrame(this.gfx, r, style);
    this.label.setColor(css(text));
    // 文字の位置も整数の px に揃える。金の地のボタンは下と右が影なので、文字を 1px 上に寄せる
    this.label.setPosition(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2) - (style === 'solid' ? 1 : 0));
    // 文字が枠の内側からはみ出していないか（開発時だけ記録する）
    checkFit(this.label.scene.scene.key, this.label.text, this.label.width, this.label.height, r.w, r.h);
  }
}
