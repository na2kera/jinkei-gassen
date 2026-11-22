// 公開（design §4.3 の reveal・§14.5）。両軍の配置を見せ、開戦の時刻までの短い間に、盤を選んである向きまで回す。
// 進み具合は startsAt に対する絶対の時刻で決める（はじめの 0.8 秒は回さず、残りの 2.2 秒で回す）。開戦の時刻が来ると、
// room が battle になり、pvp.ts が戦闘の画面へ移す（このシーンは移らない。戦いの始まりを画面の側の時計で決めない）。
// 配置はサーバーが「自分が下」に返し済みなので、戦場は返さずに描く。

import { PVP_MAPS } from '@jinkei/engine';
import Phaser from 'phaser';
import { drawFieldFrame } from '../art/field.ts';
import { COLOR } from '../art/palette.ts';
import { Forest, Ground } from '../art/stack/ground.ts';
import { fieldHeight } from '../art/stack/height.ts';
import { SquadSprite } from '../art/stack/SquadSprite.ts';
import { stackTextures } from '../art/stack/stackTextures.ts';
import { BoardView, ease } from '../battle/BoardView.ts';
import { revealCam, revealProgress, type BoardDir } from '../battle/camera.ts';
import { debug } from '../debug.ts';
import { deployReserveSlot, getLayout, LAYOUT_EVENT, type Rect } from '../layout.ts';
import { client, pvp } from '../net/pvp.ts';
import { savedBoardDir } from '../save.ts';
import { KIND_LABEL, RESERVE_LABEL } from '../ui/labels.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';

/** 回っているあいだの兵の縮み（大きさ 1 → 0.84） */
const SHRINK = 0.16;

export class RevealScene extends Phaser.Scene {
  private bv!: BoardView;
  private area!: Rect;
  private dir: BoardDir = 'right';
  private ground: Ground | null = null;
  private forest: Forest | null = null;
  private countText!: Phaser.GameObjects.Text;
  private countBox!: Phaser.GameObjects.Graphics;
  private soldiers!: Phaser.GameObjects.Container;
  private marks!: Phaser.GameObjects.Container;
  private squads: { s: SquadSprite; p: { col: number; row: number }; team: 0 | 1 }[] = [];
  /** 部隊を組んだ戦いの番号。まだなら -1 */
  private builtFor = -1;
  private unsubscribe: (() => void) | null = null;
  /** 確かめ用：回転の進み具合をこの値で止める */
  private freeze: number | null = null;

  constructor() {
    super('Reveal');
  }

  create(): void {
    debug.scene = 'Reveal';
    pvp.arrived('Reveal');
    this.builtFor = -1;
    this.squads = [];
    this.freeze = null;
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    const room = client.room;
    if (!room) return;
    const field = room.field;
    this.area = layout.field;
    this.dir = savedBoardDir();
    this.bv = new BoardView(layout.field, field, { hm: fieldHeight(field) });
    // 公開の揃い（配置の画面で頼んである。入り直しなどで頼んでいなければ、ここで頼む）
    stackTextures.request('reveal');
    drawFieldFrame(this.add.graphics(), this.bv, layout.field);
    const groundLayer = this.add.container(0, 0);
    this.soldiers = this.add.container(0, 0);
    const fogLayer = this.add.container(0, 0);
    this.marks = this.add.container(0, 0);
    this.ground = new Ground(this, this.bv, field, groundLayer, fogLayer);
    this.forest = new Forest(this, this.bv, field, this.soldiers);
    this.countBox = this.add.graphics();
    this.countText = addText(this, 0, 0, '', 32, COLOR.goldHi).setOrigin(0.5, 0.5);
    // 戦場の名前を、数え下げの下に小さく出す。数え下げの箱と地図の名前は、描き場所のまん中に固定する（盤と一緒に回さない）
    const mapName = PVP_MAPS.find((m) => m.id === room.map)?.name;
    if (mapName) {
      const t = addText(this, 0, 0, mapName, 16, COLOR.cream).setOrigin(0.5, 0.5);
      const w = Math.ceil(t.width / 2) * 2 + 20;
      const a = this.area;
      const r = { x: Math.round((a.x + a.w / 2 - w / 2) / 2) * 2, y: Math.round((a.y + a.h / 2 + 34) / 2) * 2, w, h: 28 };
      drawBox(this.add.graphics(), r);
      this.children.bringToTop(t);
      t.setPosition(Math.round(r.x + w / 2), r.y + 14);
    }
    // reveal が画面を作るより遅れて届くこともあるので、届いた時点で部隊を組む
    this.buildArmies();
    this.unsubscribe = client.subscribe(() => this.buildArmies());
    debug.revealFreeze = (p) => {
      this.freeze = p;
    };

    // 向きが変わったら作り直す。画面の切り替えとぶつからないよう pvp.ts に頼む（進み具合は時刻で決まるので、続きから回る）
    const onLayout = (): void => pvp.requestRestart(this);
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      this.unsubscribe?.();
      debug.revealFreeze = null;
      this.ground?.destroy();
      this.ground = null;
      this.forest = null;
      // 公開の揃いは、公開の画面が終わるときに捨てる（design §14.3）。向きが変わった作り直しでは、すぐ頼み直す
      stackTextures.release('reveal');
    });
  }

  /** いまの戦いの reveal が届いていれば、両軍の配置を組む（1回だけ） */
  private buildArmies(): void {
    const room = client.room;
    const reveal = client.reveal;
    if (!room || !reveal || !this.bv || reveal.battleNo !== room.battleNo || this.builtFor === reveal.battleNo) return;
    this.builtFor = reveal.battleNo;
    let id = 0;
    reveal.armies.forEach((army, side) => {
      const team = side === room.you ? 0 : 1;
      for (const p of army) this.squads.push({ s: new SquadSprite(this, team, p.kind, id++, this.soldiers, this.marks, this.bv, 'reveal'), p, team });
    });
    // 自分の遊軍だけを、配置の画面と同じ場所の枠で見せる（相手の遊軍は届かないので出さない。design §7.8）
    const mine = reveal.myReserve;
    if (mine) {
      const r = deployReserveSlot(getLayout());
      drawBox(this.add.graphics(), r);
      addText(this, Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2), `${RESERVE_LABEL} ${KIND_LABEL[mine.kind]}`, 16, COLOR.cream).setOrigin(0.5, 0.5);
    }
    this.children.bringToTop(this.countBox);
    this.children.bringToTop(this.countText);
  }

  override update(): void {
    const reveal = client.reveal;
    if (!this.bv || !this.countText) return;
    // 盤の回転：毎コマ、時刻からカメラを決め、地面・木・兵・前後をやり直す
    const p = this.freeze ?? (reveal ? revealProgress(client.serverNow(), reveal.startsAt) : 0);
    this.bv.setCam(revealCam(this.dir, p, this.area, this.bv));
    this.ground?.update();
    this.forest?.update();
    const display = 1 - SHRINK * ease(p);
    const bounds = this.bv.uiBounds(this.area);
    const now = this.time.now;
    for (const q of this.squads) {
      // 自軍は上を、敵軍は下を向いて並ぶ（どちらの人にも自軍が下に見える）
      q.s.apply({ wx: q.p.col + 0.5, wy: q.p.row + 0.5, fx: 0, fy: q.team === 0 ? -1 : 1, menRatio: 1, rout: 0, highlight: false, bounds, display, time: now });
    }
    this.soldiers.sort('depth');
    if (!reveal) return;
    const left = Math.ceil((reveal.startsAt - client.serverNow()) / 1000);
    const text = left > 0 ? `開戦まで ${left}` : '開戦';
    if (this.countText.text === text) return;
    this.countText.setText(text);
    const a = this.area;
    const w = Math.ceil(this.countText.width / 2) * 2 + 40;
    const r = { x: Math.round((a.x + a.w / 2 - w / 2) / 2) * 2, y: Math.round(a.y + a.h / 2 - 28), w, h: 56 };
    this.countBox.clear();
    drawBox(this.countBox, r);
    this.countText.setPosition(Math.round(r.x + w / 2), Math.round(r.y + 28));
  }
}
