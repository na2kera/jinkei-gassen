// 部屋の画面（design §5.1、decisions §9）。名前、「部屋を作る」「コードで入る」、前の部屋に戻る。
// 部屋に入ったあとは、コードを大きく出して「相手を待っています」。2人そろうと pvp.ts が配置の画面へ移す。
// このシーンは自分を作り直す予約（scene.restart）をしない。入る前と入ったあとの表示の切り替えは、
// シーンの中の表示物だけを組み直して行う（pvp.ts の画面の切り替えとぶつかって、2つの画面が動くのを防ぐため）。
// 入力途中のコードと「作成中」の状態はシーンの外（pvp.ts・RoomClient）に持ち、作り直しても消えない・二重に始まらない。

import Phaser from 'phaser';
import { COLOR, css } from '../art/palette.ts';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT, lobbyLayout } from '../layout.ts';
import { normalizeName } from '../net/name.ts';
import { client, lobbyInput, notice, notify, pvp, resumableCode } from '../net/pvp.ts';
import { playerId, savedName, saveName } from '../save.ts';
import { Button } from '../ui/Button.ts';
import { HtmlInput } from '../ui/htmlInput.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';

export class LobbyScene extends Phaser.Scene {
  private inputs: HtmlInput[] = [];
  private content: Phaser.GameObjects.Container | null = null;
  private buttons: Button[] = [];
  private createButton: Button | null = null;
  private statusText!: Phaser.GameObjects.Text;
  private shownInRoom: boolean | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super('Lobby');
  }

  create(): void {
    debug.scene = 'Lobby';
    pvp.arrived('Lobby');
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    this.inputs = [];
    this.buttons = [];
    this.content = null;
    this.createButton = null;
    this.shownInRoom = null;
    const l = lobbyLayout(layout);
    this.statusText = addText(this, Math.round(l.centerX), l.status, '', 16, COLOR.red).setOrigin(0.5, 0);
    this.build();
    // 部屋の様子が変わったら、表示物だけを組み直す（入った・失敗した など）。画面を移すのは pvp.ts
    this.unsubscribe = client.subscribe(() => this.build());

    const onLayout = (): void => {
      // 対戦の途中なら pvp.ts に作り直しを頼む（切り替えの予約とぶつからないように）
      if (pvp.active) pvp.requestRestart(this);
      else this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      this.unsubscribe?.();
      this.clear();
    });
  }

  private clear(): void {
    for (const i of this.inputs) i.destroy();
    for (const b of this.buttons) b.destroy();
    this.inputs = [];
    this.buttons = [];
    this.content?.destroy();
    this.content = null;
    this.createButton = null;
  }

  /** 入る前・入ったあとのどちらかの表示を組む。変わっていなければ、作成中の表示だけを直す */
  private build(): void {
    const inRoom = pvp.active && client.room !== null;
    if (inRoom === this.shownInRoom) {
      this.createButton?.setEnabled(!client.creating).setText(client.creating ? '作っています' : '部屋を作る');
      return;
    }
    this.shownInRoom = inRoom;
    this.clear();
    const l = lobbyLayout(getLayout());
    this.content = this.add.container(0, 0);
    if (inRoom) this.buildWaiting(l);
    else this.buildEntry(l);
    this.statusText.setY(inRoom ? l.waitStatus : l.status);
    this.children.bringToTop(this.statusText);
  }

  private button(...args: ConstructorParameters<typeof Button>): Button {
    const b = new Button(...args);
    this.buttons.push(b);
    return b;
  }

  /** 部屋に入る前：名前・部屋を作る・コードで入る・前の部屋に戻る */
  private buildEntry(l: ReturnType<typeof lobbyLayout>): void {
    const c = this.content!;
    this.button(this, l.back, '戻る', () => {
      // 作っている途中なら、その応答を捨てる（あとから対戦の画面へ連れ戻されないように）
      pvp.cancel();
      this.scene.start('Title');
    });
    c.add(addText(this, Math.round(l.centerX), l.title, '対戦', 32, COLOR.goldHi).setOrigin(0.5, 0));
    c.add(addText(this, l.nameLabel.x, l.nameLabel.y, '名前', 16, COLOR.muted).setOrigin(0, 0.5));
    const name = new HtmlInput(this, l.nameInput, {
      value: savedName(),
      maxLength: 24,
      onInput: (v) => saveName(v),
    });
    const code = new HtmlInput(this, l.codeInput, {
      value: lobbyInput.code,
      maxLength: 4,
      numeric: true,
      placeholder: '0000',
      onInput: (v) => {
        lobbyInput.code = v;
      },
      onEnter: () => this.join(code.value),
    });
    this.inputs.push(name, code);
    this.createButton = this.button(this, l.create, '部屋を作る', () => void this.createRoom(), { primary: true });
    this.createButton.setEnabled(!client.creating).setText(client.creating ? '作っています' : '部屋を作る');
    this.button(this, l.join, 'コードで入る', () => this.join(code.value));
    const prev = resumableCode();
    if (prev) this.button(this, l.resume, `前の部屋に戻る ${prev}`, () => this.join(prev));
  }

  /** 部屋に入ったあと：コード・写す・相手を待っています・出る */
  private buildWaiting(l: ReturnType<typeof lobbyLayout>): void {
    const c = this.content!;
    const code = client.room?.code ?? client.code ?? '';
    c.add(addText(this, Math.round(l.centerX), l.codeLabel, '部屋のコード', 16, COLOR.muted).setOrigin(0.5, 0.5));
    const g = this.add.graphics();
    drawBox(g, l.codeBox);
    c.add(g);
    c.add(addText(this, Math.round(l.centerX), Math.round(l.codeBox.y + l.codeBox.h / 2), code, 32, COLOR.goldHi).setOrigin(0.5, 0.5));
    this.button(this, l.copy, '写す', () => {
      // 押すとコードを写す。写せない環境（http の別の端末など）では、その旨を短く出す
      const w = navigator.clipboard?.writeText(code);
      if (!w) {
        notify('写せませんでした', 1500);
        return;
      }
      w.then(
        () => notify('写しました', 1500, false),
        () => notify('写せませんでした', 1500),
      );
    });
    c.add(addText(this, Math.round(l.centerX), l.waiting, '相手を待っています', 16, COLOR.cream).setOrigin(0.5, 0.5));
    this.button(this, l.leave, '部屋を出る', () => pvp.leave());
  }

  /** 名前を、サーバーと同じ決まりで確かめる。だめなら1行で知らせる */
  private nameOk(): string | null {
    const name = normalizeName(savedName());
    if (!name) {
      notify('名前を1〜12文字で入れてください');
      return null;
    }
    return name;
  }

  private async createRoom(): Promise<void> {
    if (client.creating) return;
    const name = this.nameOk();
    if (!name) return;
    pvp.begin();
    // 失敗の知らせは pvp.ts が出す（ここでも出すと二重になる）
    await client.create(playerId(), name);
  }

  private join(code: string): void {
    const name = this.nameOk();
    if (!name) return;
    if (!/^\d{4}$/.test(code)) {
      notify('4桁の数字を入れてください');
      return;
    }
    pvp.begin();
    client.join(code, playerId(), name);
  }

  override update(): void {
    // 入力欄の位置は canvas の拡大に合わせる（拡大の決まり直しは resize のあとに来るので、毎フレーム合わせる）
    for (const i of this.inputs) i.place();
    const text = Date.now() < notice.until ? notice.text : '';
    if (this.statusText.text !== text) this.statusText.setText(text).setColor(css(notice.error ? COLOR.red : COLOR.muted));
  }
}
