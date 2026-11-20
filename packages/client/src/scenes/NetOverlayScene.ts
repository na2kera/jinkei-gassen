// 対戦の間、ほかの画面の上に重ねる表示。つなぎ直しの最中・短い知らせ・相手が切れている印だけを出す。
// シーンの並びの最後に置き、いつも一番上に描かれるようにしている。

import Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import { getLayout } from '../layout.ts';
import { client, notice, pvp } from '../net/pvp.ts';
import { opponentMark } from '../net/pvpText.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';

export class NetOverlayScene extends Phaser.Scene {
  private box!: Phaser.GameObjects.Graphics;
  private text!: Phaser.GameObjects.Text;
  private mark!: Phaser.GameObjects.Graphics;
  private markText!: Phaser.GameObjects.Text;
  private last = '';
  private lastMark = '';

  constructor() {
    super('NetOverlay');
  }

  create(): void {
    this.box = this.add.graphics();
    this.text = addText(this, 0, 0, '', 16, COLOR.cream).setOrigin(0.5, 0.5);
    this.mark = this.add.graphics();
    this.markText = addText(this, 0, 0, '', 16, COLOR.red).setOrigin(0, 0.5);
  }

  override update(): void {
    const layout = getLayout();
    if (this.cameras.main.width !== layout.width || this.cameras.main.height !== layout.height) {
      this.cameras.main.setSize(layout.width, layout.height);
      this.last = '';
      this.lastMark = '';
    }
    // 上の中央：つなぎ直し中、または短い知らせ（部屋の画面では、画面の中で知らせを出すので重ねない）
    const lobby = this.scene.isActive('Lobby');
    let text = '';
    if (pvp.active && client.status === 'reconnecting') text = 'つなぎ直しています';
    else if (!lobby && Date.now() < notice.until) text = notice.text;
    if (text !== this.last) {
      this.last = text;
      this.box.clear();
      this.text.setText(text).setVisible(text !== '');
      if (text) {
        const w = Math.ceil(this.text.width / 2) * 2 + 24;
        const r = { x: Math.round((layout.width / 2 - w / 2) / 2) * 2, y: layout.height / 2 - 16, w, h: 32 };
        drawBox(this.box, r);
        this.text.setPosition(Math.round(r.x + w / 2), r.y + 16);
      }
    }
    // 戦場の左上：相手が切れているときの小さな印（自分で出たなら「相手 退出」、ただ切れたなら「相手 切断」。design §11.2）
    const mark = opponentMark(client.room, pvp.active);
    const away = mark !== '';
    const where = this.scene.isActive('PvpResult') ? 'r' : 'f';
    if (mark + where !== this.lastMark) {
      this.lastMark = mark + where;
      this.mark.clear();
      this.markText.setText(mark).setVisible(away);
      if (away) {
        // 戦場のある画面では戦場の左下、結果の画面などでは画面の左上に出す
        const onField = this.scene.isActive('Battle') || this.scene.isActive('Deploy') || this.scene.isActive('Reveal');
        const f = layout.field;
        const w = Math.ceil(this.markText.width / 2) * 2 + 16;
        const x = onField ? f.x + 4 : 8;
        const y = onField ? f.y + f.h - 32 : 8;
        drawBox(this.mark, { x, y, w, h: 28 });
        this.markText.setPosition(x + 8, y + 14);
      }
    }
  }
}
