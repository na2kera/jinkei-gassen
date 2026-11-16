// 部屋の画面（design §5.1、decisions §9）。名前、「部屋を作る」「コードで入る」、前の部屋に戻る。
// 部屋に入ったあとは、コードを大きく出して「相手を待っています」。2人そろうと pvp.ts が配置の画面へ移す。
// 段階の移り変わりはこのシーンでは決めない（届いた room を見て、自分の表示を描き直すだけ）。

import Phaser from 'phaser';
import { COLOR, css } from '../art/palette.ts';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT, lobbyLayout } from '../layout.ts';
import { client, notice, notify, pvp, resumableCode } from '../net/pvp.ts';
import { failureText } from '../net/RoomClient.ts';
import { playerId, savedName, saveName } from '../save.ts';
import { Button } from '../ui/Button.ts';
import { HtmlInput } from '../ui/htmlInput.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';

const NAME_MAX = 12;

export class LobbyScene extends Phaser.Scene {
  private inputs: HtmlInput[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private unsubscribe: (() => void) | null = null;
  private busy = false;

  constructor() {
    super('Lobby');
  }

  create(): void {
    debug.scene = 'Lobby';
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    this.inputs = [];
    this.busy = false;
    const l = lobbyLayout(layout);
    const inRoom = pvp.active && client.room !== null;

    if (inRoom) this.buildWaiting(l);
    else this.buildEntry(l);

    this.statusText = addText(this, Math.round(l.centerX), inRoom ? l.waitStatus : l.status, '', 16, COLOR.red).setOrigin(0.5, 0);
    // 部屋の様子が変わったら描き直す（入った・相手が来た・失敗した など）。画面を移すのは pvp.ts
    this.unsubscribe = client.subscribe(() => {
      const nowInRoom = pvp.active && client.room !== null;
      if (nowInRoom !== inRoom) this.scene.restart();
    });

    const onLayout = (): void => {
      this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      this.unsubscribe?.();
      for (const i of this.inputs) i.destroy();
      this.inputs = [];
    });
  }

  /** 部屋に入る前：名前・部屋を作る・コードで入る・前の部屋に戻る */
  private buildEntry(l: ReturnType<typeof lobbyLayout>): void {
    new Button(this, l.back, '戻る', () => this.scene.start('Title'));
    addText(this, Math.round(l.centerX), l.title, '対戦', 32, COLOR.goldHi).setOrigin(0.5, 0);
    addText(this, l.nameLabel.x, l.nameLabel.y, '名前', 16, COLOR.muted).setOrigin(0, 0.5);
    const name = new HtmlInput(this, l.nameInput, {
      value: savedName(),
      maxLength: NAME_MAX,
      onInput: (v) => saveName(v.trim()),
    });
    const code = new HtmlInput(this, l.codeInput, { maxLength: 4, numeric: true, placeholder: '0000', onEnter: () => this.join(code.value) });
    this.inputs.push(name, code);
    new Button(this, l.create, '部屋を作る', () => void this.createRoom(), { primary: true });
    new Button(this, l.join, 'コードで入る', () => this.join(code.value));
    const prev = resumableCode();
    if (prev) new Button(this, l.resume, `前の部屋に戻る ${prev}`, () => this.join(prev));
  }

  /** 部屋に入ったあと：コード・写す・相手を待っています・出る */
  private buildWaiting(l: ReturnType<typeof lobbyLayout>): void {
    const code = client.room?.code ?? client.code ?? '';
    addText(this, Math.round(l.centerX), l.codeLabel, '部屋のコード', 16, COLOR.muted).setOrigin(0.5, 0.5);
    const g = this.add.graphics();
    drawBox(g, l.codeBox);
    addText(this, Math.round(l.centerX), Math.round(l.codeBox.y + l.codeBox.h / 2), code, 32, COLOR.goldHi).setOrigin(0.5, 0.5);
    new Button(this, l.copy, '写す', () => {
      // 押すとコードを写す。写せない環境（http の別の端末など）では、その旨を短く出す
      navigator.clipboard?.writeText(code).then(
        () => notify('写しました', 1500, false),
        () => notify('写せませんでした', 1500),
      ) ?? notify('写せませんでした', 1500);
    });
    addText(this, Math.round(l.centerX), l.waiting, '相手を待っています', 16, COLOR.cream).setOrigin(0.5, 0.5);
    new Button(this, l.leave, '部屋を出る', () => pvp.leave());
  }

  private nameOk(): string | null {
    const name = savedName().trim();
    const len = [...name].length;
    if (len < 1 || len > NAME_MAX) {
      notify('名前を入れてください');
      return null;
    }
    return name;
  }

  private async createRoom(): Promise<void> {
    const name = this.nameOk();
    if (!name || this.busy) return;
    this.busy = true;
    pvp.begin();
    const ok = await client.create(playerId(), name);
    this.busy = false;
    if (!ok && client.failure) {
      notify(failureText(client.failure));
      pvp.leave();
    }
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
