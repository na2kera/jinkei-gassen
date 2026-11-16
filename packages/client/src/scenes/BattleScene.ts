// 戦闘の画面。BattleSource から届く場面だけを描く（engine の状態は読まない。design §2、§5.2）。
// 向きが変わっても source と補間はそのままにして、表示物だけを組み直す（作り直すと戦いが最初に戻るため）。

import {
  DT,
  ORDER_KINDS,
  ORDER_TARGETS,
  type BattleEvent,
  type BattleSummary,
  type Field,
  type OrderKind,
  type OrderTarget,
  type Side,
  type UnitView,
} from '@jinkei/engine';
import Phaser from 'phaser';
import { drawField } from '../art/field.ts';
import { COLOR } from '../art/palette.ts';
import { UnitSprite } from '../art/UnitSprite.ts';
import type { BattleFrame, BattleSource } from '../battle/BattleSource.ts';
import { FieldView } from '../battle/FieldView.ts';
import { FrameInterpolator, type UnitSample } from '../battle/interp.ts';
import { debug, pushCapped } from '../debug.ts';
import { battlePanel, getLayout, LAYOUT_EVENT, type Rect } from '../layout.ts';
import { session } from '../session.ts';
import { Button } from '../ui/Button.ts';
import { ORDER_LABEL, TARGET_LABEL, wingForViewer } from '../ui/labels.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';

/**
 * 敗走してから消えるまでの刻み（assumptions S6 の5秒）。engine の数字は公開されていないので、絵のためだけにここで持つ。
 * ずれても、engine が 'gone' にした時点で絵は消えるので、散らばり方が少し変わるだけで済む。
 */
const ROUT_VANISH_TICKS = 50;
/** 号令の表示を出しておく長さ（ミリ秒） */
const ANNOUNCE_MS = 2000;
/** 決着してから結果の画面へ移るまで（ミリ秒） */
const END_DELAY_MS = 1500;

/**
 * 戦闘の画面に渡すもの。BattleSource を作るのは呼ぶ側（1人用は配置の画面、対戦は部屋の画面）。
 * viewer は見る側の陣営で、自軍かどうか・色・号令・上下の向きはすべてこれで決める。
 */
export interface BattleSceneData {
  source: BattleSource;
  field: Field;
  viewer: Side;
}

export class BattleScene extends Phaser.Scene {
  private source: BattleSource | null = null;
  private field!: Field;
  private viewer: Side = 0;
  private lastMarksLeft = -1;
  private interp = new FrameInterpolator();
  private speed = 1;
  private totalOrders = 3;
  private selectedTarget: OrderTarget | null = null;
  private routStart = new Map<number, number>();
  private announceQueue: { text: string; until: number }[] = [];
  private ended = false;
  private summary: BattleSummary | null = null;
  private inspect: { pointerId: number; unit: number } | null = null;

  // 表示物（向きが変わると作り直す）
  private fv!: FieldView;
  private root!: Phaser.GameObjects.Container;
  private sprites = new Map<number, UnitSprite>();
  private timeText!: Phaser.GameObjects.Text;
  private marks!: Phaser.GameObjects.Graphics;
  private markRects: Rect[] = [];
  private speedButton: Button | null = null;
  private targetButtons = new Map<OrderTarget, Button>();
  private orderButtons = new Map<OrderKind, Button>();
  private announceBox!: Phaser.GameObjects.Graphics;
  private announceText!: Phaser.GameObjects.Text;
  private infoBox!: Phaser.GameObjects.Graphics;
  private infoText!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

  init(data: Partial<BattleSceneData>): void {
    this.source = data.source ?? null;
    if (data.field) this.field = data.field;
    this.viewer = data.viewer ?? 0;
  }

  create(): void {
    debug.scene = 'Battle';
    debug.view = null;
    debug.frameTicks = [];
    debug.events = [];
    debug.announcements = [];
    this.interp = new FrameInterpolator();
    this.speed = 1;
    this.selectedTarget = null;
    this.routStart = new Map();
    this.announceQueue = [];
    this.ended = false;
    this.summary = null;
    this.inspect = null;

    const source = this.source;
    if (!source || !this.field) {
      // 開発中の読み込み直しなどで渡すものがないときは、配置の画面へ戻す
      this.scene.start('Deploy');
      return;
    }

    this.build();
    source.onFrame((f) => this.onFrame(f));
    source.onEnd((s) => this.onEnd(s));

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);

    const onLayout = (): void => this.rebuild();
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      this.source?.dispose();
      this.source = null;
      debug.order = null;
      debug.setSpeed = null;
    });
    debug.order = (t, k) => {
      if (!this.source || !this.source.canOrder(t, k)) return false;
      this.source.order(t, k);
      return true;
    };
    debug.setSpeed = (n) => this.setSpeed(n);
  }

  // ---- 表示物の組み立て ----

  private build(): void {
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    const field = this.field;
    // 陣営1の人が見るときは上下左右を返し、自軍がいつも下に映るようにする
    this.fv = new FieldView(layout.field, field.width, field.height, this.viewer === 1);
    this.root = this.add.container(0, 0);
    const bg = this.add.graphics();
    drawField(bg, this.fv, field);
    const soldierLayer = this.add.container(0, 0);
    const markLayer = this.add.container(0, 0);
    this.root.add([bg, soldierLayer, markLayer]);

    this.sprites = new Map();
    // 場面が届く前（最初の build）は部隊の絵を作らず、最初の場面が届いたときに作り直す
    const units = this.interp.latest?.view.units ?? [];
    for (const u of units) this.sprites.set(u.id, new UnitSprite(this, u.side === this.viewer ? 0 : 1, u.kind, soldierLayer, markLayer));

    const panel = battlePanel(layout);
    this.timeText = addText(this, panel.time.x, panel.time.y + Math.round((panel.time.h - 16) / 2) - 2, '');
    this.marks = this.add.graphics();
    this.markRects = panel.marks;
    this.root.add([this.timeText, this.marks]);
    this.lastMarksLeft = -1;
    // 早送りは、source が対応しているときだけ出す（対戦では出さない）
    this.speedButton = this.source?.setSpeed
      ? new Button(this, panel.speed, '', () => this.setSpeed(this.speed === 1 ? 2 : 1)).addTo(this.root)
      : null;
    this.targetButtons = new Map();
    ORDER_TARGETS.forEach((t, i) => {
      const r = panel.targets[i];
      if (!r) return;
      const b = new Button(this, r, TARGET_LABEL[t], () => {
        this.selectedTarget = this.selectedTarget === t ? null : t;
        this.refreshControls();
      }).addTo(this.root);
      this.targetButtons.set(t, b);
    });
    this.orderButtons = new Map();
    ORDER_KINDS.forEach((k, i) => {
      const r = panel.orders[i];
      if (!r) return;
      const b = new Button(this, r, ORDER_LABEL[k], () => this.giveOrder(k)).addTo(this.root);
      this.orderButtons.set(k, b);
    });

    this.announceBox = this.add.graphics();
    this.announceText = addText(this, 0, 0, '').setOrigin(0.5, 0.5);
    this.infoBox = this.add.graphics();
    this.infoText = addText(this, 0, 0, '');
    this.root.add([this.announceBox, this.announceText, this.infoBox, this.infoText]);

    this.refreshControls();
    this.render();
  }

  private rebuild(): void {
    if (!this.source) return;
    for (const s of this.sprites.values()) s.destroy();
    this.root.destroy();
    this.build();
  }

  // ---- 場面の受け取り ----

  private onFrame(frame: BattleFrame): void {
    const first = !this.interp.latest;
    this.interp.push(frame);
    if (first) {
      this.totalOrders = frame.view.ordersLeft[this.viewer];
      // build のときは場面がまだないので、ここで部隊の絵を作る
      this.rebuild();
    }
    debug.view = frame.view;
    pushCapped(debug.frameTicks, frame.tick, 400);
    for (const e of frame.events) this.onEvent(e);
    this.refreshControls();
  }

  private onEvent(e: BattleEvent): void {
    pushCapped(debug.events, `${e.tick}:${e.type}`, 200);
    if (e.type === 'order') {
      // 敵の翼は、見ている人から見た左右に直して出す（画面の左側にいる敵の翼なら「敵 左翼」）
      const target = wingForViewer(e.target, e.side, this.viewer);
      const who = e.side === this.viewer ? TARGET_LABEL[target] : `敵 ${TARGET_LABEL[target]}`;
      const text = `${who}、${ORDER_LABEL[e.kind]}`;
      this.announceQueue.push({ text, until: 0 });
      pushCapped(debug.announcements, text, 50);
    }
  }

  private onEnd(summary: BattleSummary): void {
    this.summary = summary;
    this.ended = true;
    this.selectedTarget = null;
    this.refreshControls();
    this.time.delayedCall(END_DELAY_MS, () => {
      const units = this.interp.latest?.view.units ?? [];
      session.result = { summary, viewer: this.viewer, units };
      debug.result = session.result;
      this.scene.start('Result');
    });
  }

  // ---- 操作 ----

  private setSpeed(n: number): void {
    this.speed = n;
    this.source?.setSpeed?.(n);
    this.refreshControls();
  }

  private giveOrder(kind: OrderKind): void {
    const t = this.selectedTarget;
    if (!t || !this.source || !this.source.canOrder(t, kind)) return;
    this.source.order(t, kind);
    this.selectedTarget = null;
    this.refreshControls();
  }

  /** 部隊を押している間だけ、その部隊の兵数と士気を出す */
  private onDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.inspect || over.length > 0 || !this.fv.contains(pointer.x, pointer.y)) return;
    let best: { id: number; d: number } | null = null;
    for (const s of this.interp.sample()) {
      if (s.view.status === 'gone') continue;
      const p = this.fv.toScreen(s.x, s.y);
      const d = Math.hypot(p.x - pointer.x, p.y - pointer.y);
      if (d <= 14 && (!best || d < best.d)) best = { id: s.view.id, d };
    }
    if (best) this.inspect = { pointerId: pointer.id, unit: best.id };
  }

  /** 指を離したときも、タッチがキャンセルされたとき（Phaser は up として届ける）も、数字を消す */
  private onUp(pointer: Phaser.Input.Pointer): void {
    if (this.inspect && this.inspect.pointerId === pointer.id) this.inspect = null;
  }

  private refreshControls(): void {
    // まだ build していない（場面が届く前）ときは何もしない
    if (this.targetButtons.size === 0) return;
    this.speedButton?.setText(`${this.speed}倍`).setEnabled(!this.ended);
    const src = this.source;
    for (const [t, b] of this.targetButtons) {
      // 相手は、どれかの号令がかかるときだけ選べる
      const any = !this.ended && !!src && ORDER_KINDS.some((k) => src.canOrder(t, k));
      b.setEnabled(any).setSelected(this.selectedTarget === t);
      if (!any && this.selectedTarget === t) this.selectedTarget = null;
    }
    for (const [k, b] of this.orderButtons) {
      const t = this.selectedTarget;
      b.setEnabled(!this.ended && !!src && !!t && src.canOrder(t, k));
    }
  }

  // ---- 描画 ----

  override update(_time: number, delta: number): void {
    if (!this.source && !this.summary) return;
    this.interp.advance(delta, this.speed);
    this.render();
  }

  private render(): void {
    const frame = this.interp.latest;
    if (!frame || !this.fv) return;
    const tick = this.interp.tick;
    const samples = this.interp.sample();
    let inspected: UnitSample | null = null;
    for (const s of samples) {
      const sprite = this.sprites.get(s.view.id);
      if (!sprite) continue;
      const u = s.view;
      if (u.status === 'gone') {
        sprite.hide();
        continue;
      }
      let rout = 0;
      if (u.status === 'routing') {
        if (!this.routStart.has(u.id)) this.routStart.set(u.id, frame.tick);
        rout = Math.max(0.01, Math.min(1, (tick - (this.routStart.get(u.id) ?? tick)) / ROUT_VANISH_TICKS));
      }
      const p = this.fv.toScreen(s.x, s.y);
      const d = this.fv.dirToScreen(s.fx, s.fy);
      const highlight = this.isTargeted(u);
      sprite.apply({ x: p.x, y: p.y, dx: d.x, dy: d.y, menRatio: u.men / u.maxMen, morale: u.morale, rout, highlight });
      if (this.inspect?.unit === u.id) inspected = s;
    }
    this.drawTime(frame);
    this.drawMarks(frame);
    this.drawAnnounce();
    this.drawInfo(inspected);
  }

  private isTargeted(u: UnitView): boolean {
    const t = this.selectedTarget;
    if (!t || u.side !== this.viewer || u.status !== 'active') return false;
    return t === 'all' || u.wing === t;
  }

  private drawTime(frame: BattleFrame): void {
    const left = Math.max(0, Math.ceil(((frame.view.maxTicks - frame.view.tick) * DT) - 1e-9));
    const m = Math.floor(left / 60);
    const s = left % 60;
    this.timeText.setText(`${m}:${String(s).padStart(2, '0')}`);
  }

  private drawMarks(frame: BattleFrame): void {
    const left = frame.view.ordersLeft[this.viewer];
    // 回数が変わったときだけ描き直す
    if (left === this.lastMarksLeft) return;
    this.lastMarksLeft = left;
    const g = this.marks;
    g.clear();
    this.markRects.slice(0, this.totalOrders).forEach((r, i) => {
      // 残っている回数は塗りつぶし、使った分は枠だけ
      g.fillStyle(COLOR.border, 1);
      g.fillRect(r.x, r.y, r.w, r.h);
      if (i >= left) {
        g.fillStyle(COLOR.bg, 1);
        g.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      }
    });
  }

  private drawAnnounce(): void {
    const now = this.time.now;
    while (this.announceQueue.length > 0 && this.announceQueue[0]!.until !== 0 && this.announceQueue[0]!.until <= now) {
      this.announceQueue.shift();
    }
    const cur = this.announceQueue[0];
    this.announceBox.clear();
    if (!cur) {
      this.announceText.setVisible(false);
      return;
    }
    if (cur.until === 0) cur.until = now + ANNOUNCE_MS;
    const f = this.fv.rect;
    const w = Math.ceil(this.announceText.setText(cur.text).width / 2) * 2 + 24;
    const r = { x: Math.round(f.x + f.w / 2 - w / 2), y: f.y + f.h / 2 - 20, w, h: 32 };
    drawBox(this.announceBox, r);
    this.announceText.setPosition(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)).setVisible(true);
  }

  private drawInfo(s: UnitSample | null): void {
    this.infoBox.clear();
    if (!s) {
      this.infoText.setVisible(false);
      return;
    }
    const u = s.view;
    this.infoText.setText(`兵 ${Math.ceil(u.men)}\n士気 ${Math.round(u.morale)}`);
    const w = Math.ceil(this.infoText.width / 2) * 2 + 12;
    const h = Math.ceil(this.infoText.height / 2) * 2 + 8;
    const f = this.fv.rect;
    const p = this.fv.toScreen(s.x, s.y);
    // 指で隠れないよう部隊の上に出し、戦場の中に収める
    const x = Math.round(Math.max(f.x, Math.min(f.x + f.w - w, p.x - w / 2)));
    const y = Math.round(p.y - 20 - h >= f.y ? p.y - 20 - h : p.y + 20);
    drawBox(this.infoBox, { x, y, w, h });
    this.infoText.setPosition(x + 6, y + 4).setVisible(true);
  }
}
