// 公開（design §4.3 の reveal）。両軍の配置を見せ、開戦の時刻までの短い間を置く。
// 配置はサーバーが「自分が下」に返し済みなので、戦場は返さずに描く。開戦の時刻が来ると、room が battle になり、
// pvp.ts が戦闘の画面へ移す（このシーンは移らない）。

import Phaser from 'phaser';
import { addFieldImage, drawFieldFrame } from '../art/field.ts';
import { COLOR } from '../art/palette.ts';
import { UnitSprite } from '../art/UnitSprite.ts';
import { FieldView } from '../battle/FieldView.ts';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT } from '../layout.ts';
import { client } from '../net/pvp.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';

export class RevealScene extends Phaser.Scene {
  private fv!: FieldView;
  private countText!: Phaser.GameObjects.Text;
  private countBox!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Reveal');
  }

  create(): void {
    debug.scene = 'Reveal';
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    const room = client.room;
    if (!room) return;
    const field = room.field;
    this.fv = new FieldView(layout.field, field.width, field.height, false);
    drawFieldFrame(this.add.graphics(), this.fv);
    addFieldImage(this, this.fv, field);
    const soldiers = this.add.container(0, 0);
    const marks = this.add.container(0, 0);
    const reveal = client.reveal;
    if (reveal) {
      let id = 0;
      reveal.armies.forEach((army, side) => {
        const team = side === room.you ? 0 : 1;
        for (const p of army) {
          const s = new UnitSprite(this, team, p.kind, id++, soldiers, marks);
          const c = this.fv.cellCenter(p.col, p.row);
          // 自軍は上を、敵軍は下を向いて並ぶ（どちらの人にも自軍が下に見える）
          const d = this.fv.dirToScreen(0, team === 0 ? -1 : 1);
          s.apply({ x: c.x, y: c.y, dx: d.x, dy: d.y, menRatio: 1, morale: 100, rout: 0, highlight: false, bounds: this.fv.rect });
        }
      });
    }
    this.countBox = this.add.graphics();
    this.countText = addText(this, 0, 0, '', 32, COLOR.goldHi).setOrigin(0.5, 0.5);

    const onLayout = (): void => {
      this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(LAYOUT_EVENT, onLayout));
  }

  override update(): void {
    const reveal = client.reveal;
    if (!reveal || !this.fv) return;
    const left = Math.ceil((reveal.startsAt - client.serverNow()) / 1000);
    const text = left > 0 ? `開戦まで ${left}` : '開戦';
    if (this.countText.text === text) return;
    this.countText.setText(text);
    const f = this.fv.rect;
    const w = Math.ceil(this.countText.width / 2) * 2 + 40;
    const r = { x: Math.round((f.x + f.w / 2 - w / 2) / 2) * 2, y: f.y + f.h / 2 - 28, w, h: 56 };
    this.countBox.clear();
    drawBox(this.countBox, r);
    this.countText.setPosition(Math.round(r.x + w / 2), Math.round(r.y + 28));
  }
}
