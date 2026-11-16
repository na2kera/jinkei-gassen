// 戦闘の画面。BattleSource から届く場面と出来事だけを描く（engine の状態は読まない。design §2、§5.2）。
// 向きが変わっても source と補間はそのままにして、表示物だけを組み直す（作り直すと戦いが最初に戻るため）。
// 演出（火花・矢・突入・敗走・全滅・号令の旗）も、場面と出来事から見た目だけを作る。場面の値は変えない。

import {
  DT,
  MAX_ORDERS,
  ORDER_KINDS,
  ROUT_TICKS,
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
import { Effects } from '../art/effects.ts';
import { GateSprite } from '../art/GateSprite.ts';
import { FOG_KEY } from '../art/textures.ts';
import { addFieldImage, drawFieldFrame } from '../art/field.ts';
import { drawDrum, drawSurviveIcon } from '../art/icons.ts';
import { COLOR, css } from '../art/palette.ts';
import { UnitSprite } from '../art/UnitSprite.ts';
import {
  playArrow,
  playClash,
  playDraw,
  playFogClear,
  playGateBreak,
  playImpact,
  playLose,
  playOrderDrum,
  playRout,
  playWin,
} from '../audio/sfx.ts';
import type { BattleFrame, BattleSource } from '../battle/BattleSource.ts';
import { centeredFieldView, FieldView } from '../battle/FieldView.ts';
import { FrameInterpolator, type UnitSample } from '../battle/interp.ts';
import { debug, pushCapped } from '../debug.ts';
import { battlePanel, CELL, getLayout, LAYOUT_EVENT, type Rect } from '../layout.ts';
import { pvp } from '../net/pvp.ts';
import { session } from '../session.ts';
import { Button } from '../ui/Button.ts';
import { ORDER_LABEL, TARGET_LABEL, wingForViewer } from '../ui/labels.ts';
import { addMuteButton } from '../ui/mute.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';

/** 号令の表示を出しておく長さ（ミリ秒） */
const ANNOUNCE_MS = 2000;
/** 号令がかかった部隊の旗がはためく長さ（ミリ秒） */
const WAVE_MS = 900;
/** 決着の表示を出してから結果の画面へ移るまで（ミリ秒） */
const END_DELAY_MS = 2200;
/** これより遠い相手への攻撃は弓とみなし、矢を飛ばす（マス）。engine の近接の距離 1.05（design §3.5）に少し余裕を足す */
const MELEE_DIST = 1.3;
/** 門を攻めるときの近接の距離（engine は 1.6。少し余裕を足す） */
const GATE_MELEE_DIST = 1.7;
/** 「やめる」を2回押すまでの猶予（ミリ秒）。押し間違いで戦いが消えないよう、1回目は確かめるだけにする */
const QUIT_ARM_MS = 2500;

/**
 * 戦闘の画面に渡すもの。BattleSource を作るのは呼ぶ側（1人用は配置の画面、対戦は部屋の画面）。
 * viewer は見る側の陣営で、自軍かどうか・色・号令・上下の向きはすべてこれで決める。
 */
export interface BattleSceneData {
  source: BattleSource;
  field: Field;
  viewer: Side;
  /** 号令の欄を出すか（第1章の前半の面は出さない） */
  orders: boolean;
  /**
   * 「やめる」を確かめたあとに呼ぶ（1人用は配置の画面へ、対戦は部屋を出る）。
   * 呼ぶ側のシーンはもう止まっているので、戦闘の画面自身を渡して、そこから次の画面を始めてもらう。
   */
  onQuit: (battle: Phaser.Scene) => void;
  /** 「やめる」のボタンの文字（対戦では「出る」） */
  quitLabel?: string;
  /** 決着の表示を出し終えたら呼ぶ。省略すると結果の画面（Result）へ移る */
  onFinished?: (battle: Phaser.Scene) => void;
  /**
   * 戦場を上下左右に返して描くか。省略すると viewer が 1 のとき返す（1人用で陣営1から見るとき）。
   * 対戦の場面はサーバーが「自分が下」に返し済みなので false を渡す（二重に返さない）。
   */
  flip?: boolean;
  /** 結果の画面に渡す面の id（対戦では空） */
  stageId: string;
  /** 配置中に霧で隠していたマス。開戦の瞬間に晴れる演出を出す */
  fog?: { col: number; row: number }[];
  /** 時間切れまで守り切れば勝ちの面（win が survive）。残り時間の所に小さな印を付ける */
  survive?: boolean;
}

export class BattleScene extends Phaser.Scene {
  private source: BattleSource | null = null;
  private field!: Field;
  private viewer: Side = 0;
  private lastMarksLeft = -1;
  private interp = new FrameInterpolator();
  private speed = 1;
  private totalOrders = MAX_ORDERS;
  private ordersShown = true;
  private onQuit: BattleSceneData['onQuit'] = (b) => b.scene.start('Deploy');
  private quitLabel = 'やめる';
  private onFinished: BattleSceneData['onFinished'] | null = null;
  private flip = false;
  private fog: { col: number; row: number }[] = [];
  private fogCleared = false;
  private survive = false;
  private gateSprite: GateSprite | null = null;
  private gateLayer!: Phaser.GameObjects.Container;
  private fogLayer!: Phaser.GameObjects.Container;
  private stageId = '';
  private quitArmedUntil = 0;
  private quitButton: Button | null = null;
  private selectedTarget: OrderTarget | null = null;
  private routStart = new Map<number, number>();
  private announceQueue: { text: string; until: number }[] = [];
  /** 描く刻みが追いつくまで待っている出来事（場面より先に届くので、絵と合わせて出す） */
  private pendingEvents: BattleEvent[] = [];
  private waveUntil = new Map<number, number>();
  private nextShot = new Map<number, number>();
  private nextSpark = new Map<number, number>();
  private readonly byId = new Map<number, UnitSample>();
  private ended = false;
  private endShownAt = 0;
  private summary: BattleSummary | null = null;
  private inspect: { pointerId: number; unit: number } | null = null;

  // 表示物（向きが変わると作り直す）
  private fv!: FieldView;
  private root!: Phaser.GameObjects.Container;
  private effects: Effects | null = null;
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
  private endBox!: Phaser.GameObjects.Graphics;
  private endText!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

  init(data: Partial<BattleSceneData>): void {
    this.source = data.source ?? null;
    if (data.field) this.field = data.field;
    this.viewer = data.viewer ?? 0;
    this.ordersShown = data.orders ?? true;
    this.onQuit = data.onQuit ?? ((b) => b.scene.start('Deploy'));
    this.quitLabel = data.quitLabel ?? 'やめる';
    this.onFinished = data.onFinished ?? null;
    this.flip = data.flip ?? this.viewer === 1;
    this.fog = data.fog ?? [];
    this.fogCleared = this.fog.length === 0;
    this.survive = data.survive ?? false;
    this.stageId = data.stageId ?? '';
  }

  create(): void {
    debug.scene = 'Battle';
    // 対戦で pvp.ts が予約した画面が始まったことを知らせる（1人用では何もしない）
    pvp.arrived('Battle');
    debug.view = null;
    debug.frameTicks = [];
    debug.events = [];
    debug.announcements = [];
    this.interp = new FrameInterpolator();
    this.speed = 1;
    this.selectedTarget = null;
    this.routStart = new Map();
    this.announceQueue = [];
    this.pendingEvents = [];
    this.waveUntil = new Map();
    this.nextShot = new Map();
    this.nextSpark = new Map();
    this.ended = false;
    this.endShownAt = 0;
    this.summary = null;
    this.inspect = null;
    this.sprites = new Map();
    this.targetButtons = new Map();
    this.orderButtons = new Map();

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
    this.fv = centeredFieldView(layout.field, field, this.flip);
    this.root = this.add.container(0, 0);
    const frame = this.add.graphics();
    drawFieldFrame(frame, this.fv, layout.field);
    const bg = addFieldImage(this, this.fv, field, layout.field);
    const soldierLayer = this.add.container(0, 0);
    const effectLayer = this.add.container(0, 0);
    const markLayer = this.add.container(0, 0);
    this.gateLayer = this.add.container(0, 0);
    this.fogLayer = this.add.container(0, 0);
    this.root.add([frame, bg, this.gateLayer, soldierLayer, effectLayer, this.fogLayer, markLayer]);
    this.buildGate();
    this.buildFog();
    this.effects = new Effects(this, effectLayer);

    this.sprites = new Map();
    // 場面が届く前（最初の build）は部隊の絵を作らず、最初の場面が届いたときに作り直す
    const units = this.interp.latest?.view.units ?? [];
    for (const u of units) {
      this.sprites.set(u.id, new UnitSprite(this, u.side === this.viewer ? 0 : 1, u.kind, u.id, soldierLayer, markLayer));
    }

    const panel = battlePanel(layout);
    this.timeText = addText(this, panel.time.x, panel.time.y + Math.round((panel.time.h - 16) / 2) - 2, '');
    if (this.survive) {
      // 守り切れば勝ちの面：残り時間の左に盾の印を付け、時間の文字を金にしてずらす
      const icon = this.add.graphics();
      drawSurviveIcon(icon, panel.time.x, Math.round(panel.time.y + panel.time.h / 2 - 5));
      this.root.add(icon);
      this.timeText.setX(panel.time.x + 12).setColor(css(COLOR.goldHi));
    }
    this.marks = this.add.graphics();
    this.markRects = panel.marks;
    this.root.add([this.timeText, this.marks]);
    this.lastMarksLeft = -1;
    addMuteButton(this, panel.mute).addTo(this.root);
    // 早送りは、source が対応しているときだけ出す（対戦では出さない）
    this.speedButton = this.source?.setSpeed
      ? new Button(this, panel.speed, '', () => this.setSpeed(this.speed === 1 ? 2 : 1)).addTo(this.root)
      : null;
    // やめる：1回目は「やめる？」に変わるだけで、猶予のうちにもう一度押すと抜ける
    this.quitButton = new Button(this, panel.quit, this.quitLabel, () => this.pressQuit()).addTo(this.root);
    this.targetButtons = new Map();
    this.orderButtons = new Map();
    // 号令を教える前の面では、号令の欄を出さない
    if (this.ordersShown) this.buildOrders(panel);

    this.announceBox = this.add.graphics();
    this.announceText = addText(this, 0, 0, '').setOrigin(0, 0.5);
    this.infoBox = this.add.graphics();
    this.infoText = addText(this, 0, 0, '');
    this.endBox = this.add.graphics();
    this.endText = addText(this, 0, 0, '', 32).setOrigin(0.5, 0.5).setVisible(false);
    this.root.add([this.announceBox, this.announceText, this.infoBox, this.infoText, this.endBox, this.endText]);

    this.refreshControls();
    this.render();
  }

  private buildOrders(panel: ReturnType<typeof battlePanel>): void {
    ORDER_TARGETS.forEach((t, i) => {
      const r = panel.targets[i];
      if (!r) return;
      const b = new Button(this, r, TARGET_LABEL[t], () => {
        this.selectedTarget = this.selectedTarget === t ? null : t;
        this.refreshControls();
      }).addTo(this.root);
      this.targetButtons.set(t, b);
    });
    ORDER_KINDS.forEach((k, i) => {
      const r = panel.orders[i];
      if (!r) return;
      const b = new Button(this, r, ORDER_LABEL[k], () => this.giveOrder(k)).addTo(this.root);
      this.orderButtons.set(k, b);
    });
  }

  private pressQuit(): void {
    const now = this.time.now;
    if (now < this.quitArmedUntil) {
      this.onQuit(this);
      return;
    }
    this.quitArmedUntil = now + QUIT_ARM_MS;
    this.quitButton?.setText(`${this.quitLabel}？`).setSelected(true);
    this.time.delayedCall(QUIT_ARM_MS, () => {
      if (this.time.now >= this.quitArmedUntil) this.quitButton?.setText(this.quitLabel).setSelected(false);
    });
  }

  private rebuild(): void {
    this.gateSprite?.destroy();
    this.gateSprite = null;
    if (!this.source && !this.summary) return;
    for (const s of this.sprites.values()) s.destroy();
    this.effects?.destroy();
    this.effects = null;
    this.root.destroy();
    this.build();
    if (this.endShownAt > 0) this.drawEnd();
  }

  // ---- 場面の受け取り ----

  private onFrame(frame: BattleFrame): void {
    const first = !this.interp.latest;
    this.interp.push(frame);
    if (first) {
      this.totalOrders = MAX_ORDERS;
      // build のときは場面がまだないので、ここで部隊の絵を作る
      this.rebuild();
    }
    debug.view = frame.view;
    pushCapped(debug.frameTicks, frame.tick, 400);
    for (const e of frame.events) {
      pushCapped(debug.events, `${e.tick}:${e.type}`, 200);
      this.pendingEvents.push(e);
    }
    this.refreshControls();
  }

  /** 描く刻みが出来事の刻みに追いついたら、演出と音を出す */
  private flushEvents(samples: UnitSample[], now: number): void {
    if (this.pendingEvents.length === 0) return;
    const tick = this.interp.tick;
    const due = this.pendingEvents.filter((e) => e.tick <= tick + 1);
    if (due.length === 0) return;
    this.pendingEvents = this.pendingEvents.filter((e) => e.tick > tick + 1);
    const at = (id: number): { x: number; y: number } | null => {
      const s = samples.find((v) => v.view.id === id);
      return s ? this.fv.toScreen(s.x, s.y) : null;
    };
    for (const e of due) {
      switch (e.type) {
        case 'order': {
          // 敵の翼は、見ている人から見た左右に直して出す（画面の左側にいる敵の翼なら「敵 左翼」）
          const target = wingForViewer(e.target, e.side, this.viewer);
          const enemy = e.side !== this.viewer;
          const text = `${enemy ? `敵 ${TARGET_LABEL[target]}` : TARGET_LABEL[target]}、${ORDER_LABEL[e.kind]}`;
          this.announceQueue.push({ text, until: 0 });
          pushCapped(debug.announcements, text, 50);
          playOrderDrum(enemy);
          // 号令がかかった部隊の旗を少しのあいだはためかせる
          for (const s of samples) {
            const u = s.view;
            if (u.side !== e.side || u.status !== 'active') continue;
            if (e.target !== 'all' && u.wing !== e.target) continue;
            if (e.kind === 'charge' && u.kind === 'hq') continue;
            this.waveUntil.set(u.id, now + WAVE_MS);
          }
          break;
        }
        case 'impact': {
          const p = at(e.defender);
          if (p) this.effects?.impact(p.x, p.y, now);
          playImpact();
          break;
        }
        case 'rout': {
          const p = at(e.unit);
          if (p) this.effects?.dust(p.x, p.y, now, 4);
          playRout();
          break;
        }
        case 'destroyed': {
          // その場に倒れた兵を残す（部隊の絵はこのあと消える）
          const sprite = this.sprites.get(e.unit);
          const s = samples.find((v) => v.view.id === e.unit);
          if (sprite && s) this.effects?.fall(sprite.soldierCenters(), s.view.side === this.viewer ? 0 : 1, now);
          playRout();
          break;
        }
        case 'end':
          break;
      }
    }
  }

  private onEnd(summary: BattleSummary): void {
    this.summary = summary;
    this.ended = true;
    this.selectedTarget = null;
    this.refreshControls();
  }

  /** 決着の表示。描く刻みが決着に追いついてから出し、少し間を置いて結果の画面へ */
  private showEnd(now: number): void {
    const s = this.summary;
    if (!s || this.endShownAt > 0) return;
    this.endShownAt = now;
    this.drawEnd();
    if (s.winner === 'draw') playDraw();
    else if (s.winner === this.viewer) playWin();
    else playLose();
    this.time.delayedCall(END_DELAY_MS, () => {
      const units = this.interp.latest?.view.units ?? [];
      session.result = { stageId: this.stageId, summary: s, viewer: this.viewer, units };
      debug.result = session.result;
      if (this.onFinished) this.onFinished(this);
      else this.scene.start('Result');
    });
  }

  private drawEnd(): void {
    const s = this.summary;
    if (!s) return;
    const text = s.winner === 'draw' ? '引き分け' : s.winner === this.viewer ? '勝ち' : '負け';
    this.endText.setText(text);
    const f = this.fv.rect;
    const w = Math.ceil(this.endText.width / 2) * 2 + 48;
    const r = { x: Math.round((f.x + f.w / 2 - w / 2) / 2) * 2, y: f.y + f.h / 2 - 28, w, h: 56 };
    this.endBox.clear();
    drawBox(this.endBox, r);
    this.endText.setPosition(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)).setVisible(true);
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
      if (d <= 12 && (!best || d < best.d)) best = { id: s.view.id, d };
    }
    if (best) this.inspect = { pointerId: pointer.id, unit: best.id };
  }

  /** 指を離したときも、タッチがキャンセルされたとき（Phaser は up として届ける）も、数字を消す */
  private onUp(pointer: Phaser.Input.Pointer): void {
    if (this.inspect && this.inspect.pointerId === pointer.id) this.inspect = null;
  }

  private refreshControls(): void {
    // まだ build していないときは何もしない
    if (!this.root) return;
    this.quitButton?.setEnabled(!this.ended);
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
    const now = this.time.now;
    const tick = this.interp.tick;
    const samples = this.interp.sample();
    this.flushEvents(samples, now);
    const fighting = this.findFights(samples, now);
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
        rout = Math.max(0.01, Math.min(1, (tick - (this.routStart.get(u.id) ?? tick)) / ROUT_TICKS));
      }
      const p = this.fv.toScreen(s.x, s.y);
      const d = this.fv.dirToScreen(s.fx, s.fy);
      sprite.apply({
        x: p.x,
        y: p.y,
        dx: d.x,
        dy: d.y,
        menRatio: u.men / u.maxMen,
        morale: u.morale,
        rout,
        highlight: this.isTargeted(u),
        moving: s.moving,
        fighting: fighting.has(u.id),
        time: now,
        order: u.status === 'active' ? u.order : null,
        wave: (this.waveUntil.get(u.id) ?? 0) > now,
        bounds: this.fv.rect,
      });
      if (this.inspect?.unit === u.id) inspected = s;
    }
    this.shootArrows(samples, now);
    this.updateGate(now);
    this.effects?.update(now);
    this.drawTime(frame);
    this.drawMarks(frame);
    this.drawAnnounce(now);
    this.drawInfo(inspected);
    if (this.summary && this.interp.caughtUp) this.showEnd(now);
  }

  /**
   * 場面の attacking（その刻みに実際に攻撃した相手）から、近接で戦っている部隊を探し、ぶつかる所に火花と土煙を出す。
   * 相手が近接の距離にいる攻撃を近接とみなす（遠い相手への攻撃は弓なので、shootArrows で矢を飛ばす）。
   * 攻撃した側と、された側の両方を「戦っている」として、前列を突く動きを付ける。
   */
  private findFights(samples: UnitSample[], now: number): Set<number> {
    const fighting = new Set<number>();
    const byId = this.sampleIndex(samples);
    const gate = this.interp.latest?.view.gate;
    for (const a of samples) {
      const target = a.view.attacking;
      if (target === null || a.view.status !== 'active') continue;
      // 門を攻めているときは、門の位置を相手にする（門は units に入っていない。少し離れた所からも攻められる）
      const unit = byId.get(target);
      const isGate = !unit && !!gate && gate.id === target;
      const b = unit ?? (isGate && gate ? { x: gate.x, y: gate.y, view: { id: gate.id } } : null);
      if (!b || Math.hypot(a.x - b.x, a.y - b.y) > (isGate ? GATE_MELEE_DIST : MELEE_DIST)) continue;
      fighting.add(a.view.id);
      if (unit) fighting.add(unit.view.id);
      if (this.ended) continue;
      const key = Math.min(a.view.id, b.view.id) * 1000 + Math.max(a.view.id, b.view.id);
      if (now < (this.nextSpark.get(key) ?? 0)) continue;
      this.nextSpark.set(key, now + (350 + Math.random() * 500) / this.speed);
      const pa = this.fv.toScreen(a.x, a.y);
      const pb = this.fv.toScreen(b.x, b.y);
      const mx = (pa.x + pb.x) / 2 + (Math.random() - 0.5) * 8;
      const my = (pa.y + pb.y) / 2 + (Math.random() - 0.5) * 8;
      if (Math.random() < 0.6) this.effects?.spark(mx, my, now);
      else this.effects?.dust(mx, my, now);
      playClash();
    }
    return fighting;
  }

  private sampleIndex(samples: UnitSample[]): Map<number, UnitSample> {
    this.byId.clear();
    for (const s of samples) this.byId.set(s.view.id, s);
    return this.byId;
  }

  /** 場面の attacking が近接の距離より遠い部隊（弓兵）から、その相手へ矢を飛ばす */
  private shootArrows(samples: UnitSample[], now: number): void {
    if (this.ended) return;
    const byId = this.byId;
    for (const s of samples) {
      const u = s.view;
      const target = u.attacking;
      if (target === null || u.status !== 'active') continue;
      const t = byId.get(target);
      if (!t) continue;
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      if (d <= MELEE_DIST) continue;
      if (now < (this.nextShot.get(u.id) ?? 0)) continue;
      this.nextShot.set(u.id, now + (700 + Math.random() * 300) / this.speed);
      pushCapped(debug.arrows, [u.id, target], 50);
      const from = this.fv.toScreen(s.x, s.y);
      const to = this.fv.toScreen(t.x, t.y);
      const life = Math.max(160, Math.min(420, d * CELL * 3)) / this.speed;
      for (let i = 0; i < 2; i++) {
        const j = (): number => (Math.random() - 0.5) * 10;
        this.effects?.arrow(from.x + j(), from.y + j(), to.x + j(), to.y + j(), now + i * 60, life);
      }
      playArrow();
    }
  }

  private isTargeted(u: UnitView): boolean {
    const t = this.selectedTarget;
    if (!t || u.side !== this.viewer || u.status !== 'active') return false;
    return t === 'all' || u.wing === t;
  }

  private drawTime(frame: BattleFrame): void {
    const left = Math.max(0, Math.ceil((frame.view.maxTicks - frame.view.tick) * DT - 1e-9));
    const m = Math.floor(left / 60);
    const s = left % 60;
    this.timeText.setText(`${m}:${String(s).padStart(2, '0')}`);
  }

  private drawMarks(frame: BattleFrame): void {
    if (!this.ordersShown) return;
    const left = frame.view.ordersLeft[this.viewer];
    // 回数が変わったときだけ描き直す
    if (left === this.lastMarksLeft) return;
    this.lastMarksLeft = left;
    const g = this.marks;
    g.clear();
    this.markRects.slice(0, this.totalOrders).forEach((r, i) => {
      // 残っている回数は金の塗り、使った分は暗い枠だけ
      g.fillStyle(COLOR.outline, 1);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.fillStyle(i < left ? COLOR.gold : COLOR.dim, 1);
      g.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      if (i >= left) {
        g.fillStyle(COLOR.panel, 1);
        g.fillRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
      }
    });
  }

  private drawAnnounce(now: number): void {
    while (this.announceQueue.length > 0 && this.announceQueue[0]!.until !== 0 && this.announceQueue[0]!.until <= now) {
      this.announceQueue.shift();
    }
    const cur = this.endShownAt > 0 ? undefined : this.announceQueue[0];
    this.announceBox.clear();
    if (!cur) {
      this.announceText.setVisible(false);
      return;
    }
    if (cur.until === 0) cur.until = now + ANNOUNCE_MS;
    const f = this.fv.rect;
    if (this.announceText.text !== cur.text) this.announceText.setText(cur.text);
    // 太鼓の絵（12px）+ 間 + 文字
    const w = Math.ceil(this.announceText.width / 2) * 2 + 12 + 6 + 24;
    const r = { x: Math.round((f.x + f.w / 2 - w / 2) / 2) * 2, y: f.y + 8, w, h: 32 };
    drawBox(this.announceBox, r);
    drawDrum(this.announceBox, r.x + 12, r.y + 11);
    this.announceText.setPosition(r.x + 12 + 12 + 6, Math.round(r.y + r.h / 2)).setVisible(true);
  }

  private drawInfo(s: UnitSample | null): void {
    this.infoBox.clear();
    if (!s) {
      this.infoText.setVisible(false);
      return;
    }
    const u = s.view;
    const text = `兵 ${Math.ceil(u.men)}\n士気 ${Math.round(u.morale)}`;
    if (this.infoText.text !== text) this.infoText.setText(text);
    const w = Math.ceil(this.infoText.width / 2) * 2 + 16;
    const h = Math.ceil(this.infoText.height / 2) * 2 + 12;
    const f = this.fv.rect;
    const p = this.fv.toScreen(s.x, s.y);
    // 指で隠れないよう部隊の上に出し、戦場の中に収める
    const x = Math.round(Math.max(f.x, Math.min(f.x + f.w - w, p.x - w / 2)) / 2) * 2;
    const y = Math.round((p.y - 20 - h >= f.y ? p.y - 20 - h : p.y + 20) / 2) * 2;
    drawBox(this.infoBox, { x, y, w, h });
    this.infoText.setPosition(x + 8, y + 6).setVisible(true);
  }
  // ---- 門と霧 ----

  /** 場面に門があれば、門の絵を置く（すでに破れていれば、瓦礫から始める） */
  private buildGate(): void {
    const g = this.interp.latest?.view.gate;
    if (!g) return;
    this.gateSprite = new GateSprite(this, this.fv, this.field, g.col, g.row, this.gateLayer);
    this.gateSprite.setHealth(g.men / g.maxMen);
    if (g.status === 'gone') this.gateSprite.breakOpen();
  }

  /** 門の壊れ具合を場面に合わせる。破れた瞬間だけ、崩れる演出と音を出す */
  private updateGate(now: number): void {
    const g = this.interp.latest?.view.gate;
    if (!g) return;
    if (!this.gateSprite) {
      this.buildGate();
      return;
    }
    this.gateSprite.setHealth(g.men / g.maxMen);
    if (g.status === 'gone' && !this.gateSprite.isBroken) {
      for (const c of this.gateSprite.breakOpen()) this.effects?.impact(c.x, c.y, now);
      playGateBreak();
    }
  }

  /** 配置中に霧で隠していたマスを、開戦の瞬間だけ霧の絵で覆う */
  private buildFog(): void {
    if (this.fogCleared) return;
    const imgs = this.fog.map((c) => {
      const r = this.fv.cellRect(c.col, c.row);
      const img = this.add.image(r.x, r.y, FOG_KEY).setOrigin(0, 0);
      this.fogLayer.add(img);
      return img;
    });
    // 晴れる演出：4回に分けて、霧のマスを少しずつ消す（なめらかに薄くせず、ドットらしく段で消す）
    this.fogCleared = true;
    playFogClear();
    const order = imgs.map((img, i) => ({ img, k: (i * 7) % 4 }));
    for (let step = 0; step < 4; step++) {
      this.time.delayedCall(150 + step * 150, () => {
        for (const o of order) if (o.k === step) o.img.destroy();
      });
    }
  }
}
