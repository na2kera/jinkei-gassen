// 配置の画面（design §5.1）。面（Stage）ごとの手持ち・敵・決まり（allow）に合わせて出すものを変える。
// 手持ちを選んでマスを押すと置く／置いた部隊を引きずると動く／ほかの部隊の上に落とすと入れ替わる／
// 置いた部隊を押すと、方針の切り替え（その面で選べるものだけ）と「外す」が出る。
// 配置は session に持ち、変えるたびに面ごとの最後の配置として保存する。このシーンは向きが変わると作り直す。

import {
  applyTemplate,
  defaultStance,
  listTemplates,
  recognizeFormation,
  stageEnemyVisible,
  STANCES,
  type Kind,
  type Placement,
  type Side,
  type Stage,
  type Stance,
  type StageEnemyOrder,
  type TemplateId,
} from '@jinkei/engine';
import Phaser from 'phaser';
import { addFieldImage, drawFieldFrame, drawZone } from '../art/field.ts';
import { COLOR } from '../art/palette.ts';
import { UnitSprite } from '../art/UnitSprite.ts';
import { playFormation, playPlace, playRemove, playStance, playStart } from '../audio/sfx.ts';
import { FieldView, type Cell } from '../battle/FieldView.ts';
import { LocalBattleSource } from '../battle/LocalBattleSource.ts';
import { debug } from '../debug.ts';
import { CELL, deployPanel, getLayout, LAYOUT_EVENT, type Rect } from '../layout.ts';
import { armyErrors, battleSetup, fitStances, openStage, session, setPlacements, stanceOk } from '../session.ts';
import { Button } from '../ui/Button.ts';
import { KIND_LABEL, ROSTER_ORDER, STANCE_LABEL } from '../ui/labels.ts';
import { addMuteButton } from '../ui/mute.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';
import type { BattleSceneData } from './BattleScene.ts';

/** これ以上動いたら「押した」ではなく「引きずった」とみなす（px） */
const DRAG_THRESHOLD = 6;

interface Press {
  pointerId: number;
  index: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

export interface DeploySceneData {
  stageId?: string;
}

export class DeployScene extends Phaser.Scene {
  private stage!: Stage;
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
  private formationBox!: Phaser.GameObjects.Graphics;
  private formationText!: Phaser.GameObjects.Text;
  private formationName: string | null = null;
  private stageIdArg: string | undefined;

  constructor() {
    super('Deploy');
  }

  init(data: DeploySceneData): void {
    this.stageIdArg = data?.stageId;
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
    this.formationName = null;

    // 面を開く（前にこの面で置いた配置があれば戻る）
    this.stage = openStage(this.stageIdArg ?? session.stageId);
    const stage = this.stage;
    const field = stage.field;
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

    // 敵の配置は見せる（方針と、霧のマスの部隊は見せない。decisions §8）
    stageEnemyVisible(stage).forEach((p, i) => {
      const s = new UnitSprite(this, 1, p.kind, 100 + i, this.soldierLayer, this.markLayer);
      const c = this.fv.cellCenter(p.col, p.row);
      const d = this.fv.dirToScreen(0, 1);
      s.apply({ x: c.x, y: c.y, dx: d.x, dy: d.y, menRatio: 1, morale: 100, rout: 0, highlight: false, bounds: this.fv.rect });
    });

    // ヒントと陣形名は、配置中は空いている中間地帯に出す（目に入るが、部隊の邪魔にならない）
    const band = this.bandRows();
    const hintPos = this.fv.toScreen(field.width / 2, band.top + 0.75);
    const hint = addText(this, 0, 0, stage.hint, 16, COLOR.cream).setOrigin(0.5, 0.5);
    const hw = Math.ceil(hint.width / 2) * 2 + 20;
    const hintBox: Rect = { x: Math.round((hintPos.x - hw / 2) / 2) * 2, y: Math.round(hintPos.y / 2) * 2 - 14, w: hw, h: 28 };
    const hg = this.add.graphics();
    drawBox(hg, hintBox);
    hint.setPosition(Math.round(hintBox.x + hw / 2), hintBox.y + 14);
    this.children.bringToTop(hint);
    this.formationBox = this.add.graphics();
    this.formationText = addText(this, 0, 0, '', 16, COLOR.goldHi).setOrigin(0.5, 0.5).setVisible(false);
    this.popupLayer = this.add.container(0, 0);

    const panel = deployPanel(layout);
    new Button(this, panel.back, '戻る', () => this.scene.start('StageSelect'));
    addText(this, panel.name.x, panel.name.y, `${stage.id} ${stage.name}`, 16, COLOR.goldHi).setOrigin(0, 0.5);
    addMuteButton(this, panel.mute);
    // 手持ちは、その面にある兵種だけを並べる（ない兵種のボタンは出さない）
    ROSTER_ORDER.filter((k) => (stage.roster[k] ?? 0) > 0).forEach((kind, i) => {
      const r = panel.roster[i];
      if (!r) return;
      this.rosterButtons.set(kind, new Button(this, r, KIND_LABEL[kind], () => this.selectKind(kind)));
    });
    if (stage.allow?.templates !== false) {
      listTemplates().forEach((t, i) => {
        const r = panel.templates[i];
        if (!r) return;
        new Button(this, r, t.name, () => this.useTemplate(t.id));
      });
    }
    this.startButton = new Button(this, panel.start, '開戦', () => this.startBattle(), { primary: true });

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
      debug.placeSolution = null;
      debug.startSolution = null;
    });
    debug.applyTemplate = (id) => this.useTemplate(id);
    debug.start = (viewer) => this.startBattle(viewer);
    debug.placeSolution = () => {
      this.closePopup();
      setPlacements(this.stage.solution.map((p) => ({ ...p })));
      this.refresh();
    };
    debug.startSolution = () => {
      setPlacements(this.stage.solution.map((p) => ({ ...p })));
      return this.startBattle(0, this.stage.solutionOrders ?? []);
    };

    // 開いた時点の陣形名は、音や動きなしで出す
    this.refresh(false);
  }

  /** 中間地帯（両軍の配置エリアのあいだ）の行 */
  private bandRows(): { top: number; bottom: number } {
    const z = this.stage.field.zones;
    return { top: z[1].row + z[1].height, bottom: z[0].row };
  }

  /** その面で方針を切り替えられるか（allow.stances が空の配列なら出さない） */
  private stancesShown(): boolean {
    const list = this.stage.allow?.stances;
    return list === undefined || list.length > 0;
  }

  // ---- 配置の操作 ----

  private remaining(kind: Kind): number {
    const used = session.placements.filter((p) => p.kind === kind).length;
    return (this.stage.roster[kind] ?? 0) - used;
  }

  private indexAt(cell: Cell): number {
    return session.placements.findIndex((p) => p.col === cell.col && p.row === cell.row);
  }

  private inOwnZone(cell: Cell): boolean {
    const z = this.stage.field.zones[0];
    return cell.col >= z.col && cell.col < z.col + z.width && cell.row >= z.row && cell.row < z.row + z.height;
  }

  private selectKind(kind: Kind): void {
    this.closePopup();
    this.selectedKind = this.selectedKind === kind ? null : kind;
    this.refresh();
  }

  private useTemplate(id: TemplateId): void {
    if (this.stage.allow?.templates === false) return;
    this.closePopup();
    this.selectedKind = null;
    // ひな形の方針のうち、この面で選べないものは兵種の初期設定に直す
    setPlacements(fitStances(this.stage, applyTemplate(id, this.stage.roster, this.stage.field.zones[0], 0)));
    playPlace();
    this.refresh();
  }

  private place(kind: Kind, cell: Cell): void {
    setPlacements([...session.placements, { kind, col: cell.col, row: cell.row, stance: defaultStance(kind) }]);
    playPlace();
  }

  /** index の部隊を cell へ。そこに別の部隊がいれば入れ替える */
  private moveTo(index: number, cell: Cell): void {
    const list = session.placements.map((p) => ({ ...p }));
    const me = list[index];
    if (!me) return;
    const other = this.indexAt(cell);
    if (other === index) return;
    const target = other >= 0 ? list[other] : undefined;
    if (target) {
      target.col = me.col;
      target.row = me.row;
    }
    me.col = cell.col;
    me.row = cell.row;
    setPlacements(list);
    playPlace();
  }

  private setStance(index: number, stance: Stance): void {
    const list = session.placements.map((p) => ({ ...p }));
    const p = list[index];
    if (p && stanceOk(this.stage, { kind: p.kind, stance })) {
      p.stance = stance;
      setPlacements(list);
    }
    playStance();
    this.closePopup();
    this.refresh();
  }

  private removeAt(index: number): void {
    setPlacements(session.placements.filter((_, i) => i !== index));
    playRemove();
    this.closePopup();
    this.refresh();
  }

  /**
   * 開戦。1人用の BattleSource はここで作って戦闘の画面へ渡す（戦闘の画面は source の作り方を知らない）。
   * viewer は普段 0。開発用の口からだけ 1 を渡し、陣営1の側から同じ戦いを映して確かめる。
   * myOrders も開発用で、見本の号令を予定に入れて確かめるためのもの。
   */
  private startBattle(viewer: Side = 0, myOrders: StageEnemyOrder[] = []): boolean {
    if (armyErrors(session.placements).length > 0) return false;
    const made = LocalBattleSource.create(battleSetup(myOrders), viewer);
    if (!made.ok) {
      // 配置は検査済みなので起きないはずだが、起きたら配置の画面にとどまる
      console.error('createBattle に失敗', made.error);
      return false;
    }
    const data: BattleSceneData = {
      source: made.source,
      field: this.stage.field,
      viewer,
      orders: this.stage.allow?.orders !== false,
      quitTo: { scene: 'Deploy', data: { stageId: this.stage.id } },
      stageId: this.stage.id,
    };
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
    sprite.apply({ x: pointer.x, y: pointer.y, dx: 0, dy: -1, menRatio: 1, morale: 100, rout: 0, highlight: true, stance: this.stancesShown() ? p.stance : null });
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
    // 方針の切り替えを出さない面では「外す」だけを出す
    const stances = this.stancesShown() ? STANCES.filter((s) => stanceOk(this.stage, { kind: p.kind, stance: s })) : [];
    const items: { label: string; stance: Stance | null }[] = stances.map((s) => ({ label: STANCE_LABEL[s], stance: s }));
    items.push({ label: '外す', stance: null });
    // 「本陣狙い」が枠に触れないだけの大きさ
    const w = 88;
    const h = 28;
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

  private refresh(announce = true): void {
    for (const s of this.ownSprites) s.destroy();
    this.ownSprites = session.placements.map((p: Placement, i) => {
      const s = new UnitSprite(this, 0, p.kind, i, this.soldierLayer, this.markLayer);
      const c = this.fv.cellCenter(p.col, p.row);
      const d = this.fv.dirToScreen(0, -1);
      const highlight = i === this.popupIndex || (this.press?.index === i && this.press.dragging);
      // 自軍には方針の印を付ける（押さなくても方針が分かるように。敵と、方針を選べない面には付けない）
      const stance = this.stancesShown() ? p.stance : null;
      s.apply({ x: c.x, y: c.y, dx: d.x, dy: d.y, menRatio: 1, morale: 100, rout: 0, highlight, stance, bounds: this.fv.rect });
      return s;
    });
    if (this.selectedKind && this.remaining(this.selectedKind) <= 0) this.selectedKind = null;
    for (const [kind, b] of this.rosterButtons) {
      const n = this.remaining(kind);
      b.setText(`${KIND_LABEL[kind]}${n}`).setEnabled(n > 0).setSelected(this.selectedKind === kind);
    }
    this.startButton.setEnabled(armyErrors(session.placements).length === 0);
    this.updateFormation(announce);
  }

  /**
   * 陣形名（効果はなく、名前だけ）。配置が変わるたびに調べ、名前が付いたら「鶴翼の陣」のように出す。
   * 新しく名前が付いた瞬間だけ、短い音と、下から 4px 持ち上がる小さな動きを付ける。
   */
  private updateFormation(announce: boolean): void {
    const found = recognizeFormation(session.placements, this.stage.field.zones[0], 0);
    // 「横陣」のように名前が「陣」で終わるものはそのまま、それ以外は「鶴翼の陣」のように「の陣」を付ける
    const name = found ? (found.name.endsWith('陣') ? found.name : `${found.name}の陣`) : null;
    if (name === this.formationName) return;
    this.formationName = name;
    this.formationBox.clear();
    this.tweens.killTweensOf([this.formationBox, this.formationText]);
    if (!name) {
      this.formationText.setVisible(false);
      return;
    }
    const band = this.bandRows();
    const pos = this.fv.toScreen(this.stage.field.width / 2, band.bottom - 0.75);
    this.formationText.setText(name);
    const w = Math.ceil(this.formationText.width / 2) * 2 + 24;
    const r: Rect = { x: Math.round((pos.x - w / 2) / 2) * 2, y: Math.round(pos.y / 2) * 2 - 14, w, h: 28 };
    drawBox(this.formationBox, { ...r, x: 0, y: 0 });
    this.formationBox.setPosition(r.x, r.y);
    this.formationText.setPosition(Math.round(r.x + w / 2), r.y + 14).setVisible(true);
    if (!announce) return;
    playFormation();
    // 2px ずつ段を付けて持ち上げる（なめらかに動かすとドットの見た目から浮くため）
    const lift = { v: 4 };
    this.formationBox.y = r.y + 4;
    this.formationText.y = r.y + 14 + 4;
    this.tweens.add({
      targets: lift,
      v: 0,
      duration: 160,
      onUpdate: () => {
        const dy = Math.round(lift.v / 2) * 2;
        this.formationBox.y = r.y + dy;
        this.formationText.y = r.y + 14 + dy;
      },
    });
  }
}
