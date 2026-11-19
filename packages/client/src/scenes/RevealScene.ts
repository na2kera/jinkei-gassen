// 公開（design §4.3 の reveal）。両軍の配置を見せ、開戦の時刻までの短い間を置く。
// 配置はサーバーが「自分が下」に返し済みなので、戦場は返さずに描く。開戦の時刻が来ると、room が battle になり、
// pvp.ts が戦闘の画面へ移す（このシーンは移らない）。

import { PVP_MAPS } from '@jinkei/engine';
import Phaser from 'phaser';
import { addFieldImage, drawFieldFrame } from '../art/field.ts';
import { COLOR } from '../art/palette.ts';
import { UnitSprite } from '../art/UnitSprite.ts';
import { centeredFieldView, FieldView } from '../battle/FieldView.ts';
import { debug } from '../debug.ts';
import { deployReserveSlot, getLayout, LAYOUT_EVENT } from '../layout.ts';
import { client, pvp } from '../net/pvp.ts';
import { KIND_LABEL, RESERVE_LABEL } from '../ui/labels.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';

export class RevealScene extends Phaser.Scene {
  private fv!: FieldView;
  private countText!: Phaser.GameObjects.Text;
  private countBox!: Phaser.GameObjects.Graphics;
  private soldiers!: Phaser.GameObjects.Container;
  private marks!: Phaser.GameObjects.Container;
  /** 部隊を組んだ戦いの番号。まだなら -1 */
  private builtFor = -1;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super('Reveal');
  }

  create(): void {
    debug.scene = 'Reveal';
    pvp.arrived('Reveal');
    this.builtFor = -1;
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    const room = client.room;
    if (!room) return;
    const field = room.field;
    this.fv = centeredFieldView(layout.field, field, false);
    drawFieldFrame(this.add.graphics(), this.fv, layout.field);
    addFieldImage(this, this.fv, field, layout.field);
    this.soldiers = this.add.container(0, 0);
    this.marks = this.add.container(0, 0);
    this.countBox = this.add.graphics();
    this.countText = addText(this, 0, 0, '', 32, COLOR.goldHi).setOrigin(0.5, 0.5);
    // 戦場の名前を、開戦までの数え下げの下（両軍のあいだの空いた所）に小さく出す
    const mapName = PVP_MAPS.find((m) => m.id === room.map)?.name;
    if (mapName) {
      const t = addText(this, 0, 0, mapName, 16, COLOR.cream).setOrigin(0.5, 0.5);
      const w = Math.ceil(t.width / 2) * 2 + 20;
      const f = this.fv.rect;
      const r = { x: Math.round((f.x + f.w / 2 - w / 2) / 2) * 2, y: Math.round((f.y + f.h / 2 + 34) / 2) * 2, w, h: 28 };
      drawBox(this.add.graphics(), r);
      this.children.bringToTop(t);
      t.setPosition(Math.round(r.x + w / 2), r.y + 14);
    }
    // reveal が画面を作るより遅れて届くこともあるので、届いた時点で部隊を組む
    this.buildArmies();
    this.unsubscribe = client.subscribe(() => this.buildArmies());

    // 向きが変わったら作り直す。画面の切り替えとぶつからないよう pvp.ts に頼む
    const onLayout = (): void => pvp.requestRestart(this);
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      this.unsubscribe?.();
    });
  }

  /** いまの戦いの reveal が届いていれば、両軍の配置を組む（1回だけ） */
  private buildArmies(): void {
    const room = client.room;
    const reveal = client.reveal;
    if (!room || !reveal || !this.fv || reveal.battleNo !== room.battleNo || this.builtFor === reveal.battleNo) return;
    this.builtFor = reveal.battleNo;
    {
      let id = 0;
      reveal.armies.forEach((army, side) => {
        const team = side === room.you ? 0 : 1;
        for (const p of army) {
          const s = new UnitSprite(this, team, p.kind, id++, this.soldiers, this.marks, this.fv);
          const c = this.fv.cellCenter(p.col, p.row);
          // 自軍は上を、敵軍は下を向いて並ぶ（どちらの人にも自軍が下に見える）
          s.apply({ x: c.x, y: c.y, fx: 0, fy: team === 0 ? -1 : 1, menRatio: 1, morale: 100, rout: 0, highlight: false, bounds: this.fv.rect });
        }
      });
    }
    // 自分の遊軍だけを、配置の画面と同じ場所の枠で見せる（相手の遊軍は届かないので出さない。design §7.8）
    const mine = reveal.myReserve;
    if (mine) {
      const r = deployReserveSlot(getLayout(), true);
      drawBox(this.add.graphics(), r);
      addText(this, Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2), `${RESERVE_LABEL} ${KIND_LABEL[mine.kind]}`, 16, COLOR.cream).setOrigin(0.5, 0.5);
    }
    // 数え下げの箱を部隊より上に出す
    this.children.bringToTop(this.countBox);
    this.children.bringToTop(this.countText);
  }

  override update(): void {
    const reveal = client.reveal;
    if (!reveal || !this.fv || !this.countText) return;
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
