// 配置の画面（design §5.1）。
// 手持ちを選んでマスを押すと置く／置いた部隊を引きずると動く／ほかの部隊の上に落とすと入れ替わる／
// 置いた部隊を押すと、方針の切り替え（その兵種で選べるものだけ）と「外す」が出る。
// 配置は session に持ち、このシーンは向きが変わると作り直す。

import {
  applyTemplate,
  defaultStance,
  listTemplates,
  STANCES,
  stanceAllowed,
  type Kind,
  type Placement,
  type Side,
  type Stance,
  type TemplateId,
} from '@jinkei/engine';
import Phaser from 'phaser';
import { addFieldImage, drawFieldFrame, drawZone } from '../art/field.ts';
import { COLOR } from '../art/palette.ts';
import { playPlace, playRemove, playStance, playStart } from '../audio/sfx.ts';
import { UnitSprite } from '../art/UnitSprite.ts';
import { FieldView, type Cell } from '../battle/FieldView.ts';
import { debug } from '../debug.ts';
import { CELL, deployPanel, getLayout, LAYOUT_EVENT, type Rect } from '../layout.ts';
import { LocalBattleSource } from '../battle/LocalBattleSource.ts';
import { armyErrors, battleSetup, ROSTER, session } from '../session.ts';
import type { BattleSceneData } from './BattleScene.ts';
import { Button } from '../ui/Button.ts';
import { KIND_LABEL, ROSTER_ORDER, STANCE_LABEL } from '../ui/labels.ts';
import { addMuteButton } from '../ui/mute.ts';

/** これ以上動いたら「押した」ではなく「引きずった」とみなす（px） */
const DRAG_THRESHOLD = 6;

interface Press {
  pointerId: number;
  index: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

export class DeployScene extends Phaser.Scene {
  private fv!: FieldView;
  private soldierLayer!: Phaser.GameObjects.Container;
  private markLayer!: Phaser.GameObjects.Container;
  private popupLayer!: Phaser.GameObjects.Container;
  private dropMark!: Phaser.GameObjects.Graphics;
  private ownSprites: UnitSprite[] = [];
  private rosterButtons = new Map<Kind, Button>();
  private startButton!: Button;
  private popupButtons: Button[] = [];
  private popupIndex: number | null = null;
  private selectedKind: Kind | null = null;
  private press: Press | null = null;

  constructor() {
    super('Deploy');
  }

  create(): void {
    debug.scene = 'Deploy';
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    this.ownSprites = [];
    this.rosterButtons = new Map();
    this.popupButtons = [];
    this.popupIndex = null;
    this.selectedKind = null;
    this.press = null;

    const field = session.field;
    this.fv = new FieldView(layout.field, field.width, field.height);
    drawFieldFrame(this.add.graphics(), this.fv);
    addFieldImage(this, this.fv, field);
    // 配置エリアは配置の画面だけで見せる。自軍は明るい金、敵軍は暗い色
    const zones = this.add.graphics();
    drawZone(zones, this.fv, field.zones[0], COLOR.gold);
    drawZone(zones, this.fv, field.zones[1], COLOR.dim);
    this.soldierLayer = this.add.container(0, 0);
    this.markLayer = this.add.container(0, 0);
    this.dropMark = this.add.graphics();
    this.popupLayer = this.add.container(0, 0);

    // 敵の配置は見せる（方針は見せない。decisions §8）
    session.enemy.forEach((p, i) => {
      const s = new UnitSprite(this, 1, p.kind, 100 + i, this.soldierLayer, this.markLayer);
      const c = this.fv.cellCenter(p.col, p.row);
      const d = this.fv.dirToScreen(0, 1);
      s.apply({ x: c.x, y: c.y, dx: d.x, dy: d.y, menRatio: 1, morale: 100, rout: 0, highlight: false, bounds: this.fv.rect });
    });

    const panel = deployPanel(layout);
    ROSTER_ORDER.forEach((kind, i) => {
      const r = panel.roster[i];
      if (!r) return;
      this.rosterButtons.set(kind, new Button(this, r, KIND_LABEL[kind], () => this.selectKind(kind)));
    });
    listTemplates().forEach((t, i) => {
      const r = panel.templates[i];
      if (!r) return;
      new Button(this, r, t.name, () => this.useTemplate(t.id));
    });
    this.startButton = new Button(this, panel.start, '開戦', () => this.startBattle(), { primary: true });
    addMuteButton(this, panel.mute);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);

    const onLayout = (): void => {
      this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      debug.applyTemplate = null;
      debug.start = null;
    });
    debug.applyTemplate = (id) => this.useTemplate(id);
    debug.start = (viewer) => this.startBattle(viewer);

    this.refresh();
  }

  // ---- 配置の操作 ----

  private remaining(kind: Kind): number {
    const used = session.placements.filter((p) => p.kind === kind).length;
    return (ROSTER[kind] ?? 0) - used;
  }

  private indexAt(cell: Cell): number {
    return session.placements.findIndex((p) => p.col === cell.col && p.row === cell.row);
  }

  private inOwnZone(cell: Cell): boolean {
    const z = session.field.zones[0];
    return cell.col >= z.col && cell.col < z.col + z.width && cell.row >= z.row && cell.row < z.row + z.height;
  }

  private selectKind(kind: Kind): void {
    this.closePopup();
    this.selectedKind = this.selectedKind === kind ? null : kind;
    this.refresh();
  }

  private useTemplate(id: TemplateId): void {
    this.closePopup();
    this.selectedKind = null;
    session.placements = applyTemplate(id, ROSTER, session.field.zones[0], 0);
    playPlace();
    this.refresh();
  }

  private place(kind: Kind, cell: Cell): void {
    session.placements.push({ kind, col: cell.col, row: cell.row, stance: defaultStance(kind) });
    playPlace();
  }

  /** index の部隊を cell へ。そこに別の部隊がいれば入れ替える */
  private moveTo(index: number, cell: Cell): void {
    const me = session.placements[index];
    if (!me) return;
    const other = this.indexAt(cell);
    if (other === index) return;
    const target = other >= 0 ? session.placements[other] : undefined;
    if (target) {
      target.col = me.col;
      target.row = me.row;
    }
    me.col = cell.col;
    me.row = cell.row;
    playPlace();
  }

  private setStance(index: number, stance: Stance): void {
    const p = session.placements[index];
    if (p && stanceAllowed(p.kind, stance)) p.stance = stance;
    playStance();
    this.closePopup();
    this.refresh();
  }

  private removeAt(index: number): void {
    session.placements.splice(index, 1);
    playRemove();
    this.closePopup();
    this.refresh();
  }

  /**
   * 開戦。1人用の BattleSource はここで作って戦闘の画面へ渡す（戦闘の画面は source の作り方を知らない）。
   * viewer は普段 0。開発用の口からだけ 1 を渡し、陣営1の側から同じ戦いを映して確かめる。
   */
  private startBattle(viewer: Side = 0): boolean {
    if (armyErrors(session.placements).length > 0) return false;
    const made = LocalBattleSource.create(battleSetup(), viewer);
    if (!made.ok) {
      // 配置は検査済みなので起きないはずだが、起きたら配置の画面にとどまる
      console.error('createBattle に失敗', made.error);
      return false;
    }
    const data: BattleSceneData = { source: made.source, field: session.field, viewer };
    playStart();
    this.scene.start('Battle', data);
    return true;
  }

  // ---- 入力（マウスとタッチを同じに扱う。2本目の指は無視する） ----

  private onDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.press) return;
    // ボタンの上は、ボタンが受け持つ
    if (over.length > 0) return;
    const hadPopup = this.popupIndex !== null;
    this.closePopup();
    const cell = this.fv.cellAt(pointer.x, pointer.y);
    if (!cell || !this.inOwnZone(cell)) {
      if (hadPopup) this.refresh();
      return;
    }
    const index = this.indexAt(cell);
    if (index >= 0) {
      this.press = { pointerId: pointer.id, index, startX: pointer.x, startY: pointer.y, dragging: false };
    } else if (!hadPopup && this.selectedKind && this.remaining(this.selectedKind) > 0) {
      this.place(this.selectedKind, cell);
    }
    this.refresh();
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const press = this.press;
    if (!press || pointer.id !== press.pointerId) return;
    if (!press.dragging && Math.hypot(pointer.x - press.startX, pointer.y - press.startY) < DRAG_THRESHOLD) return;
    press.dragging = true;
    const p = session.placements[press.index];
    const sprite = this.ownSprites[press.index];
    if (!p || !sprite) return;
    sprite.apply({ x: pointer.x, y: pointer.y, dx: 0, dy: -1, menRatio: 1, morale: 100, rout: 0, highlight: true, stance: p.stance });
    const cell = this.fv.cellAt(pointer.x, pointer.y);
    this.dropMark.clear();
    if (cell && this.inOwnZone(cell)) this.drawCellFrame(this.dropMark, this.fv.cellRect(cell.col, cell.row));
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    const press = this.press;
    if (!press || pointer.id !== press.pointerId) return;
    this.press = null;
    this.dropMark.clear();
    // タッチのキャンセルは、引きずりの表示を戻すだけにして、移動も方針の切り替えも確定しない
    if (pointer.wasCanceled) {
      this.refresh();
      return;
    }
    if (press.dragging) {
      const cell = this.fv.cellAt(pointer.x, pointer.y);
      // エリアの外に落としたら元のマスに戻す
      if (cell && this.inOwnZone(cell)) this.moveTo(press.index, cell);
      this.refresh();
      return;
    }
    this.openPopup(press.index);
  }

  // ---- 方針の切り替えと「外す」 ----

  private openPopup(index: number): void {
    const p = session.placements[index];
    if (!p) return;
    this.closePopup();
    this.selectedKind = null;
    this.popupIndex = index;
    const items: { label: string; stance: Stance | null }[] = STANCES.filter((s) => stanceAllowed(p.kind, s)).map(
      (s) => ({ label: STANCE_LABEL[s], stance: s }),
    );
    items.push({ label: '外す', stance: null });
    const w = 80;
    const h = 24;
    const gap = 2;
    const totalH = items.length * h + (items.length - 1) * gap;
    const f = this.fv.rect;
    const c = this.fv.cellCenter(p.col, p.row);
    // 部隊の右に出し、はみ出すなら左に出す。縦は戦場の中に収める
    const x = c.x + CELL / 2 + 4 + w <= f.x + f.w ? c.x + CELL / 2 + 4 : c.x - CELL / 2 - 4 - w;
    const y = Math.max(f.y, Math.min(f.y + f.h - totalH, Math.round(c.y - h / 2)));
    items.forEach((it, i) => {
      const r: Rect = { x, y: y + i * (h + gap), w, h };
      const b = new Button(this, r, it.label, () => {
        if (it.stance) this.setStance(index, it.stance);
        else this.removeAt(index);
      });
      b.setSelected(it.stance === p.stance);
      b.addTo(this.popupLayer);
      this.popupButtons.push(b);
    });
    this.refresh();
  }

  private closePopup(): void {
    for (const b of this.popupButtons) b.destroy();
    this.popupButtons = [];
    this.popupIndex = null;
  }

  // ---- 表示 ----

  private drawCellFrame(g: Phaser.GameObjects.Graphics, r: Rect): void {
    g.fillStyle(COLOR.highlight, 1);
    g.fillRect(r.x, r.y, r.w, 2);
    g.fillRect(r.x, r.y + r.h - 2, r.w, 2);
    g.fillRect(r.x, r.y + 2, 2, r.h - 4);
    g.fillRect(r.x + r.w - 2, r.y + 2, 2, r.h - 4);
  }

  private refresh(): void {
    for (const s of this.ownSprites) s.destroy();
    this.ownSprites = session.placements.map((p: Placement, i) => {
      const s = new UnitSprite(this, 0, p.kind, i, this.soldierLayer, this.markLayer);
      const c = this.fv.cellCenter(p.col, p.row);
      const d = this.fv.dirToScreen(0, -1);
      const highlight = i === this.popupIndex || (this.press?.index === i && this.press.dragging);
      // 自軍には方針の印を付ける（押さなくても方針が分かるように。敵には付けない）
      s.apply({ x: c.x, y: c.y, dx: d.x, dy: d.y, menRatio: 1, morale: 100, rout: 0, highlight, stance: p.stance, bounds: this.fv.rect });
      return s;
    });
    if (this.selectedKind && this.remaining(this.selectedKind) <= 0) this.selectedKind = null;
    for (const [kind, b] of this.rosterButtons) {
      const n = this.remaining(kind);
      b.setText(`${KIND_LABEL[kind]}${n}`).setEnabled(n > 0).setSelected(this.selectedKind === kind);
    }
    this.startButton.setEnabled(armyErrors(session.placements).length === 0);
  }
}
