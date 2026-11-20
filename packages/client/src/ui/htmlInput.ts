// 名前と部屋のコードの入力欄（design §5.1：入力だけ素の HTML の input を重ねる）。
// Phaser の内部の座標で矩形を受け取り、canvas の拡大に合わせて重ねる。見た目はドット調の枠に合わせる
// （平らな地、金の線、輪郭。影やぼかし・角丸は使わない）。

import type Phaser from 'phaser';
import { COLOR, css } from '../art/palette.ts';
import type { Rect } from '../layout.ts';
import { addHitObstacle } from './hitRegistry.ts';
import { FONT_FAMILY } from './text.ts';

export interface HtmlInputOptions {
  value?: string;
  maxLength: number;
  /** 数字だけ（スマホで数字のキーボードを出す） */
  numeric?: boolean;
  placeholder?: string;
  onInput?: (value: string) => void;
  onEnter?: () => void;
}

export class HtmlInput {
  readonly el: HTMLInputElement;
  private readonly onResize: () => void;
  /** ボタンの押せる範囲の障害物から外す（design §9.9-3） */
  private readonly removeHit: () => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly rect: Rect,
    opts: HtmlInputOptions,
  ) {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = opts.value ?? '';
    el.maxLength = opts.maxLength;
    el.autocomplete = 'off';
    el.spellcheck = false;
    if (opts.placeholder) el.placeholder = opts.placeholder;
    if (opts.numeric) {
      el.inputMode = 'numeric';
      el.pattern = '[0-9]*';
    }
    Object.assign(el.style, {
      position: 'fixed',
      boxSizing: 'border-box',
      margin: '0',
      padding: '0 6px',
      fontFamily: FONT_FAMILY,
      color: css(COLOR.cream),
      background: css(COLOR.panel),
      border: `solid ${css(COLOR.gold)}`,
      outline: `solid ${css(COLOR.outline)}`,
      borderRadius: '0',
      boxShadow: 'none',
      // 入力欄の中だけは、文字の選択とタッチ操作を許す（body で止めているため）
      userSelect: 'text',
      webkitUserSelect: 'text',
      touchAction: 'manipulation',
      zIndex: '10',
    } as Partial<CSSStyleDeclaration>);
    el.addEventListener('input', () => {
      if (opts.numeric) el.value = el.value.replace(/\D/g, '').slice(0, opts.maxLength);
      opts.onInput?.(el.value);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') opts.onEnter?.();
    });
    document.body.appendChild(el);
    this.el = el;
    this.onResize = () => this.place();
    window.addEventListener('resize', this.onResize);
    // 欄の上には、隣のボタンの押せる範囲を広げない（欄は canvas の上に重なるので、広げても押せない所になるため）
    this.removeHit = addHitObstacle(scene, rect);
    this.place();
  }

  get value(): string {
    return this.el.value;
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? 'block' : 'none';
  }

  /** canvas の拡大に合わせて、位置と大きさと文字の大きさを決め直す */
  place(): void {
    const canvas = this.scene.game.canvas;
    const b = canvas.getBoundingClientRect();
    const k = b.width / this.scene.scale.width;
    const r = this.rect;
    Object.assign(this.el.style, {
      left: `${b.left + r.x * k}px`,
      top: `${b.top + r.y * k}px`,
      width: `${r.w * k}px`,
      height: `${r.h * k}px`,
      fontSize: `${16 * k}px`,
      borderWidth: `${2 * k}px`,
      outlineWidth: `${2 * k}px`,
    });
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.removeHit();
    this.el.remove();
  }
}
