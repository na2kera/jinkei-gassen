// 配置の画面（design §5.1）。1人用の面（Stage）と、対戦の配置の両方をこのシーンで扱う。
// 手持ちを選んでマスを押すと置く／置いた部隊を引きずると動く／ほかの部隊の上に落とすと入れ替わる／
// 置いた部隊を押すと、方針の切り替え（選べるものだけ）と「外す」が出る。
//   1人用：手持ちは面で決まり、敵の配置が見える。allow に従ってひな形・方針を出し分け、ヒントを出す。
//          配置は session に持ち、変えるたびに面ごとの最後の配置として保存する。
//   対戦：編成（兵種ごとの数）を予算の中で足し引きする。敵のエリアは見えない（斜線で隠す）。
//          配置は pvpLocal に持ち、変わるたびに下書きを送る（0.5秒に1回まで）。「完了」で確定し、確定中は動かせない。
//          段階の移り変わり（公開へ進むなど）は pvp.ts が決める。このシーンは、届いた room を見て表示を直すだけ。
// どちらも、場所や手持ちの違いは下の「モード」の関数（list・roster・ownZone など）に閉じ込め、操作の作りは共通にする。

import {
  applyTemplate,
  defaultStance,
  listTemplates,
  pvpArmyLimits,
  recognizeFormation,
  stageEnemyVisible,
  STANCES,
  stanceAllowed,
  validateArmy,
  type ArmyError,
  type Field,
  type Kind,
  type Placement,
  type Roster,
  type Side,
  type Stage,
  type Stance,
  type StageEnemyOrder,
  type TemplateId,
  type Zone,
} from '@jinkei/engine';
import Phaser from 'phaser';
import { addFieldImage, drawFieldFrame, drawZone } from '../art/field.ts';
import { COLOR } from '../art/palette.ts';
import { UnitSprite } from '../art/UnitSprite.ts';
import { playFormation, playPlace, playRemove, playStance, playStart } from '../audio/sfx.ts';
import { FieldView, type Cell } from '../battle/FieldView.ts';
import { LocalBattleSource } from '../battle/LocalBattleSource.ts';
import { debug } from '../debug.ts';
import { CELL, deployPanel, getLayout, LAYOUT_EVENT, pvpDeployPanel, type Rect } from '../layout.ts';
import { client, notify, pvp, pvpLocal } from '../net/pvp.ts';
import { armyErrors, battleSetup, fitStances, openStage, session, setPlacements, stanceOk } from '../session.ts';
import { Button } from '../ui/Button.ts';
import { KIND_LABEL, ROSTER_ORDER, STANCE_LABEL } from '../ui/labels.ts';
import { addMuteButton } from '../ui/mute.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';
import type { BattleSceneData } from './BattleScene.ts';

/** これ以上動いたら「押した」ではなく「引きずった」とみなす（px） */
const DRAG_THRESHOLD = 6;
/** 下書きを送る間隔の下限（ミリ秒。design §4.3） */
const DRAFT_GAP_MS = 500;
/** 「出る」を2回押すまでの猶予（ミリ秒） */
const LEAVE_ARM_MS = 2500;

interface Press {
  pointerId: number;
  index: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

export interface DeploySceneData {
  stageId?: string;
  /** 対戦の配置として開く */
  pvp?: boolean;
}

/** 置いた途中の配置として使えない誤り（本陣がない・部隊が足りないのは途中なのでよい） */
const BROKEN: ReadonlySet<ArmyError['code']> = new Set(['invalid_kind', 'invalid_stance', 'invalid_cell', 'out_of_zone', 'overlap', 'over_budget', 'too_many_units']);

/** 配置の兵種ごとの数 */
function countKinds(list: readonly Placement[]): Roster {
  const r: Roster = {};
  for (const p of list) r[p.kind] = (r[p.kind] ?? 0) + 1;
  return r;
}

export class DeployScene extends Phaser.Scene {
  private pvpMode = false;
  private stage!: Stage;
  private field!: Field;
  private ownZone!: Zone;
  private otherZone!: Zone;
  private fv!: FieldView;
  private soldierLayer!: Phaser.GameObjects.Container;
  private markLayer!: Phaser.GameObjects.Container;
  private popupLayer!: Phaser.GameObjects.Container;
  private dropMark!: Phaser.GameObjects.Graphics;
  private ownSprites: UnitSprite[] = [];
  private rosterButtons = new Map<Kind, Button>();
  private minusButtons = new Map<Kind, Button>();
  private plusButtons = new Map<Kind, Button>();
  private templateButtons: Button[] = [];
  private startButton!: Button;
  private backButton!: Button;
  private popupButtons: Button[] = [];
  private popupIndex: number | null = null;
  private selectedKind: Kind | null = null;
  private press: Press | null = null;
  private formationBox!: Phaser.GameObjects.Graphics;
  private formationText!: Phaser.GameObjects.Text;
  private formationName: string | null = null;
  private stageIdArg: string | undefined;
  // 対戦だけ
  private budgetText: Phaser.GameObjects.Text | null = null;
  private infoBox: Phaser.GameObjects.Graphics | null = null;
  private infoText: Phaser.GameObjects.Text | null = null;
  private lastDraftAt = 0;
  private draftTimer = 0;
  private leaveArmedUntil = 0;
  private unsubscribe: (() => void)[] = [];

  constructor() {
    super('Deploy');
  }

  init(data: DeploySceneData): void {
    this.stageIdArg = data?.stageId;
    this.pvpMode = data?.pvp === true;
  }

  create(): void {
    debug.scene = this.pvpMode ? 'PvpDeploy' : 'Deploy';
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    this.ownSprites = [];
    this.rosterButtons = new Map();
    this.minusButtons = new Map();
    this.plusButtons = new Map();
    this.templateButtons = [];
    this.popupButtons = [];
    this.popupIndex = null;
    this.selectedKind = null;
    this.press = null;
    this.formationName = null;
    this.budgetText = null;
    this.infoBox = null;
    this.infoText = null;
    this.unsubscribe = [];
    this.leaveArmedUntil = 0;

    if (this.pvpMode) {
      const room = client.room;
      if (!room) {
        this.scene.start('Lobby');
        return;
      }
      // 戦場は「自分が下」の座標で届く。自分の配置エリアは zones[you]（いつも下側）
      this.field = room.field;
      this.ownZone = room.field.zones[room.you];
      this.otherZone = room.field.zones[room.you === 0 ? 1 : 0];
      this.beginPvpSetup();
    } else {
      // 面を開く（前にこの面で置いた配置があれば戻る）
      this.stage = openStage(this.stageIdArg ?? session.stageId);
      this.field = this.stage.field;
      this.ownZone = this.stage.field.zones[0];
      this.otherZone = this.stage.field.zones[1];
    }

    const field = this.field;
    this.fv = new FieldView(layout.field, field.width, field.height);
    drawFieldFrame(this.add.graphics(), this.fv);
    addFieldImage(this, this.fv, field);
    // 配置エリアは配置の画面だけで見せる。自軍は明るい金、敵軍は暗い色
    const zones = this.add.graphics();
    drawZone(zones, this.fv, this.ownZone, COLOR.gold);
    drawZone(zones, this.fv, this.otherZone, COLOR.dim);
    if (this.pvpMode) this.drawFog(zones, this.otherZone);
    this.soldierLayer = this.add.container(0, 0);
    this.markLayer = this.add.container(0, 0);
    this.dropMark = this.add.graphics();

    if (!this.pvpMode) {
      // 敵の配置は見せる（方針と、霧のマスの部隊は見せない。decisions §8）
      stageEnemyVisible(this.stage).forEach((p, i) => {
        const s = new UnitSprite(this, 1, p.kind, 100 + i, this.soldierLayer, this.markLayer);
        const c = this.fv.cellCenter(p.col, p.row);
        const d = this.fv.dirToScreen(0, 1);
        s.apply({ x: c.x, y: c.y, dx: d.x, dy: d.y, menRatio: 1, morale: 100, rout: 0, highlight: false, bounds: this.fv.rect });
      });
      // ヒントは、配置中は空いている中間地帯に出す（目に入るが、部隊の邪魔にならない）
      this.bandText(this.stage.hint, 'top');
    } else {
      // 対戦では、中間地帯に残り時間と相手の様子を出す（毎フレーム書き換える）
      this.infoBox = this.add.graphics();
      this.infoText = addText(this, 0, 0, '', 16, COLOR.cream).setOrigin(0.5, 0.5);
    }
    this.formationBox = this.add.graphics();
    this.formationText = addText(this, 0, 0, '', 16, COLOR.goldHi).setOrigin(0.5, 0.5).setVisible(false);
    this.popupLayer = this.add.container(0, 0);

    if (this.pvpMode) this.buildPvpPanel();
    else this.buildStagePanel();

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
      window.clearTimeout(this.draftTimer);
      for (const u of this.unsubscribe) u();
      debug.applyTemplate = null;
      debug.start = null;
      debug.placeSolution = null;
      debug.startSolution = null;
    });
    debug.applyTemplate = (id) => this.useTemplate(id);
    debug.start = (viewer) => (this.pvpMode ? this.pressReady() : this.startBattle(viewer));
    if (!this.pvpMode) {
      debug.placeSolution = () => {
        this.closePopup();
        setPlacements(this.stage.solution.map((p) => ({ ...p })));
        this.refresh();
      };
      debug.startSolution = () => {
        setPlacements(this.stage.solution.map((p) => ({ ...p })));
        return this.startBattle(0, this.stage.solutionOrders ?? []);
      };
    }

    // 開いた時点の陣形名は、音や動きなしで出す
    this.refresh(false);
  }

  private buildStagePanel(): void {
    const stage = this.stage;
    const panel = deployPanel(getLayout());
    this.backButton = new Button(this, panel.back, '戻る', () => this.scene.start('StageSelect'));
    addText(this, panel.name.x, panel.name.y, `${stage.id} ${stage.name}`, 16, COLOR.goldHi).setOrigin(0, 0.5);
    addMuteButton(this, panel.mute);
    // 手持ちは、その面にある兵種だけを並べる（ない兵種のボタンは出さない）
    ROSTER_ORDER.filter((k) => (stage.roster[k] ?? 0) > 0).forEach((kind, i) => {
      const r = panel.roster[i];
      if (!r) return;
      this.rosterButtons.set(kind, new Button(this, r, KIND_LABEL[kind], () => this.selectKind(kind)));
    });
    if (this.templatesShown()) this.addTemplateButtons(panel.templates);
    this.startButton = new Button(this, panel.start, '開戦', () => this.startBattle(), { primary: true });
  }

  private buildPvpPanel(): void {
    const panel = pvpDeployPanel(getLayout());
    this.backButton = new Button(this, panel.back, '出る', () => this.pressLeave());
    this.budgetText = addText(this, panel.budget.x, panel.budget.y, '', 16, COLOR.goldHi).setOrigin(0, 0.5);
    addMuteButton(this, panel.mute);
    // 対戦は5兵種すべてを並べ、本陣以外は下の「−」「＋」で数を変える（本陣は必ず1つ）
    ROSTER_ORDER.forEach((kind, i) => {
      const r = panel.roster[i];
      if (!r) return;
      this.rosterButtons.set(kind, new Button(this, r, KIND_LABEL[kind], () => this.selectKind(kind)));
      if (kind === 'hq') return;
      const m = panel.minus[i];
      const p = panel.plus[i];
      if (m) this.minusButtons.set(kind, new Button(this, m, '−', () => this.changeCount(kind, -1)));
      if (p) this.plusButtons.set(kind, new Button(this, p, '＋', () => this.changeCount(kind, 1)));
    });
    this.addTemplateButtons(panel.templates);
    this.startButton = new Button(this, panel.start, '完了', () => this.pressReady(), { primary: true });
    // 部屋の様子（自分と相手の確定・期限）が変わったら、ボタンと表示を直す
    this.unsubscribe.push(client.subscribe(() => this.refresh(false)));
    this.unsubscribe.push(
      client.onError((m) => {
        if (m.reason === 'invalid_army') notify('配置が正しくありません');
      }),
    );
  }

  private addTemplateButtons(rects: Rect[]): void {
    listTemplates().forEach((t, i) => {
      const r = rects[i];
      if (!r) return;
      this.templateButtons.push(new Button(this, r, t.name, () => this.useTemplate(t.id)));
    });
  }

  // ---- モード（1人用と対戦の違いをここに閉じ込める） ----

  private get list(): Placement[] {
    return this.pvpMode ? pvpLocal.placements : session.placements;
  }

  private setList(list: Placement[]): void {
    if (this.pvpMode) {
      pvpLocal.placements = list;
      this.scheduleDraft();
    } else {
      setPlacements(list);
    }
  }

  private roster(): Roster {
    return this.pvpMode ? pvpLocal.roster : this.stage.roster;
  }

  private stanceOkFor(kind: Kind, stance: Stance): boolean {
    return this.pvpMode ? stanceAllowed(kind, stance) : stanceOk(this.stage, { kind, stance });
  }

  /** 方針を切り替えられるか（1人用は allow.stances が空の配列なら出さない） */
  private stancesShown(): boolean {
    if (this.pvpMode) return true;
    const list = this.stage.allow?.stances;
    return list === undefined || list.length > 0;
  }

  private templatesShown(): boolean {
    return this.pvpMode || this.stage.allow?.templates !== false;
  }

  private errors(list: Placement[]): ArmyError[] {
    return this.pvpMode ? validateArmy(list, this.ownZone, pvpArmyLimits()) : armyErrors(list);
  }

  /** 対戦で、自分が確定している間は配置を動かせない */
  private locked(): boolean {
    const room = client.room;
    return this.pvpMode && !!room && room.seats[room.you]?.ready === true;
  }

  // ---- 対戦の編成と下書き ----

  /**
   * 配置の段階に入ったときの始め方。戦いが変わった（新しい配置の段階）なら、
   * room.myArmy（入り直したときにサーバーが覚えていた下書き）、なければ前の戦いの配置から始める。
   */
  private beginPvpSetup(): void {
    const room = client.room;
    if (!room || pvpLocal.setupFor === room.battleNo) return;
    pvpLocal.setupFor = room.battleNo;
    const base = room.myArmy ?? pvpLocal.placements;
    const ok = !validateArmy(base, this.ownZone, pvpArmyLimits()).some((e) => BROKEN.has(e.code));
    pvpLocal.placements = ok ? base.map((p) => ({ ...p })) : [];
    // 編成は、置いてある部隊の数から始める。まだ何も置いていなければ、既定の編成（予算ちょうど）から始める
    pvpLocal.roster = pvpLocal.placements.length > 0 ? { ...countKinds(pvpLocal.placements), hq: 1 } : { ...room.rules.standardRoster };
    if (pvpLocal.placements.length > 0) this.scheduleDraft();
  }

  private costs(): Record<Kind, number> {
    return client.room?.rules.costs ?? (pvpArmyLimits().costs as Record<Kind, number>);
  }

  private budgetLeft(): number {
    const budget = client.room?.rules.budget ?? pvpArmyLimits().budget ?? 0;
    const costs = this.costs();
    let used = 0;
    for (const [k, n] of Object.entries(pvpLocal.roster)) used += (costs[k as Kind] ?? 0) * (n ?? 0);
    return budget - used;
  }

  private canAdd(kind: Kind): boolean {
    const room = client.room;
    if (!room || kind === 'hq' || this.locked()) return false;
    const others = Object.entries(pvpLocal.roster).reduce((n, [k, v]) => (k === 'hq' ? n : n + (v ?? 0)), 0);
    return others < room.rules.maxUnits && this.budgetLeft() >= (this.costs()[kind] ?? Infinity);
  }

  /** 兵種の数を足し引きする。減らして置いた数を下回ったら、最後に置いたその兵種の部隊を外す */
  private changeCount(kind: Kind, delta: 1 | -1): void {
    if (this.locked()) return;
    const have = pvpLocal.roster[kind] ?? 0;
    if (delta > 0 && !this.canAdd(kind)) return;
    if (delta < 0 && have <= 0) return;
    pvpLocal.roster = { ...pvpLocal.roster, [kind]: have + delta };
    if (delta < 0) {
      const placed = this.list.filter((p) => p.kind === kind).length;
      if (placed > have + delta) {
        const i = this.list.map((p) => p.kind).lastIndexOf(kind);
        this.setList(this.list.filter((_, j) => j !== i));
      }
      playRemove();
    } else {
      playPlace();
    }
    this.closePopup();
    this.refresh();
  }

  /** 下書きを送る。0.5秒に1回までにまとめ、間に合わなければ少し待って最後の配置を送る */
  private scheduleDraft(): void {
    if (!this.pvpMode || this.locked()) return;
    window.clearTimeout(this.draftTimer);
    const wait = Math.max(0, this.lastDraftAt + DRAFT_GAP_MS - Date.now());
    this.draftTimer = window.setTimeout(() => {
      if (this.locked()) return;
      this.lastDraftAt = Date.now();
      client.send({ type: 'draft', army: pvpLocal.placements.map((p) => ({ ...p })) });
    }, wait);
  }

  /** 「完了」で確定し、確定中にもう一度押すと取り消す */
  private pressReady(): boolean {
    if (this.locked()) return client.send({ type: 'unready' });
    if (this.errors(this.list).length > 0) return false;
    window.clearTimeout(this.draftTimer);
    playStart();
    return client.send({ type: 'ready', army: this.list.map((p) => ({ ...p })) });
  }

  /** 「出る」：1回目は「出る？」に変わるだけで、猶予のうちにもう一度押すと部屋を出る */
  private pressLeave(): void {
    const now = this.time.now;
    if (now < this.leaveArmedUntil) {
      pvp.leave();
      return;
    }
    this.leaveArmedUntil = now + LEAVE_ARM_MS;
    this.backButton.setText('出る？').setSelected(true);
    this.time.delayedCall(LEAVE_ARM_MS, () => {
      if (this.time.now >= this.leaveArmedUntil) this.backButton.setText('出る').setSelected(false);
    });
  }

  // ---- 配置の操作 ----

  private remaining(kind: Kind): number {
    const used = this.list.filter((p) => p.kind === kind).length;
    return (this.roster()[kind] ?? 0) - used;
  }

  private indexAt(cell: Cell): number {
    return this.list.findIndex((p) => p.col === cell.col && p.row === cell.row);
  }

  private inOwnZone(cell: Cell): boolean {
    const z = this.ownZone;
    return cell.col >= z.col && cell.col < z.col + z.width && cell.row >= z.row && cell.row < z.row + z.height;
  }

  private selectKind(kind: Kind): void {
    if (this.locked()) return;
    this.closePopup();
    this.selectedKind = this.selectedKind === kind ? null : kind;
    this.refresh();
  }

  private useTemplate(id: TemplateId): void {
    if (!this.templatesShown() || this.locked()) return;
    this.closePopup();
    this.selectedKind = null;
    const placed = applyTemplate(id, this.roster(), this.ownZone, 0);
    // ひな形の方針のうち、選べないものは兵種の初期設定に直す（対戦ではすべて選べる）
    this.setList(this.pvpMode ? placed : fitStances(this.stage, placed));
    playPlace();
    this.refresh();
  }

  private place(kind: Kind, cell: Cell): void {
    this.setList([...this.list, { kind, col: cell.col, row: cell.row, stance: defaultStance(kind) }]);
    playPlace();
  }

  /** index の部隊を cell へ。そこに別の部隊がいれば入れ替える */
  private moveTo(index: number, cell: Cell): void {
    const list = this.list.map((p) => ({ ...p }));
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
    this.setList(list);
    playPlace();
  }

  private setStance(index: number, stance: Stance): void {
    const list = this.list.map((p) => ({ ...p }));
    const p = list[index];
    if (p && this.stanceOkFor(p.kind, stance)) {
      p.stance = stance;
      this.setList(list);
    }
    playStance();
    this.closePopup();
    this.refresh();
  }

  private removeAt(index: number): void {
    this.setList(this.list.filter((_, i) => i !== index));
    playRemove();
    this.closePopup();
    this.refresh();
  }

  /**
   * 開戦（1人用だけ）。BattleSource はここで作って戦闘の画面へ渡す（戦闘の画面は source の作り方を知らない）。
   * viewer は普段 0。開発用の口からだけ 1 を渡し、陣営1の側から同じ戦いを映して確かめる。
   * myOrders も開発用で、見本の号令を予定に入れて確かめるためのもの。
   */
  private startBattle(viewer: Side = 0, myOrders: StageEnemyOrder[] = []): boolean {
    if (this.pvpMode) return false;
    const stageId = this.stage.id;
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
      onQuit: (battle) => battle.scene.start('Deploy', { stageId }),
      stageId,
    };
    playStart();
    this.scene.start('Battle', data);
    return true;
  }

  // ---- 入力（マウスとタッチを同じに扱う。2本目の指は無視する） ----

  private onDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.press || this.locked()) return;
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
    const p = this.list[press.index];
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
    // タッチのキャンセル（と、引きずる間に確定された場合）は、表示を戻すだけにして、移動も方針の切り替えも確定しない
    if (pointer.wasCanceled || this.locked()) {
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
    const p = this.list[index];
    if (!p) return;
    this.closePopup();
    this.selectedKind = null;
    this.popupIndex = index;
    // 方針の切り替えを出さない面では「外す」だけを出す
    const stances = this.stancesShown() ? STANCES.filter((s) => this.stanceOkFor(p.kind, s)) : [];
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

  /** 中間地帯（両軍の配置エリアのあいだ）の行 */
  private bandRows(): { top: number; bottom: number } {
    const upper = this.ownZone.row < this.otherZone.row ? this.ownZone : this.otherZone;
    const lower = upper === this.ownZone ? this.otherZone : this.ownZone;
    return { top: upper.row + upper.height, bottom: lower.row };
  }

  /** 中間地帯に、1行の文字を箱に入れて出す（ヒントなど） */
  private bandText(text: string, where: 'top' | 'bottom'): void {
    const band = this.bandRows();
    const pos = this.fv.toScreen(this.field.width / 2, where === 'top' ? band.top + 0.75 : band.bottom - 0.75);
    const t = addText(this, 0, 0, text, 16, COLOR.cream).setOrigin(0.5, 0.5);
    const w = Math.ceil(t.width / 2) * 2 + 20;
    const r: Rect = { x: Math.round((pos.x - w / 2) / 2) * 2, y: Math.round(pos.y / 2) * 2 - 14, w, h: 28 };
    drawBox(this.add.graphics(), r);
    t.setPosition(Math.round(r.x + w / 2), r.y + 14);
    this.children.bringToTop(t);
  }

  /** 相手の配置エリアを、2px の斜線で隠す（相手の配置は見えないことを示す） */
  private drawFog(g: Phaser.GameObjects.Graphics, zone: Zone): void {
    const a = this.fv.cellRect(zone.col, zone.row);
    const b = this.fv.cellRect(zone.col + zone.width - 1, zone.row + zone.height - 1);
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x + a.w, b.x + b.w);
    const y1 = Math.max(a.y + a.h, b.y + b.h);
    g.fillStyle(COLOR.panel2, 1);
    for (let y = y0 + 2; y < y1 - 2; y += 2) {
      for (let x = x0 + 2; x < x1 - 2; x += 2) {
        if (((x - x0) / 2 + (y - y0) / 2) % 6 === 0) g.fillRect(x, y, 2, 2);
      }
    }
  }

  private drawCellFrame(g: Phaser.GameObjects.Graphics, r: Rect): void {
    g.fillStyle(COLOR.highlight, 1);
    g.fillRect(r.x, r.y, r.w, 2);
    g.fillRect(r.x, r.y + r.h - 2, r.w, 2);
    g.fillRect(r.x, r.y + 2, 2, r.h - 4);
    g.fillRect(r.x + r.w - 2, r.y + 2, 2, r.h - 4);
  }

  private refresh(announce = true): void {
    if (!this.fv || !this.startButton) return;
    const locked = this.locked();
    if (locked) this.closePopup();
    for (const s of this.ownSprites) s.destroy();
    this.ownSprites = this.list.map((p: Placement, i) => {
      const s = new UnitSprite(this, 0, p.kind, i, this.soldierLayer, this.markLayer);
      const c = this.fv.cellCenter(p.col, p.row);
      const d = this.fv.dirToScreen(0, -1);
      const highlight = i === this.popupIndex || (this.press?.index === i && this.press.dragging);
      // 自軍には方針の印を付ける（押さなくても方針が分かるように。敵と、方針を選べない面には付けない）
      const stance = this.stancesShown() ? p.stance : null;
      s.apply({ x: c.x, y: c.y, dx: d.x, dy: d.y, menRatio: 1, morale: 100, rout: 0, highlight, stance, bounds: this.fv.rect });
      return s;
    });
    if (this.selectedKind && (this.remaining(this.selectedKind) <= 0 || locked)) this.selectedKind = null;
    for (const [kind, b] of this.rosterButtons) {
      const n = this.remaining(kind);
      b.setText(`${KIND_LABEL[kind]}${n}`).setEnabled(n > 0 && !locked).setSelected(this.selectedKind === kind);
    }
    for (const b of this.templateButtons) b.setEnabled(!locked);
    const errors = this.errors(this.list);
    if (this.pvpMode) {
      for (const [kind, b] of this.minusButtons) b.setEnabled(!locked && (pvpLocal.roster[kind] ?? 0) > 0);
      for (const [kind, b] of this.plusButtons) b.setEnabled(this.canAdd(kind));
      this.budgetText?.setText(`残り ${this.budgetLeft()}`);
      // 確定中は「取消」（押すと取り消す）。確定できるのは、検査を通る配置のときだけ
      this.startButton.setText(locked ? '取消' : '完了').setEnabled(locked || errors.length === 0);
    } else {
      this.startButton.setEnabled(errors.length === 0);
    }
    this.updateFormation(announce);
  }

  override update(): void {
    if (!this.pvpMode || !this.infoText || !this.infoBox) return;
    const room = client.room;
    if (!room) return;
    // 残り時間と、相手が確定したかを中間地帯に1行で出す
    const deadline = room.deadlines.setup;
    const left = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - client.serverNow()) / 1000));
    const other = room.seats[room.you === 0 ? 1 : 0];
    const mark = other ? (other.ready ? '相手 確定' : '相手 配置中') : '';
    const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}  ${mark}`;
    if (this.infoText.text === text) return;
    this.infoText.setText(text);
    const band = this.bandRows();
    const pos = this.fv.toScreen(this.field.width / 2, band.top + 0.75);
    const w = Math.ceil(this.infoText.width / 2) * 2 + 20;
    const r: Rect = { x: Math.round((pos.x - w / 2) / 2) * 2, y: Math.round(pos.y / 2) * 2 - 14, w, h: 28 };
    this.infoBox.clear();
    drawBox(this.infoBox, r);
    this.infoText.setPosition(Math.round(r.x + w / 2), r.y + 14);
  }

  /**
   * 陣形名（効果はなく、名前だけ）。配置が変わるたびに調べ、名前が付いたら「鶴翼の陣」のように出す。
   * 新しく名前が付いた瞬間だけ、短い音と、下から 4px 持ち上がる小さな動きを付ける。
   */
  private updateFormation(announce: boolean): void {
    // 配置エリアは「自分が下」なので、陣営0として調べる（対戦の陣営1でも同じ）
    const found = recognizeFormation(this.list, this.ownZone, 0);
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
    const pos = this.fv.toScreen(this.field.width / 2, band.bottom - 0.75);
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
