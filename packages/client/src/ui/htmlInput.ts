// 名前と部屋のコードの入力欄（design §5.1：入力だけ素の HTML の input を重ねる）。
// Phaser の内部の座標で矩形を受け取り、canvas の拡大に合わせて重ねる。見た目はドット調の枠に合わせる
// （平らな地、金の線、輪郭。影やぼかし・角丸は使わない）。
// 欄は canvas の親（#game）の中に absolute で置き、絵と一緒に動かす（design §12.2。iOS はキーボードでページをずらすため）。

import type Phaser from 'phaser';
import { COLOR, css } from '../art/palette.ts';
import type { Rect } from '../layout.ts';
import { addHitObstacle } from './hitRegistry.ts';
import { inputBox } from './inputBox.ts';
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
  /** 欄を置く入れ物（canvas の親）。ないときは body に fixed で置く */
  private readonly parent: HTMLElement | null;

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
    this.parent = scene.game.canvas.parentElement;
    Object.assign(el.style, {
      position: this.parent ? 'absolute' : 'fixed',
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
    // 押し始めを Phaser（window で受けている）へ伝えない。下に重なったボタンが押されないように（design §12.3）。
    // preventDefault は呼ばない（欄にフォーカスが入らなくなるため）。離す側は止めない（音の解禁と画面を消さない仕組みが受けるため）
    const stop = (e: Event): void => e.stopPropagation();
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('mousedown', stop);
    (this.parent ?? document.body).appendChild(el);
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
    const canvas = this.scene.game.canvas.getBoundingClientRect();
    // 親がないとき（fixed）は、画面の左上からの位置にする
    const parent = this.parent ? this.parent.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
    const { left, top, width, height, k } = inputBox(canvas, parent, this.scene.scale.width, this.rect);
    Object.assign(this.el.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      fontSize: `${16 * k}px`,
      borderWidth: `${2 * k}px`,
      outlineWidth: `${2 * k}px`,
    });
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.removeHit();
    // フォーカスを持ったまま消すと、ブラウザによっては focusout が出ない。入力中に止めていた組み直し（design §12.4）が
    // 残らないよう、先にフォーカスを外す
    if (document.activeElement === this.el) this.el.blur();
    this.el.remove();
  }
}
