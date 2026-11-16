// 陣形の保存と呼び出しの窓（design §5.6）。配置の画面の上に重ねる。
// 上の行で名前を付けて保存し、下の一覧（名前と、小さな配置の絵）から呼び出す・消す（2回押して確定）。
// 8つあって新しい名前で保存しようとしたら、一覧が「入れ替える相手を選ぶ」形に変わる。
// 名前の入力欄は、部屋の画面と同じ作りの HTML の入力欄。
// 窓の後ろ全体に押せる板を敷き、窓が開いている間は戦場を押せないようにする。
// 保存の知らせは、窓の下の端の1行に出す（窓の外に出すと、窓に隠れるため）。
// 名前の入力欄は、一覧を作り直しても作り直さない（打っている途中で焦点が外れないように）。

import type { Kind } from '@jinkei/engine';
import Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import type { Layout, Rect } from '../layout.ts';
import { deleteFormation, MAX_FORMATIONS, saveFormation, savedFormations, type SavedFormation } from '../save.ts';
import { Button } from './Button.ts';
import { HtmlInput } from './htmlInput.ts';
import { checkFit } from './overflow.ts';
import { drawBox } from './panel.ts';
import { addText } from './text.ts';

/** 名前の文字数の上限（コードポイント） */
const NAME_MAX = 8;
const ROW_H = 30;
/** 「消す」を2回押すまでの猶予（ミリ秒） */
const DELETE_ARM_MS = 2500;
/** 窓の中の知らせを出しておく時間（ミリ秒） */
const MESSAGE_MS = 2500;
/** 窓の下の端の、知らせの行の高さ */
const MESSAGE_H = 26;

/** 小さな配置の絵の、兵種ごとの点の色 */
const DOT: Record<Kind, number> = {
  hq: COLOR.gold,
  infantry: 0x7d9de0,
  shield: 0xc0904a,
  cavalry: 0x9a6a3a,
  archer: COLOR.cream,
};

export interface FormationDialogHost {
  /** いまの配置を、保存する形（配置エリアの左上を原点）にして返す。部隊がなければ null */
  current(): SavedFormation['units'] | null;
  /** 配置エリアの幅 */
  zoneWidth(): number;
  /** 呼び出した陣形を置く */
  recall(f: SavedFormation): void;
}

export class FormationDialog {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly buttons: Button[] = [];
  private input: HtmlInput | null = null;
  /** 8つあって新しい名前を保存しようとしているとき、その陣形（入れ替える相手を選ぶ） */
  private pending: SavedFormation | null = null;
  private deleteArmed: { name: string; until: number } | null = null;
  private message: { text: string; until: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layout: Layout,
    private readonly host: FormationDialogHost,
    private readonly onClose: () => void,
  ) {
    this.build();
  }

  /** 窓の矩形（画面の中央） */
  private rect(): Rect {
    const l = this.layout;
    const w = Math.min(l.width - 16, 360);
    const h = 36 + 40 + MAX_FORMATIONS * ROW_H + 8 + MESSAGE_H;
    return { x: Math.round((l.width - w) / 4) * 2, y: Math.round((l.height - h) / 4) * 2, w, h };
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objects.push(o);
    return o;
  }

  private button(r: Rect, label: string, onTap: () => void, primary = false): Button {
    const b = new Button(this.scene, r, label, onTap, { primary });
    this.buttons.push(b);
    return b;
  }

  /** 窓の中身を消す。keepInput なら、名前の入力欄は残す（焦点と打ちかけの文字を保つ） */
  private clear(keepInput = false): void {
    if (!keepInput) {
      this.input?.destroy();
      this.input = null;
    }
    for (const b of this.buttons) b.destroy();
    this.buttons.length = 0;
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
  }

  private build(): void {
    // 入れ替える相手を選ぶ間は入力欄を出さない。それ以外は、あれば残す
    this.clear(!this.pending);
    const s = this.scene;
    const l = this.layout;
    // 後ろ全体に押せる板を敷き、戦場や配置のボタンに届かないようにする
    const block = this.add(s.add.zone(0, 0, l.width, l.height).setOrigin(0, 0).setInteractive());
    void block;
    const r = this.rect();
    drawBox(this.add(s.add.graphics()), r);
    const x = r.x + 10;
    const w = r.w - 20;
    this.add(addText(s, x, r.y + 12, this.pending ? '入れ替える陣形を選ぶ' : '陣形', 16, this.pending ? COLOR.goldHi : COLOR.muted));
    this.button({ x: r.x + r.w - 10 - 64, y: r.y + 8, w: 64, h: 26 }, '閉じる', () => this.close());

    // 保存の行：名前と「保存」
    const rowY = r.y + 40;
    if (!this.pending) {
      this.input ??= new HtmlInput(s, { x, y: rowY, w: w - 72, h: 30 }, { maxLength: 16, placeholder: '名前' });
      this.button({ x: x + w - 64, y: rowY, w: 64, h: 30 }, '保存', () => this.save(), true);
    } else {
      this.button({ x: x + w - 64, y: rowY, w: 64, h: 30 }, 'やめる', () => {
        this.pending = null;
        this.build();
      });
    }

    // 一覧：小さな配置の絵・名前・呼び出す（または入れ替える）・消す
    const list = savedFormations();
    const top = rowY + 40;
    list.forEach((f, i) => {
      const y = top + i * ROW_H;
      this.drawMini(f, x, y + 6);
      const name = this.add(addText(s, x + 34, y + ROW_H / 2, f.name, 16, COLOR.cream).setOrigin(0, 0.5));
      // 8文字の名前が「呼ぶ」に重ならないか（開発時だけ記録）。縦長の窓で、名前の右と「呼ぶ」の左の間は 6px
      checkFit(s.scene.key, f.name, name.width, name.height, w - 60 - 4 - 52 - 34 - 2 + 8, ROW_H);
      if (this.pending) {
        this.button({ x: x + w - 64, y: y + 2, w: 64, h: ROW_H - 4 }, '入替', () => this.replace(i));
        return;
      }
      // 「消す？」（3文字）が収まる幅を「消す」に取り、「呼ぶ」はその分だけ詰める
      this.button({ x: x + w - 60 - 4 - 52, y: y + 2, w: 52, h: ROW_H - 4 }, '呼ぶ', () => {
        this.host.recall(f);
        this.close();
      });
      const armed = this.deleteArmed && this.deleteArmed.name === f.name && this.deleteArmed.until > s.time.now;
      this.button({ x: x + w - 60, y: y + 2, w: 60, h: ROW_H - 4 }, armed ? '消す？' : '消す', () => this.pressDelete(f.name)).setSelected(!!armed);
    });
    if (list.length === 0) this.add(addText(s, x, top + 6, 'まだありません', 16, COLOR.dim));

    // 知らせの行（窓の下の端）
    const msg = this.message;
    if (msg && msg.until > s.time.now) {
      this.add(addText(s, x, r.y + r.h - MESSAGE_H / 2 - 4, msg.text, 16, COLOR.goldHi).setOrigin(0, 0.5));
    }
  }

  /** 小さな配置の絵（1マスを2px の点にし、兵種で色を変える） */
  private drawMini(f: SavedFormation, x: number, y: number): void {
    const g = this.add(this.scene.add.graphics());
    g.fillStyle(COLOR.outline, 1);
    g.fillRect(x, y, 28, 16);
    g.fillStyle(COLOR.panel2, 1);
    g.fillRect(x + 1, y + 1, 26, 14);
    // 配置エリア（幅 f.width × 奥行き6）を、横幅 24px に収める
    const ox = x + 2 + Math.floor((12 - Math.min(12, f.width)) / 2) * 2;
    for (const u of f.units) {
      if (u.col < 0 || u.col >= 12 || u.row < 0 || u.row >= 6) continue;
      g.fillStyle(DOT[u.kind], 1);
      g.fillRect(ox + u.col * 2, y + 2 + u.row * 2, 2, 2);
    }
  }

  private save(): void {
    const name = (this.input?.value ?? '').normalize('NFC').trim();
    const len = [...name].length;
    if (len < 1 || len > NAME_MAX) {
      this.say('名前を1〜8文字で入れてください');
      return;
    }
    const units = this.host.current();
    if (!units || units.length === 0) {
      this.say('部隊を置いてから保存してください');
      return;
    }
    const f: SavedFormation = { name, width: this.host.zoneWidth(), units };
    if (saveFormation(f)) {
      if (this.input) this.input.el.value = '';
      this.say(`「${name}」を保存しました`);
      this.build();
      return;
    }
    // 8つあって新しい名前：入れ替える相手を選ばせる
    this.pending = f;
    this.build();
  }

  private replace(i: number): void {
    const f = this.pending;
    if (!f) return;
    saveFormation(f, i);
    this.pending = null;
    this.say(`「${f.name}」を保存しました`);
    this.build();
  }

  /** 窓の下の端に知らせを出す（少したったら消す） */
  private say(text: string): void {
    const until = this.scene.time.now + MESSAGE_MS;
    this.message = { text, until };
    this.build();
    this.scene.time.delayedCall(MESSAGE_MS, () => {
      if (this.message && this.message.until <= this.scene.time.now && this.objects.length > 0) {
        this.message = null;
        this.build();
      }
    });
  }

  private pressDelete(name: string): void {
    const now = this.scene.time.now;
    if (this.deleteArmed && this.deleteArmed.name === name && this.deleteArmed.until > now) {
      deleteFormation(name);
      this.deleteArmed = null;
      this.build();
      return;
    }
    this.deleteArmed = { name, until: now + DELETE_ARM_MS };
    this.build();
    this.scene.time.delayedCall(DELETE_ARM_MS, () => {
      if (this.deleteArmed && this.deleteArmed.name === name && this.scene.time.now >= this.deleteArmed.until) {
        this.deleteArmed = null;
        if (this.objects.length > 0) this.build();
      }
    });
  }

  /** 入力欄の位置を canvas の拡大に合わせる（毎フレーム呼ぶ） */
  place(): void {
    this.input?.place();
  }

  close(): void {
    this.clear();
    this.onClose();
  }
}
