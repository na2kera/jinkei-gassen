// 配置の画面（design §5.1、§15）。1人用の面（Stage）と、対戦の配置の両方をこのシーンで扱う。
// 手札のカードを盤まで引っぱって離すと置く（カードを押して選んでからマスを押しても置ける）／置いた部隊を引っぱると動く／
// ほかの部隊の上に落とすと入れ替わる／手札の欄まで引っぱると外れる／遊軍の枠とのあいだで出し入れする／
// 置いた部隊を押すと、方針の切り替え（選べるものだけ）と「外す」（本陣には出さない）が出る。本陣は最初から置いてある。
// 離した先ごとの結果は deployModel.ts（Phaser を読まない）が決める。
//   1人用：手持ちは面で決まり、敵の配置が見える。allow に従ってひな形・方針を出し分け、ヒントを出す。
//          配置は session に持ち、変えるたびに面ごとの最後の配置として保存する。
//   対戦：置くたびに予算から引く（兵種ごとの数は持たない。design §15.5）。敵のエリアは見えない（斜線で隠す）。
//          配置は pvpLocal に持ち、変わるたびに下書きを送る（0.5秒に1回まで）。「完了」で確定し、確定中は動かせない。
//          段階の移り変わり（公開へ進むなど）は pvp.ts が決める。このシーンは、届いた room を見て表示を直すだけ。
// どちらも、場所や手持ちの違いは下の「モード」の関数（list・ownZone・cardUsable など）に閉じ込め、操作の作りは共通にする。
// チュートリアル（design §8.6）も1人用の面として開く。操作はどれも tutorialAct を通し、受け付けたものだけを行う。

import {
  defaultStance,
  listTemplates,
  MAX_UNITS,
  PVP_RULES,
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
  type ReserveSetup,
  type Side,
  type Stage,
  type Stance,
  type StageEnemyOrder,
  type StageEnemyView,
  type TemplateId,
  type Terrain,
  type Zone,
  PVP_MAPS,
  TUTORIAL_ARMY,
  TUTORIAL_ORDER_TICK,
  TUTORIAL_STAGE,
  TUTORIAL_STANCE,
  tutorialSetup,
} from '@jinkei/engine';
import Phaser from 'phaser';
import { drawFieldFrame, drawZone } from '../art/field.ts';
import { COLOR, css } from '../art/palette.ts';
import { Forest, Ground, strokeCell } from '../art/stack/ground.ts';
import { fieldHeight } from '../art/stack/height.ts';
import { SquadSprite } from '../art/stack/SquadSprite.ts';
import { stackTextures } from '../art/stack/stackTextures.ts';
import { playFormation, playPlace, playRemove, playStance, playStart } from '../audio/sfx.ts';
import { BoardView, type Cell } from '../battle/BoardView.ts';
import { pickSquad } from '../battle/pick.ts';
import { LocalBattleSource } from '../battle/LocalBattleSource.ts';
import { debug } from '../debug.ts';
import { saveFormation as saveFormationTo, savedFormations as savedFormationList, savedPvpArmy, savedPvpReserve } from '../save.ts';
import { CELL, deployInfo, deployPanel, getLayout, LAYOUT_EVENT, tutorialDeployHead, tutorialLine, type DeployInfoLayout, type DeployPanel, type Rect } from '../layout.ts';
import { client, pvp, pvpLocal, setupKey } from '../net/pvp.ts';
import { reserveAllowed, roomReserve } from '../net/reserveMessages.ts';
import { armyErrors, battleSetup, fitStances, openStage, session, setPlacements, stanceOk } from '../session.ts';
import { Button } from '../ui/Button.ts';
import { Card } from '../ui/Card.ts';
import { addHitObstacle, FIELD_FRAME, padRect } from '../ui/hitRegistry.ts';
import { checkFit } from '../ui/overflow.ts';
import { KIND_LABEL, RESERVE_LABEL, ROSTER_ORDER, STANCE_LABEL } from '../ui/labels.ts';
import { addMuteButton } from '../ui/mute.ts';
import { drawBox, drawFrame } from '../ui/panel.ts';
import { unitBoxAt } from '../ui/unitBox.ts';
import { addText } from '../ui/text.ts';
import { FormationDialog } from '../ui/FormationDialog.ts';
import type { SavedFormation } from '../save.ts';
import type { BattleSceneData } from './BattleScene.ts';
import { enemyAt } from './enemyKind.ts';
import { remainingOf } from './reserveSlot.ts';
import {
  canAdd,
  canSwapReserve,
  DRAG_LIFT,
  dropResult,
  ensureHq,
  hasNonHq,
  isDrag,
  placeable,
  pvpHeadText,
  recallPlan,
  rosterWithoutReserve,
  templatePlacements,
  templateRoster,
  trimToLimits,
  type DragSource,
  type DropResult,
  type DropTarget,
  type PvpLimits,
} from './deployModel.ts';
import { drawStanceIcon } from '../art/icons.ts';
import { holdWake } from '../wake.ts';
import { blinkOn, finishTutorial, setTutorialBattle, tutorialAct } from '../tutorial/run.ts';
import { allowed, apply as applyTutorial, armyOf, armyReady, line, lit, type TutorialAction } from '../tutorial/steps.ts';

/** 地形の名前と効きめ（配置の画面で、マスを押している間だけ1行で出す）。数字は出さず、何に効くかだけを書く */
const TERRAIN_TEXT: Partial<Record<Terrain, string>> = {
  hill: '丘：上が有利。弓が遠くまで届く',
  river: '川：渡る間は遅く、打たれ弱い',
  forest: '森：騎兵が止まる。弓が当たりにくい',
  fence: '柵：正面から崩されにくい',
  wall: '城壁：通れない。弓は越える',
};
const GATE_TEXT = '門：破れば通れる';

/** 縦長で「？」を押したときに、ヒントを出しておく長さ（ミリ秒） */
const HINT_MS = 3000;
/** 陣形を呼び出したときなどの1行の知らせを出しておく長さ（ミリ秒） */
const TOAST_MS = 2500;
/** 敵の部隊を短く押したときも、兵種の名前を出しておく長さ（ミリ秒）。押している間は、これより長くても出したまま */
const KIND_MS = 1000;
/** 遊軍の枠に方針の印を出す、枠の幅の下限（px）。これより狭いと「遊軍 騎兵」の文字に印が触れる */
const RESERVE_ICON_MIN_W = 140;
/** 「出る」を2回押すまでの猶予（ミリ秒） */
const LEAVE_ARM_MS = 2500;

/** 押し始めを覚えたもの（カード・盤の部隊・遊軍の枠。design §15.4） */
interface Press {
  pointerId: number;
  src: DragSource;
  startX: number;
  startY: number;
  /** 最後に見た指の位置（盤を作り直したときに、引っぱっている表示を当て直すため） */
  x: number;
  y: number;
  dragging: boolean;
  /** 盤の部隊なら、押し始めのその部隊（作り直したあとに同じ部隊かを見分ける） */
  unit: Placement | null;
}

export interface DeploySceneData {
  stageId?: string;
  /** 対戦の配置として開く */
  pvp?: boolean;
}

/** 置いた途中の配置として使えない誤り（本陣がない・部隊が足りないのは途中なのでよい） */
const BROKEN: ReadonlySet<ArmyError['code']> = new Set(['invalid_kind', 'invalid_stance', 'invalid_cell', 'out_of_zone', 'overlap', 'over_budget', 'too_many_units']);

/** 手札のカードの並び（本陣のカードは出さない） */
const CARD_ORDER: readonly Kind[] = ROSTER_ORDER.filter((k) => k !== 'hq');
/** 「ここで外す」（design §15.2） */
const REMOVE_LABEL = 'ここで外す';

export class DeployScene extends Phaser.Scene {
  private pvpMode = false;
  /** チュートリアルとして開いたか（design §8.6）。session.tutorial があるときの1人用 */
  private tut = false;
  /** チュートリアルで光らせるマスの枠 */
  private litMarks: Phaser.GameObjects.Graphics | null = null;
  /** 開いている方針の箱の、ボタンごとの方針（「外す」は null） */
  private popupStances: (Stance | null)[] = [];
  private stage!: Stage;
  private field!: Field;
  private ownZone!: Zone;
  private otherZone!: Zone;
  private fv!: BoardView;
  private soldierLayer!: Phaser.GameObjects.Container;
  /** 引っぱっている部隊の層（いつもいちばん手前。design §14.4） */
  private dragLayer!: Phaser.GameObjects.Container;
  private markLayer!: Phaser.GameObjects.Container;
  private ground: Ground | null = null;
  private forest: Forest | null = null;
  private enemySprites: SquadSprite[] = [];
  private popupLayer!: Phaser.GameObjects.Container;
  private dropMark!: Phaser.GameObjects.Graphics;
  private ownSprites: SquadSprite[] = [];
  /** 手札のカード（design §15.3） */
  private cards = new Map<Kind, Card>();
  private panel!: DeployPanel;
  /** 「ここで外す」の枠（盤の部隊・遊軍の枠の部隊を引っぱっている間だけ、手札の場所に出す） */
  private removeBox!: Phaser.GameObjects.Graphics;
  private removeText!: Phaser.GameObjects.Text;
  /** カード・遊軍の枠から引っぱっている間の、その兵種の絵（盤の部隊の一覧には入れない） */
  private ghost: SquadSprite | null = null;
  /** 「開戦」「完了」を、遊軍の枠を出す並びで作ったか（縦長は、枠の有無で幅が変わる） */
  private startWithReserve: boolean | null = null;
  private templateButtons: Button[] = [];
  private startButton: Button | null = null;
  private backButton!: Button;
  private popupButtons: Button[] = [];
  private popupIndex: number | null = null;
  /** 遊軍の枠の箱（方針の切り替えと「外す」）を出しているか */
  private popupReserve = false;
  /** 「遊軍」の枠（design §7.8）。対戦で遊軍を使えない部屋では作らない */
  private reserveButton: Card | null = null;
  /** 枠の中の方針の印 */
  private reserveIcon: Phaser.GameObjects.Graphics | null = null;
  private selectedKind: Kind | null = null;
  private press: Press | null = null;
  private infoLayout: DeployInfoLayout | null = null;
  private hintBox!: Phaser.GameObjects.Graphics;
  private hintUntil = 0;
  private hintShown = false;
  private formationText!: Phaser.GameObjects.Text;
  private formationName: string | null = null;
  private terrainBox!: Phaser.GameObjects.Graphics;
  private terrainText!: Phaser.GameObjects.Text;
  private terrainPointer: number | null = null;
  /** 見えている敵の部隊（stageEnemyVisible の結果。霧のマスの部隊と方針は入らない）。対戦では空 */
  private enemyVisible: StageEnemyView[] = [];
  private kindBox!: Phaser.GameObjects.Graphics;
  private kindText!: Phaser.GameObjects.Text;
  /** 兵種の名前を出させている指（離したら null） */
  private kindPointer: number | null = null;
  /** 押してから KIND_MS たったか */
  private kindExpired = false;
  private kindTimer: Phaser.Time.TimerEvent | null = null;
  private dialog: FormationDialog | null = null;
  private toastUntil = 0;
  private stageIdArg: string | undefined;
  // 対戦だけ
  private budgetText: Phaser.GameObjects.Text | null = null;
  private infoText: Phaser.GameObjects.Text | null = null;
  private leaveArmedUntil = 0;
  private unsubscribe: (() => void)[] = [];

  constructor() {
    super('Deploy');
  }

  init(data: DeploySceneData): void {
    this.stageIdArg = data?.stageId;
    this.pvpMode = data?.pvp === true;
    this.tut = !this.pvpMode && session.tutorial !== null && (this.stageIdArg === undefined || this.stageIdArg === TUTORIAL_STAGE.id);
  }

  create(): void {
    debug.scene = this.pvpMode ? 'PvpDeploy' : 'Deploy';
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    this.ownSprites = [];
    this.cards = new Map();
    this.ghost = null;
    this.startWithReserve = null;
    this.templateButtons = [];
    this.popupButtons = [];
    this.popupStances = [];
    this.popupIndex = null;
    this.popupReserve = false;
    this.reserveButton = null;
    this.startButton = null;
    this.litMarks = null;
    this.reserveIcon = null;
    this.selectedKind = null;
    this.press = null;
    this.formationName = null;
    this.budgetText = null;
    this.infoText = null;
    this.dialog = null;
    this.hintUntil = 0;
    this.hintShown = false;
    this.unsubscribe = [];
    this.leaveArmedUntil = 0;
    this.enemyVisible = [];
    this.kindPointer = null;
    this.kindExpired = false;
    this.kindTimer = null;

    if (this.pvpMode) {
      pvp.arrived('Deploy');
      // 公開の揃いを頼む（配置の時間のうちに焼ける。公開の画面が終わるときに捨てる。design §14.3）
      stackTextures.request('reveal');
      const room = client.room;
      // 部屋の様子がまだない（起きないはず）ときは、pvp.ts が次の room で画面を選び直すので、ここでは何もしない
      if (!room) return;
      // 戦場は「自分が下」の座標で届く。自分の配置エリアは zones[you]（いつも下側）
      this.field = room.field;
      this.ownZone = room.field.zones[room.you];
      this.otherZone = room.field.zones[room.you === 0 ? 1 : 0];
      this.beginPvpSetup();
      // 作り直す前に送れていなかった配置・確定があれば、ここで送る
      pvp.syncSetup();
    } else if (this.tut) {
      // チュートリアル：保存から配置を戻さず、進み具合の置いた部隊をそのまま並べる（design §8.10-1）。遊軍は使わない
      this.stage = TUTORIAL_STAGE;
      session.stageId = TUTORIAL_STAGE.id;
      session.placements = (session.tutorial?.placed ?? []).map((p) => ({ ...p }));
      session.reserve = null;
      this.field = this.stage.field;
      this.ownZone = this.stage.field.zones[0];
      this.otherZone = this.stage.field.zones[1];
    } else {
      // 面を開く（前にこの面で置いた配置があれば戻る）
      this.stage = openStage(this.stageIdArg ?? session.stageId);
      this.field = this.stage.field;
      this.ownZone = this.stage.field.zones[0];
      this.otherZone = this.stage.field.zones[1];
      // 本陣は最初から置いてある。前の配置になければ（本陣を置く前に保存された配置）、初めのマスに足す。
      // 保存は、次に配置を変えたときに書かれる（design §15.6、§15.8）
      session.placements = ensureHq(session.placements, session.reserve, this.field, this.ownZone, MAX_UNITS);
    }

    const field = this.field;
    // 配置の画面は回さない（傾きだけ。縮み 1）。丘があれば、その高さのぶん持ち上がる（design §14.4）
    this.fv = new BoardView(layout.field, field, { hm: fieldHeight(field) });
    // 戦場の描き場所ぜんぶ（と枠 4px）には、ボタンの押せる範囲を広げない。onDown は自軍の配置のほか、
    // 敵と地形の表示も cellAt で受けるため（design §9.9-3）。向きが変わるとシーンごと作り直すので、入れ直さなくてよい
    addHitObstacle(this, padRect(layout.field, FIELD_FRAME));
    drawFieldFrame(this.add.graphics(), this.fv, layout.field);
    const groundLayer = this.add.container(0, 0);
    // 配置エリアは配置の画面だけで見せる。自軍は明るい金、敵軍は暗い色（回さないので、線は軸にそろう）
    const zones = this.add.graphics();
    drawZone(zones, this.fv, this.ownZone, COLOR.gold);
    drawZone(zones, this.fv, this.otherZone, COLOR.dim);
    if (this.pvpMode) this.drawFog(zones, this.otherZone);
    this.soldierLayer = this.add.container(0, 0);
    this.dragLayer = this.add.container(0, 0);
    const fogLayer = this.add.container(0, 0);
    this.markLayer = this.add.container(0, 0);
    // 地面（門は地面に平たく描く。霧は地面と同じ変換の入れ物に入れ、兵の層の上に置く。design §14.1・§14.7）
    const gate = !this.pvpMode && this.stage.gate ? { col: this.stage.gate.col, row: this.stage.gate.row } : null;
    this.ground = new Ground(this, this.fv, field, groundLayer, fogLayer, gate);
    if (!this.pvpMode) this.ground.addFog(this.stage.fog ?? []);
    this.forest = new Forest(this, this.fv, field, this.soldierLayer);
    debug.cellScreen = (c, r) => this.fv.cellCenter(c, r);
    this.enemySprites = [];
    this.dropMark = this.add.graphics();
    if (this.tut) this.litMarks = this.add.graphics();

    if (!this.pvpMode) {
      // 敵の配置は見せる（方針と、霧のマスの部隊は見せない。decisions §8）
      this.enemyVisible = stageEnemyVisible(this.stage);
      this.enemyVisible.forEach((p, i) => {
        this.enemySprites.push(new SquadSprite(this, 1, p.kind, 100 + i, this.soldierLayer, this.markLayer, this.fv, 'deploy'));
      });
      this.applyEnemies();
    }
    // ヒント・対戦の知らせ・陣形名は、戦場の上には重ねない（中間地帯に地形があるため）。
    // 横長は操作の欄の空き、縦長は戦場の下の帯に出す
    const info = deployInfo(layout, this.pvpMode);
    this.infoLayout = info;
    const strip = info.mode === 'strip';
    this.hintBox = this.add.graphics();
    this.infoText = addText(this, info.info.x, info.info.y, '', 16, this.pvpMode ? COLOR.cream : COLOR.muted).setOrigin(0, strip ? 0.5 : 0);
    this.formationText = addText(this, info.formation.x, info.formation.y, '', 16, COLOR.goldHi)
      .setOrigin(strip ? 1 : 0, strip ? 0.5 : 0)
      .setVisible(false);
    if (this.tut) {
      // チュートリアルの指示の一行は、面の手がかりの行に、縦長でも「？」なしでいつも出す（design §8.6、§8.10-7）
      const r = tutorialLine(layout, 'deploy');
      this.infoText.setPosition(r.x, Math.round(r.y + r.h / 2)).setOrigin(0, 0.5).setColor(css(COLOR.cream));
    } else if (!this.pvpMode) {
      if (!strip) this.infoText.setText(this.stage.hint);
      else if (info.hintButton) {
        // 縦長は帯が狭いので、ヒントは「？」を押したときだけ出す
        new Button(this, info.hintButton, '？', () => {
          this.hintUntil = this.time.now + HINT_MS;
        });
      }
    }
    this.popupLayer = this.add.container(0, 0);
    this.terrainBox = this.add.graphics();
    this.terrainText = addText(this, 0, 0, '', 16, COLOR.cream).setOrigin(0.5, 0.5).setVisible(false);
    this.terrainPointer = null;
    // 押した敵の部隊の兵種の名前（戦闘の画面の兵数と士気と同じ箱と文字）
    this.kindBox = this.add.graphics();
    this.kindText = addText(this, 0, 0, '').setVisible(false);

    this.panel = deployPanel(getLayout());
    if (this.pvpMode) this.buildPvpPanel();
    else this.buildStagePanel();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    // 離す出来事が届かないまま、画面が隠れた・フォーカスを失ったら、引っぱりを取り消す（design §15.4）
    const onLost = (): void => this.cancelPress();
    const onVisibility = (): void => {
      if (document.hidden) this.cancelPress();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, onLost);
    this.game.events.on(Phaser.Core.Events.HIDDEN, onLost);
    document.addEventListener('visibilitychange', onVisibility);

    // 向きが変わったら作り直す。対戦では、画面の切り替えとぶつからないよう pvp.ts に頼む
    const onLayout = (): void => {
      if (this.pvpMode) pvp.requestRestart(this, { pvp: true });
      else this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    // 焼いた絵が届いたら描き直す（シーンが終わるときにやめる）
    const offReady = stackTextures.onReady(() => this.onStackReady());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      this.game.events.off(Phaser.Core.Events.BLUR, onLost);
      this.game.events.off(Phaser.Core.Events.HIDDEN, onLost);
      document.removeEventListener('visibilitychange', onVisibility);
      // 引っぱっている途中なら取り消す（絵はシーンと一緒に消える）
      this.press = null;
      this.ghost = null;
      offReady();
      // 対戦の公開の揃いは、公開へ進むときだけ残す（部屋を出る・待機に戻るときは捨てる。公開の画面が終わるときにも捨てる）
      if (this.pvpMode) {
        const phase = client.room?.phase;
        if (phase !== 'reveal' && phase !== 'battle') stackTextures.release('reveal');
      }
      // 地面の絵はテクスチャごと捨てる（作り直すたびに増えないように）
      this.ground?.destroy();
      this.ground = null;
      this.forest = null;
      // 陣形の窓の名前の入力欄（HTML）を残さない
      this.dialog?.close();
      this.kindTimer?.remove();
      this.kindTimer = null;
      for (const u of this.unsubscribe) u();
      debug.applyTemplate = null;
      debug.start = null;
      debug.placeSolution = null;
      debug.startSolution = null;
      debug.formationOps = null;
      debug.reserveOps = null;
      debug.tutorialAct = null;
      debug.tutorialSkip = null;
      debug.deployRects = null;
    });
    debug.deployRects = () => this.debugRects();
    debug.applyTemplate = (id) => this.useTemplate(id);
    debug.start = (viewer) => (this.pvpMode ? this.pressReady() : this.startBattle(viewer));
    debug.formationOps = {
      save: (name, replaceIndex) => {
        const z = this.ownZone;
        const units = this.list.map((p) => ({ kind: p.kind, stance: p.stance, col: p.col - z.col, row: p.row - z.row }));
        const reserve = this.reserve;
        return saveFormationTo({ name, width: z.width, units, ...(reserve ? { reserve: { ...reserve } } : {}) }, replaceIndex);
      },
      recall: (name) => {
        const f = savedFormationList().find((x) => x.name === name);
        if (!f) return false;
        this.recallFormation(f);
        return true;
      },
    };
    if (this.tut) {
      debug.tutorialAct = (a) => this.tutorialInput(a);
      debug.tutorialSkip = () => finishTutorial(this);
    }
    if (!this.pvpMode && !this.tut) {
      debug.placeSolution = () => {
        this.closePopup();
        // 見本は遊軍を使わないので、枠は空にする
        setPlacements(this.stage.solution.map((p) => ({ ...p })), null);
        this.refresh();
      };
      debug.startSolution = () => {
        setPlacements(this.stage.solution.map((p) => ({ ...p })), null);
        return this.startBattle(0, this.stage.solutionOrders ?? []);
      };
    }
    debug.reserveOps = {
      get: () => (this.reserve ? { ...this.reserve } : null),
      put: (kind) => {
        // 枠が空なら、その兵種を選んで枠を押す（画面の操作と同じ）。入れられなければ、最後に置いたその兵種を
        // 戦場から枠へ移す（確かめる手間を省くため。盤の部隊を枠へ引っぱるのと同じ結果）
        if (!this.reserve && this.cardUsable(kind)) {
          this.selectedKind = kind;
          this.pressReserve();
        }
        if (!this.reserve || this.reserve.kind !== kind) {
          const i = this.list.map((p) => p.kind).lastIndexOf(kind);
          if (i >= 0) this.applyDrop(dropResult({ type: 'unit', index: i }, { type: 'reserve' }, this.dropContext()));
        }
        return this.reserve !== null && this.reserve.kind === kind;
      },
      tap: () => this.pressReserve(),
    };

    // 開いた時点の陣形名は、音や動きなしで出す
    this.refresh(false);
    if (this.tut) this.restoreTutorial();
  }

  // ---- チュートリアル（design §8.6、§8.10） ----

  /**
   * 作り直したあと（向きが変わったとき）に、進み具合どおりの見た目に戻す。
   * 方針の箱を開く処理は選んでいる兵種を消すので、兵種を戻すのは箱を開いたあと（design §8.10-1）
   */
  private restoreTutorial(): void {
    const run = session.tutorial;
    if (!run) return;
    if (run.step === 'pickStance') {
      const u = TUTORIAL_ARMY[TUTORIAL_STANCE.index]!;
      const i = this.indexAt(u);
      if (i >= 0) this.openPopup(i);
    }
    this.selectedKind = run.picked;
    this.refresh(false);
  }

  /** チュートリアルで、戦場を押した（ボタンの上でないとき） */
  private tutorialDown(pointer: Phaser.Input.Pointer): void {
    // 方針の箱が開いていれば、箱の外を押したので閉じる。閉じるのと手順を戻すのは、同じ道筋で起こす（design §8.10-2）
    if (this.popupIndex !== null) {
      this.dismissTutorialPopup();
      return;
    }
    const cell = this.pressCell(pointer.x, pointer.y);
    // 自分のエリアの外（地形・敵の兵種の名前）は出さない。表にない操作は何も起こさない
    if (!cell || !this.inOwnZone(cell)) return;
    const index = this.indexAt(cell);
    if (index >= 0) {
      // 部隊は、離したときに押したとみなす（引きずって動かすことはできない）
      this.beginPress(pointer, { type: 'unit', index });
      return;
    }
    this.tutorialCell(cell);
  }

  /** 空いたマスを押した：受け付けるなら、選んでいる兵種を置く */
  private tutorialCell(cell: Cell): void {
    const kind = this.selectedKind;
    if (!kind || this.remaining(kind) <= 0 || this.indexAt(cell) >= 0) return;
    if (!tutorialAct({ type: 'cell', col: cell.col, row: cell.row })) return;
    this.place(kind, cell);
    this.selectedKind = session.tutorial?.picked ?? null;
    this.refresh();
  }

  /** 置いた部隊を押した：受け付けるなら、方針の箱を開く */
  private tutorialUnit(index: number): void {
    const p = this.list[index];
    if (!p || !tutorialAct({ type: 'unit', col: p.col, row: p.row })) return;
    this.openPopup(index);
  }

  private dismissTutorialPopup(): void {
    if (!tutorialAct({ type: 'dismissStance' })) return;
    this.closePopup();
    this.refresh();
  }

  /** 開発用の口：TutorialAction を、画面の操作と同じ道筋で当てはめる。受け付けたら true */
  private tutorialInput(a: TutorialAction): boolean {
    const before = session.tutorial;
    if (!before) return false;
    switch (a.type) {
      case 'pickKind':
        if (this.cards.has(a.kind)) this.selectKind(a.kind);
        break;
      case 'cell':
        if (this.popupIndex !== null) this.dismissTutorialPopup();
        else if (this.inOwnZone(a) && this.indexAt(a) < 0) this.tutorialCell(a);
        break;
      case 'unit': {
        if (this.popupIndex !== null) {
          this.dismissTutorialPopup();
          break;
        }
        const i = this.indexAt(a);
        if (i >= 0) this.tutorialUnit(i);
        break;
      }
      case 'stance':
        if (this.popupIndex !== null && this.popupStances.includes(a.stance)) this.choosePopup(this.popupIndex, a.stance);
        break;
      case 'dismissStance':
        if (this.popupIndex !== null) this.dismissTutorialPopup();
        break;
      case 'start':
        this.startBattle();
        break;
      default:
        break;
    }
    return session.tutorial !== before;
  }

  /** チュートリアルの開戦。tutorialSetup() をそのまま使い、置いた配置が TUTORIAL_ARMY と一致することを確かめてから戦いを作る（design §8.4） */
  private startTutorialBattle(): boolean {
    const run = session.tutorial;
    if (!run || !allowed(run, { type: 'start' })) return false;
    if (!armyReady(run)) {
      // 手順の作りの誤り。開戦しない
      console.error('チュートリアルの配置が TUTORIAL_ARMY と合わない', armyOf(run));
      return false;
    }
    const made = LocalBattleSource.create(tutorialSetup(), 0);
    if (!made.ok) {
      console.error('createBattle に失敗', made.error);
      return false;
    }
    tutorialAct({ type: 'start' });
    const source = made.source;
    setTutorialBattle(source);
    // 止まったら進み具合を進める（シーンではなく session.tutorial を進める。戦闘の画面は毎フレームそれを見て直す）
    source.pauseAt(TUTORIAL_ORDER_TICK, () => {
      tutorialAct({ type: 'paused' });
    });
    const data: BattleSceneData = {
      source,
      field: this.stage.field,
      viewer: 0,
      orders: true,
      onQuit: (battle) => finishTutorial(battle),
      // 決着の表示を出し終えたら、結果の画面へは行かず、最後の一言へ進む
      onFinished: () => {
        tutorialAct({ type: 'ended' });
      },
      stageId: TUTORIAL_STAGE.id,
      survive: false,
      tutorial: true,
    };
    playStart();
    // 押した流れの中で、画面を消さないように頼む（scene.start は予約なので、戦闘の画面が始まってからでは Safari が断る。design §9.9-7）
    holdWake('battle');
    this.scene.start('Battle', data);
    return true;
  }

  /** 毎フレーム：指示の一行と、目立たせるものの点滅（0.5 秒ごと） */
  private updateTutorial(): void {
    const run = session.tutorial;
    if (!run || !this.infoText) return;
    const text = line(run);
    if (this.infoText.text !== text) {
      this.infoText.setText(text);
      const r = tutorialLine(getLayout(), 'deploy');
      checkFit(this.scene.key, text, this.infoText.width, this.infoText.height, r.w + 8, r.h + 4);
    }
    const on = blinkOn(this.time.now);
    const l = lit(run);
    for (const [kind, b] of this.cards) b.setSelected(this.selectedKind === kind || (on && l.kinds.includes(kind)));
    // 主のボタン（開戦）は、主の見た目とふつうのボタンの見た目を入れ替える（選択中の見た目は主の見た目と同じなので）
    this.startButton?.setPrimary(!l.start || on);
    // 方針の箱は、受け付ける方針だけが押せる見た目で、それだけを点滅させる
    this.popupButtons.forEach((b, i) => {
      const st = this.popupStances[i] ?? null;
      b.setSelected(on && st !== null && l.stances.includes(st));
    });
    const g = this.litMarks;
    if (g) {
      g.clear();
      if (on) for (const c of l.cells) strokeCell(g, this.fv, c.col, c.row, COLOR.highlight);
    }
  }

  private buildStagePanel(): void {
    const stage = this.stage;
    const panel = this.panel;
    // チュートリアルは「戻る」の場所に、幅を広げた「飛ばす」（確かめずに抜け、済んだ扱いにする）。面の名前はそのぶん右へ
    const head = this.tut ? tutorialDeployHead(getLayout()) : { back: panel.back, name: panel.name };
    this.backButton = this.tut
      ? new Button(this, head.back, '飛ばす', () => finishTutorial(this))
      : new Button(this, panel.back, '戻る', () => this.scene.start('StageSelect'));
    // チュートリアルは面の id を付けない
    const name = addText(this, head.name.x, head.name.y, this.tut ? stage.name : `${stage.id} ${stage.name}`, 16, COLOR.goldHi).setOrigin(0, 0.5);
    // 面の名前が「音あり」に重ならないか（開発時だけ記録）
    checkFit(this.scene.key, name.text, name.width, name.height, panel.mute.x - 6 - head.name.x + 8, 40);
    addMuteButton(this, panel.mute);
    // 手札は、その面にある兵種だけを並べる（ない兵種のカードは出さず、左に詰める）
    this.addCards(CARD_ORDER.filter((k) => (stage.roster[k] ?? 0) > 0));
    if (this.templatesShown()) {
      this.addTemplateButtons(panel.templates);
      // 陣形の保存と呼び出しは、ひな形と同じ並びに置き、ひな形を出さない面では出さない
      this.templateButtons.push(new Button(this, panel.formations, '陣形', () => this.openFormations()));
    }
    this.addRemoveBox();
  }

  private buildPvpPanel(): void {
    const panel = this.panel;
    this.backButton = new Button(this, panel.back, '出る', () => this.pressLeave());
    // 見出しのまん中に「予算 16/24 部隊 8/11」（design §15.5）
    this.budgetText = addText(this, panel.name.x, panel.name.y, '', 16, COLOR.goldHi).setOrigin(0, 0.5);
    addMuteButton(this, panel.mute);
    this.addCards(CARD_ORDER);
    this.addTemplateButtons(panel.templates);
    this.templateButtons.push(new Button(this, panel.formations, '陣形', () => this.openFormations()));
    this.addRemoveBox();
    // 部屋の様子（自分と相手の確定・期限）が変わったら、ボタンと表示を直す
    this.unsubscribe.push(client.subscribe(() => this.refresh(false)));
  }

  /** 手札のカード。押し始めをこのシーンに渡し、押したのか引っぱったのかは onMove・onUp で決める（design §15.3） */
  private addCards(kinds: readonly Kind[]): void {
    kinds.forEach((kind, i) => {
      const r = this.panel.cards[i];
      if (!r) return;
      this.cards.set(kind, new Card(this, r, KIND_LABEL[kind], '', (pointer) => this.downCard(kind, pointer)));
    });
  }

  /** 「ここで外す」の枠（ふだんは隠す） */
  private addRemoveBox(): void {
    const h = this.panel.hand;
    this.removeBox = this.add.graphics().setVisible(false);
    this.removeText = addText(this, Math.round(h.x + h.w / 2), Math.round(h.y + h.h / 2), REMOVE_LABEL).setOrigin(0.5, 0.5).setVisible(false);
  }

  /** 「開戦」「完了」を作る（縦長は、遊軍の枠を出すかで幅が変わるので、変わったら作り直す） */
  private syncStartButton(withReserve: boolean): void {
    if (this.startButton && this.startWithReserve === withReserve) return;
    this.startButton?.destroy();
    this.startWithReserve = withReserve;
    const r = withReserve ? this.panel.start : this.panel.startFull;
    this.startButton = this.pvpMode
      ? new Button(this, r, '完了', () => this.pressReady(), { primary: true })
      : new Button(this, r, '開戦', () => this.startBattle(), { primary: true });
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

  /** 遊軍の枠の部隊（なければ null） */
  private get reserve(): ReserveSetup | null {
    return this.pvpMode ? pvpLocal.reserve : session.reserve;
  }

  /** 配置を変える（遊軍はいまのまま） */
  private setList(list: Placement[]): void {
    this.setDeploy(list, this.reserve);
  }

  /** 配置と遊軍を一組で変える（保存も下書きも、組で扱う。design §7.7） */
  private setDeploy(list: Placement[], reserve: ReserveSetup | null): void {
    if (this.pvpMode) {
      pvpLocal.placements = list;
      pvpLocal.reserve = reserve;
      pvp.markDraft();
    } else {
      setPlacements(list, reserve);
    }
  }

  /** 遊軍の枠を出すか。対戦では、遊軍を使える部屋（rules.reserve）だけ */
  private reserveShown(): boolean {
    // チュートリアルでは出さない（design §8.10-9）
    return this.pvpMode ? reserveAllowed(client.room) : !this.tut;
  }

  /** 対戦の予算と部隊数の決まり（通信で届く rules。届いていなければ engine の決まり） */
  private limits(): PvpLimits {
    const rules = client.room?.rules;
    return { budget: rules?.budget ?? PVP_RULES.budget, costs: rules?.costs ?? PVP_RULES.costs, maxUnits: rules?.maxUnits ?? PVP_RULES.maxUnits };
  }

  /**
   * そのカードを使えるか（明るい・引っぱれる・押して選べる。design §15.3）。
   * 対戦は、盤に足せるか遊軍と入れ替えられるか。一人用は残りが 1 以上。チュートリアルは、その手順で選べる兵種だけ
   */
  private cardUsable(kind: Kind): boolean {
    if (this.locked()) return false;
    if (this.pvpMode) return canAdd(kind, this.list, this.reserve, this.limits()) || canSwapReserve(kind, this.list, this.reserve, this.limits(), this.reserveShown());
    if (this.remaining(kind) <= 0) return false;
    const run = this.tut ? session.tutorial : null;
    return !run || allowed(run, { type: 'pickKind', kind });
  }

  /** 離した先ごとの結果を決めるための、いまの様子（design §15.4） */
  private dropContext(): Parameters<typeof dropResult>[2] {
    const run = this.tut ? session.tutorial : null;
    return {
      list: this.list,
      reserve: this.reserve,
      reserveShown: this.reserveShown(),
      canPlace: (c) => placeable(this.field, this.ownZone, c),
      stanceOk: (k, st) => this.stanceOkFor(k, st),
      check: (list, reserve) => this.errorsWith(list, reserve),
      // チュートリアル：歩兵のカードを光るマスへ離す操作だけ（兵種を選んでからマスを押すのと同じ 2 つの操作として調べる）
      ...(run
        ? {
            allow: (src: DragSource, t: DropTarget): boolean =>
              src.type === 'card' && t.type === 'cell' && allowed(run, { type: 'pickKind', kind: src.kind }) && allowed(applyTutorial(run, { type: 'pickKind', kind: src.kind }), { type: 'cell', col: t.col, row: t.row }),
          }
        : {}),
    };
  }

  private stanceOkFor(kind: Kind, stance: Stance): boolean {
    // 知らない方針（壊れた保存など）は、どの兵種にも許さない。読み込みの検査でも捨てているが、二重の守りとして見る
    if (!STANCES.includes(stance)) return false;
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
    return this.errorsWith(list, this.reserve);
  }

  private errorsWith(list: Placement[], reserve: ReserveSetup | null): ArmyError[] {
    // 遊軍も、手持ち・部隊数・予算に含めて数える（design §7.6）
    return this.pvpMode ? validateArmy(list, this.ownZone, { ...pvpArmyLimits(), reserve }) : armyErrors(list, reserve);
  }

  /**
   * 対戦で、自分が確定している間は配置を動かせない。
   * 確定・取り消しを押してまだ届いていない間は、押した側の状態とみなす（押したのに動かせる、をなくす）
   */
  private locked(): boolean {
    if (!this.pvpMode) return false;
    if (pvpLocal.wantReady !== null) return pvpLocal.wantReady;
    const room = client.room;
    return !!room && room.seats[room.you]?.ready === true;
  }

  // ---- 対戦の配置と下書き ----

  /**
   * 配置の段階に入ったときの始め方（戦いが変わった・読み込み直した・出て入り直したとき）。
   *   1. サーバーの myArmy（その配置の段階でサーバーが覚えている、最後に検査を通った下書き。部隊を全部外していれば本陣だけ）があれば、それを出す
   *   2. なければ、手元の最後の配置（覚えている配置、なければ保存した配置）を出し、本陣以外の部隊か遊軍があれば「まだ送っていない」印を立てて送る
   *   どれもなければ、本陣だけの盤から始める（本陣だけの盤では下書きを送らない。design §15.5）
   * サーバーは新しい配置の段階に入ると下書きを消すので、2 がないと、読み込み直した人の配置が空になる
   */
  private beginPvpSetup(): void {
    const room = client.room;
    // 配置の段階の room だけで始める（待機の room で印を付けると、待機に戻ったときに捨てた印を付け直してしまう。design §11.5-1）
    if (!room || room.phase !== 'setup' || pvpLocal.setupFor === setupKey(room)) return;
    pvpLocal.setupFor = setupKey(room);
    const fromServer = room.myArmy !== null && room.myArmy.length > 0;
    // 配置と遊軍は一組で選ぶ（サーバーの配置に手元の遊軍を付ける、のように混ぜない。design §7.7）
    const local = pvpLocal.placements.length > 0 ? { army: pvpLocal.placements, reserve: pvpLocal.reserve } : { army: savedPvpArmy(), reserve: savedPvpReserve() };
    const base = fromServer && room.myArmy ? { army: room.myArmy, reserve: roomReserve(room) } : local;
    // 遊軍を使えない部屋では、遊軍を外す
    const reserve = reserveAllowed(room) ? base.reserve : null;
    const broken = (r: ReserveSetup | null): boolean => validateArmy(base.army, this.ownZone, { ...pvpArmyLimits(), reserve: r }).some((e) => BROKEN.has(e.code));
    const ok = !broken(null);
    // 遊軍は、配置と一緒に検査を通るときだけ残す（予算を超えるなどしたら、遊軍だけを外す）
    pvpLocal.reserve = ok && reserve && !broken(reserve) ? { ...reserve } : null;
    // 本陣は最初から置いてある（本陣のない配置には足す。design §15.6）
    pvpLocal.placements = ensureHq(ok ? base.army : [], pvpLocal.reserve, this.field, this.ownZone, this.limits().maxUnits + 1);
    // サーバーにない配置を出したときだけ、送る印を立てる（本陣だけの盤では送らない）
    if (!fromServer && (hasNonHq(pvpLocal.placements) || pvpLocal.reserve !== null)) pvp.markDraft();
  }

  /** 「完了」で確定し、確定中にもう一度押すと取り消す。届くまでの送り直しは pvp.ts が受け持つ */
  private pressReady(): boolean {
    if (this.locked()) {
      pvp.setReady(false);
      this.refresh(false);
      return true;
    }
    if (this.errors(this.list).length > 0) return false;
    playStart();
    pvp.setReady(true);
    this.refresh(false);
    return true;
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

  /** 1人用の、まだ置いていない数（戦場と遊軍の枠の両方を引く）。対戦では数を持たない */
  private remaining(kind: Kind): number {
    return this.pvpMode ? 0 : remainingOf(this.stage.roster, this.list, this.reserve, kind);
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
    if (this.tut) {
      // 受け付けるかを、箱を閉じるより先に決める（受け付けなければ何も変えない）。選び直しても外れない
      if (!tutorialAct({ type: 'pickKind', kind })) return;
      this.closePopup();
      this.selectedKind = kind;
      this.refresh();
      return;
    }
    this.closePopup();
    this.selectedKind = this.selectedKind === kind ? null : kind;
    this.refresh();
  }

  /**
   * ひな形：いま盤に置いている部隊（本陣を含む）を、その形に並べ替える。兵種と数は変えず、遊軍の枠も空に戻さない。
   * 盤に本陣しかないときは、対戦は標準の編成、一人用は手持ちの全部（遊軍の枠の 1 つを除く）を並べる（design §15.6）
   */
  private useTemplate(id: TemplateId): void {
    if (!this.templatesShown() || this.locked()) return;
    this.closePopup();
    this.selectedKind = null;
    const reserve = this.reserve;
    const fallback = this.pvpMode ? (client.room?.rules.standardRoster ?? PVP_RULES.standardRoster) : rosterWithoutReserve(this.stage.roster, reserve);
    let placements = templatePlacements(id, templateRoster(this.list, fallback), this.ownZone);
    let trimmed = false;
    if (this.pvpMode) {
      // 標準の編成と遊軍を合わせて予算か部隊数を超えるなら、並べた部隊を後ろから外して収める
      const t = trimToLimits(placements, reserve, this.limits());
      placements = t.list;
      trimmed = t.trimmed;
    } else {
      // ひな形の方針のうち、選べないものは兵種の初期設定に直す（対戦ではすべて選べる）
      placements = fitStances(this.stage, placements);
    }
    this.setDeploy(placements, reserve);
    playPlace();
    this.refresh();
    if (trimmed) this.showToast('予算に合わせて部隊を外しました');
  }

  /** 離した先の結果を当てる（変えたら音を鳴らし、表示を直す）。変えたら true */
  private applyDrop(r: DropResult): boolean {
    if (r.type !== 'apply') return false;
    this.setDeploy(r.list, r.reserve);
    if (r.sound === 'remove') playRemove();
    else playPlace();
    this.closePopup();
    this.refresh();
    return true;
  }

  /** 空いたマスに、選んでいる兵種を置く（チュートリアル。手順の検査は済んでいる） */
  private place(kind: Kind, cell: Cell): void {
    this.setList([...this.list, { kind, col: cell.col, row: cell.row, stance: defaultStance(kind) }]);
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
    if (this.tut) return this.startTutorialBattle();
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
      ...(this.stage.fog && this.stage.fog.length > 0 ? { fog: this.stage.fog } : {}),
      survive: this.stage.win.type === 'survive',
    };
    playStart();
    // 押した流れの中で、画面を消さないように頼む（design §9.9-7）
    holdWake('battle');
    this.scene.start('Battle', data);
    return true;
  }

  // ---- 陣形の保存と呼び出し（design §5.6） ----

  private openFormations(): void {
    if (this.dialog || this.locked()) return;
    this.closePopup();
    this.selectedKind = null;
    this.refresh(false);
    this.dialog = new FormationDialog(this, getLayout(), {
      current: () => {
        if (this.list.length === 0) return null;
        const z = this.ownZone;
        return this.list.map((p) => ({ kind: p.kind, stance: p.stance, col: p.col - z.col, row: p.row - z.row }));
      },
      zoneWidth: () => this.ownZone.width,
      reserve: () => (this.reserve ? { ...this.reserve } : null),
      recall: (f) => this.recallFormation(f),
    }, () => {
      this.dialog = null;
    });
  }

  /**
   * 呼び出した陣形を置く（design §15.6）。保存した順に置いていき、配置エリアの外・置けないマス（城壁）・重なるマスの部隊は飛ばす。
   * 選べない方針は兵種の初期設定に直す。本陣がなければ、いまの本陣を補う。
   * 対戦は予算と部隊数を超えるあいだ、遊軍 → 後ろの部隊の順に外す。一人用は手持ちを超える部隊を除く（手持ちが余っても足さない）
   */
  private recallFormation(f: SavedFormation): void {
    if (this.locked()) return;
    const plan = recallPlan({
      units: f.units,
      reserve: f.reserve,
      field: this.field,
      zone: this.ownZone,
      reserveShown: this.reserveShown(),
      stanceOk: (k, st) => this.stanceOkFor(k, st),
      currentHq: this.list.find((p) => p.kind === 'hq') ?? null,
      ...(this.pvpMode ? { pvp: this.limits() } : { roster: this.stage.roster }),
      check: (list, reserve) => this.errorsWith(list, reserve),
    });
    // 結果の組が検査を通らなければ（起きないはず）、配置を変えない
    if (!plan.ok) return;
    this.setDeploy(plan.list, plan.reserve);
    playPlace();
    this.refresh();
    if (plan.skipped) this.showToast('置けない部隊を除きました');
    else if (plan.trimmed) this.showToast('予算に合わせて部隊を外しました');
  }

  /** 1行の知らせを、戦場の上の端に少しのあいだ出す（地形の説明と同じ場所） */
  private showToast(text: string): void {
    this.toastUntil = this.time.now + TOAST_MS;
    this.terrainPointer = null;
    this.terrainText.setText(text).setVisible(true);
    const w = Math.ceil(this.terrainText.width / 2) * 2 + 20;
    const f = this.fv.rect;
    const area = getLayout().field;
    const r: Rect = { x: Math.round((area.x + area.w / 2 - w / 2) / 2) * 2, y: f.y + 8, w, h: 28 };
    this.terrainBox.clear();
    drawBox(this.terrainBox, r);
    this.terrainText.setPosition(Math.round(r.x + w / 2), r.y + 14);
    this.children.bringToTop(this.terrainBox);
    this.children.bringToTop(this.terrainText);
    this.time.delayedCall(TOAST_MS, () => {
      if (this.time.now >= this.toastUntil && this.terrainPointer === null) this.hideTerrain();
    });
  }

  // ---- 入力（マウスとタッチを同じに扱う。2本目の指は無視する） ----

  private onDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.press || this.locked() || this.dialog) return;
    // 前に出した敵の兵種は、どこを押しても消す（敵の部隊を押したなら、下で新しいほうを出す）
    this.hideKind();
    // ボタンの上は、ボタンが受け持つ
    if (over.length > 0) return;
    if (this.tut) {
      this.tutorialDown(pointer);
      return;
    }
    const hadPopup = this.popupIndex !== null || this.popupReserve;
    this.closePopup();
    const cell = this.pressCell(pointer.x, pointer.y);
    if (!cell || !this.inOwnZone(cell)) {
      // 自分のエリアの外：押している間だけ、そのマスの地形を1行で出す
      // 見えている敵の部隊なら、その上に兵種の名前も出す（地形の1行とは別に出す）
      if (cell) {
        this.showTerrain(pointer.id, cell);
        this.showKind(pointer.id, cell);
      }
      if (hadPopup) this.refresh();
      return;
    }
    const index = this.indexAt(cell);
    if (index >= 0) {
      // 部隊のいるマスでは、部隊の操作（方針の切り替え・引っぱる）を優先する
      this.beginPress(pointer, { type: 'unit', index });
    } else if (!hadPopup && this.selectedKind && this.cardUsable(this.selectedKind)) {
      // 押して選ぶ置き方：カードを選んでいる間に空いたマスを押すと置く（カードをそのマスへ離したのと同じ検査を通す）
      const r = dropResult({ type: 'card', kind: this.selectedKind }, { type: 'cell', col: cell.col, row: cell.row }, this.dropContext());
      if (this.applyDrop(r)) return;
      this.showTerrain(pointer.id, cell);
    } else {
      this.showTerrain(pointer.id, cell);
    }
    this.refresh();
  }

  /** 押している間だけ、マスの地形の名前と効きめを1行で出す（平地では出さない） */
  private showTerrain(pointerId: number, cell: Cell): void {
    const t = this.field.terrain[cell.row * this.field.width + cell.col] ?? 'plain';
    const gate = !this.pvpMode && this.stage.gate && this.stage.gate.col === cell.col && this.stage.gate.row === cell.row;
    const text = gate ? GATE_TEXT : TERRAIN_TEXT[t];
    if (!text) return;
    this.terrainPointer = pointerId;
    this.terrainText.setText(text).setVisible(true);
    const w = Math.ceil(this.terrainText.width / 2) * 2 + 20;
    const f = this.fv.rect;
    const r: Rect = { x: Math.round((f.x + f.w / 2 - w / 2) / 2) * 2, y: f.y + 8, w, h: 28 };
    this.terrainBox.clear();
    drawBox(this.terrainBox, r);
    this.terrainText.setPosition(Math.round(r.x + w / 2), r.y + 14);
    this.children.bringToTop(this.terrainBox);
    this.children.bringToTop(this.terrainText);
  }

  /** 見えている敵の部隊を押したら、その部隊の上に兵種の名前を出す。押している間と、押してから KIND_MS の間は出したまま */
  private showKind(pointerId: number, cell: Cell): void {
    const e = enemyAt(this.enemyVisible, cell);
    if (!e) return;
    this.hideKind();
    this.kindPointer = pointerId;
    this.kindExpired = false;
    this.kindTimer = this.time.delayedCall(KIND_MS, () => {
      this.kindTimer = null;
      this.kindExpired = true;
      if (this.kindPointer === null) this.hideKind();
    });
    const text = KIND_LABEL[e.kind];
    if (this.kindText.text !== text) this.kindText.setText(text);
    // 箱の作りと置き方は、戦闘の画面の兵数と士気（BattleScene の drawInfo）と同じ
    const w = Math.ceil(this.kindText.width / 2) * 2 + 16;
    const h = Math.ceil(this.kindText.height / 2) * 2 + 12;
    // 部隊の上に出す高さは、その部隊のいま見えている兵の矩形のいちばん上の端（design §14.9）
    const c = this.fv.cellCenter(e.col, e.row);
    const sprite = this.enemySprites[this.enemyVisible.indexOf(e)];
    const top = sprite?.topY();
    const { x, y } = unitBoxAt(this.fv.uiBounds(getLayout().field), c, w, h, top !== null && top !== undefined ? Math.max(0, c.y - top) + 2 : 34);
    this.kindBox.clear();
    drawBox(this.kindBox, { x, y, w, h });
    this.kindText.setPosition(x + 8, y + 6).setVisible(true);
    // 地形の1行と重なるときは、押した部隊の兵種を上にする
    this.children.bringToTop(this.kindBox);
    this.children.bringToTop(this.kindText);
  }

  private hideKind(): void {
    this.kindTimer?.remove();
    this.kindTimer = null;
    this.kindPointer = null;
    this.kindExpired = false;
    this.kindBox.clear();
    this.kindText.setVisible(false);
  }

  private hideTerrain(): void {
    this.terrainPointer = null;
    this.terrainBox.clear();
    this.terrainText.setVisible(false);
  }

  // ---- 引っぱる操作（design §15.4） ----

  /** 押し始めを覚える */
  private beginPress(pointer: Phaser.Input.Pointer, src: DragSource): void {
    const unit = src.type === 'unit' ? this.list[src.index] : undefined;
    this.press = { pointerId: pointer.id, src, startX: pointer.x, startY: pointer.y, x: pointer.x, y: pointer.y, dragging: false, unit: unit ? { ...unit } : null };
  }

  /** 押し始めを受け付けるか（暗いカード・「完了」のあと・ダイアログの間・別の指を覚えている間は受け付けない） */
  private canPress(): boolean {
    return !this.press && !this.locked() && !this.dialog;
  }

  /** カードの押し始め */
  private downCard(kind: Kind, pointer: Phaser.Input.Pointer): void {
    if (!this.canPress()) return;
    const card = this.cards.get(kind);
    if (!card?.isEnabled) return;
    this.hideKind();
    this.beginPress(pointer, { type: 'card', kind });
  }

  /** 遊軍の枠の押し始め（動かさずに離したら、いまの pressReserve） */
  private downReserve(pointer: Phaser.Input.Pointer): void {
    if (!this.canPress() || !this.reserveButton?.isEnabled) return;
    this.hideKind();
    this.beginPress(pointer, { type: 'reserve' });
  }

  /** 引っぱり始められる元か（チュートリアルは歩兵のカードだけ。枠は部隊がいるときだけ） */
  private canDrag(src: DragSource): boolean {
    if (this.tut) return src.type === 'card';
    if (src.type === 'reserve') return this.reserve !== null;
    return true;
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const press = this.press;
    if (!press || pointer.id !== press.pointerId) return;
    press.x = pointer.x;
    press.y = pointer.y;
    if (!this.canDrag(press.src)) return;
    if (!press.dragging) {
      if (!isDrag(false, press.startX, press.startY, pointer.x, pointer.y)) return;
      this.startDrag(press);
    }
    this.showDrag();
  }

  /** 引っぱり始めた：方針の箱を閉じ、絵をいちばん手前の層へ、「ここで外す」を出す */
  private startDrag(press: Press): void {
    press.dragging = true;
    this.hideTerrain();
    if (this.popupIndex !== null || this.popupReserve) {
      this.closePopup();
      this.refresh(false);
    }
    const src = press.src;
    if (src.type === 'card' || src.type === 'reserve') {
      const kind = src.type === 'card' ? src.kind : this.reserve?.kind;
      if (kind) this.ghost = new SquadSprite(this, 0, kind, 999, this.dragLayer, this.markLayer, this.fv, 'deploy');
    }
    // 盤の部隊（本陣を除く）か遊軍の枠の部隊を引っぱっている間は、手札の場所に「ここで外す」を出す
    const removable = (src.type === 'unit' && press.unit?.kind !== 'hq') || src.type === 'reserve';
    this.setRemoveShown(removable);
  }

  private setRemoveShown(v: boolean): void {
    for (const c of this.cards.values()) c.setVisible(!v);
    this.removeBox.setVisible(v);
    this.removeText.setVisible(v);
    if (v) this.drawRemove(false);
  }

  private drawRemove(hot: boolean): void {
    this.removeBox.clear();
    drawFrame(this.removeBox, this.panel.hand, hot ? 'solid' : 'line');
    this.removeText.setColor(css(hot ? COLOR.ink : COLOR.cream));
    this.children.bringToTop(this.removeBox);
    this.children.bringToTop(this.removeText);
  }

  /** 見えている矩形（広げる前）の上か */
  private static within(r: Rect, x: number, y: number): boolean {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }

  /**
   * 離す先。手札の欄と遊軍の枠は、指の場所そのもので決め、盤より先に取る。
   * 盤のマスは、絵の足もと（指の 24px 上）で、地面から求める（兵の絵には吸わせない）
   */
  private dropTarget(x: number, y: number): DropTarget {
    if (DeployScene.within(this.panel.hand, x, y)) return { type: 'hand' };
    const slot = this.reserveButton?.rect;
    if (slot && DeployScene.within(slot, x, y)) return { type: 'reserve' };
    const cell = this.fv.cellAt(x, y - DRAG_LIFT);
    return cell ? { type: 'cell', col: cell.col, row: cell.row } : { type: 'none' };
  }

  /** 引っぱっている間の絵と、離す先の印（金・赤）を、いまの指の場所に合わせる */
  private showDrag(): void {
    const press = this.press;
    if (!press?.dragging) return;
    const at = { x: press.x, y: press.y - DRAG_LIFT };
    const look = { fx: 0, fy: -1, menRatio: 1, rout: 0, highlight: true, dragAt: at, time: this.time.now };
    if (press.src.type === 'unit') {
      const p = this.list[press.src.index];
      const sprite = this.ownSprites[press.src.index];
      if (p && sprite) {
        // 引っぱっている部隊は、いちばん手前の層へ（歩かせない。指の画面の位置に描く）
        sprite.moveTo(this.dragLayer);
        sprite.apply({ ...look, wx: p.col + 0.5, wy: p.row + 0.5, stance: this.stancesShown() ? p.stance : null });
      }
    } else if (this.ghost) {
      const r = this.reserve;
      const stance = press.src.type === 'reserve' && r && this.stancesShown() ? r.stance : null;
      this.ghost.apply({ ...look, wx: 0.5, wy: 0.5, stance });
    }
    const target = this.dropTarget(press.x, press.y);
    const result = dropResult(press.src, target, this.dropContext());
    this.dropMark.clear();
    if (target.type === 'cell') strokeCell(this.dropMark, this.fv, target.col, target.row, result.type === 'none' ? COLOR.red : COLOR.gold);
    this.children.bringToTop(this.dropMark);
    if (this.removeBox.visible) this.drawRemove(target.type === 'hand' && result.type === 'apply');
    this.reserveButton?.setHot(target.type === 'reserve' && result.type === 'apply');
    // 引っぱっている絵は、操作の欄（「ここで外す」・遊軍の枠）の上でも見えるよう、いちばん手前に出す
    this.children.bringToTop(this.dragLayer);
  }

  /** 引っぱっている表示を片付ける（元の絵は、次の refresh で元のマスへ戻る） */
  private clearDrag(): void {
    this.ghost?.destroy();
    this.ghost = null;
    this.dropMark.clear();
    this.setRemoveShown(false);
    this.reserveButton?.setHot(false);
  }

  /**
   * 何も変えずに取り消す（タッチの取り消し・画面が隠れた・フォーカスを失った・確定になった・配置が変わって部隊がなくなった）。
   * 引っぱっている絵を片付け、元の絵を元のマスへ戻し、押し始めを空にする
   */
  private cancelPress(): void {
    if (!this.press) return;
    const dragging = this.press.dragging;
    this.press = null;
    this.clearDrag();
    if (dragging) this.refresh(false);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (this.terrainPointer === pointer.id) this.hideTerrain();
    if (this.kindPointer === pointer.id) {
      // 押してから KIND_MS たっていれば消す。まだなら、時間がたったときに消える
      this.kindPointer = null;
      if (this.kindExpired) this.hideKind();
    }
    const press = this.press;
    if (!press || pointer.id !== press.pointerId) return;
    // タッチの取り消し（と、引っぱる間に確定された場合）は、表示を戻すだけにして、何も確定しない
    if (pointer.wasCanceled || this.locked() || this.dialog) {
      this.cancelPress();
      return;
    }
    press.x = pointer.x;
    press.y = pointer.y;
    // 動かす出来事が来ないまま、離す出来事にだけ動きが出ることがあるので、離した座標でも見分ける
    if (!press.dragging && this.canDrag(press.src) && isDrag(false, press.startX, press.startY, pointer.x, pointer.y)) this.startDrag(press);
    if (press.dragging) {
      const target = this.dropTarget(pointer.x, pointer.y);
      const result = dropResult(press.src, target, this.dropContext());
      this.press = null;
      this.clearDrag();
      if (result.type === 'apply' && this.tut && press.src.type === 'card' && target.type === 'cell') {
        // チュートリアル：カードからの「離す」を、いまの操作 2 つ（兵種を選ぶ → マスを押す）に直して渡す
        tutorialAct({ type: 'pickKind', kind: press.src.kind });
        this.selectedKind = press.src.kind;
        this.tutorialCell(target);
        return;
      }
      if (!this.applyDrop(result)) this.refresh(false);
      return;
    }
    this.press = null;
    // 動かさずに離した：押したとみなす
    const src = press.src;
    if (src.type === 'card') this.selectKind(src.kind);
    else if (src.type === 'reserve') this.pressReserve();
    else if (this.tut) this.tutorialUnit(src.index);
    else this.openPopup(src.index);
  }

  /** 開発用の口：手札・遊軍の枠・手札の欄の矩形と、内部の大きさ（画面の点に直して、指の操作を送るため） */
  private debugRects(): { cards: Record<string, Rect>; reserve: Rect | null; hand: Rect; start: Rect | null; templates: Rect[]; width: number; height: number } {
    const cards: Record<string, Rect> = {};
    for (const [k, c] of this.cards) cards[k] = { ...c.rect };
    const l = getLayout();
    return { cards, reserve: this.reserveButton ? { ...this.reserveButton.rect } : null, hand: { ...this.panel.hand }, start: this.startButton ? { ...this.startButton.rect } : null, templates: this.panel.templates.map((r) => ({ ...r })), width: l.width, height: l.height };
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
    // 本陣は外せない（本陣の箱には「外す」を出さない。design §15.6）
    if (p.kind !== 'hq') items.push({ label: '外す', stance: null });
    // 方針の切り替えを出さない面の本陣は、箱に出すものがない
    if (items.length === 0) return;
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
      // 戦場の上に重ねて出す箱なので、押せる範囲は下の画面のボタンと別の組で数える（design §9.9-4）
      const b = new Button(this, r, it.label, () => this.choosePopup(index, it.stance), { hitGroup: 'popup' });
      b.setSelected(it.stance === p.stance);
      // チュートリアルでは、受け付ける方針（本陣狙い）のほかは押せない見た目（「外す」も）
      const run = this.tut ? session.tutorial : null;
      if (run) b.setEnabled(it.stance !== null && allowed(run, { type: 'stance', stance: it.stance }));
      b.addTo(this.popupLayer);
      this.popupButtons.push(b);
      this.popupStances.push(it.stance);
    });
    this.refresh();
  }

  /** 方針の箱の項目を押した（stance が null なら「外す」）。チュートリアルでは「本陣狙い」だけを受け付ける */
  private choosePopup(index: number, stance: Stance | null): void {
    if (this.tut && (!stance || !tutorialAct({ type: 'stance', stance }))) return;
    if (stance) this.setStance(index, stance);
    else this.removeAt(index);
  }

  private closePopup(): void {
    for (const b of this.popupButtons) b.destroy();
    this.popupButtons = [];
    this.popupStances = [];
    this.popupIndex = null;
    this.popupReserve = false;
  }

  // ---- 遊軍の枠（design §7.8） ----

  /**
   * 枠を押した。枠が空で、手持ちの兵種（本陣以外）を選んでいれば、その兵種の1部隊を遊軍にする。
   * 枠に部隊が入っていれば、方針の切り替えと「外す」の箱を出す（もう一度押すと閉じる）
   */
  private pressReserve(): void {
    if (this.locked() || this.dialog || !this.reserveShown()) return;
    const r = this.reserve;
    if (r) {
      if (this.popupReserve) {
        this.closePopup();
        this.refresh();
      } else {
        this.openReservePopup(r);
      }
      return;
    }
    // 空の枠を、何も選ばずに押したときは、何も起きない。選んでいれば、カードを枠へ離したのと同じ検査を通して入れる
    const kind = this.selectedKind;
    if (!kind) return;
    this.applyDrop(dropResult({ type: 'card', kind }, { type: 'reserve' }, this.dropContext()));
  }

  /** 枠の部隊の箱。選べる方針と「外す」を、枠の上に縦に並べる（上に入らなければ下に出す） */
  private openReservePopup(r: ReserveSetup): void {
    const slot = this.reserveButton?.rect;
    if (!slot) return;
    this.closePopup();
    this.selectedKind = null;
    this.popupReserve = true;
    const stances = this.stancesShown() ? STANCES.filter((s) => this.stanceOkFor(r.kind, s)) : [];
    const items: { label: string; stance: Stance | null }[] = stances.map((s) => ({ label: STANCE_LABEL[s], stance: s }));
    items.push({ label: '外す', stance: null });
    // 大きさは、戦場の部隊を押したときの箱と同じ
    const w = 88;
    const h = 28;
    const gap = 2;
    const totalH = items.length * h + (items.length - 1) * gap;
    const layout = getLayout();
    // 枠の右に入れば、枠の右に下の端をそろえて出す（ヒントやひな形に重ならないように）。
    // 入らなければ枠の上に、上にも入らなければ枠の下に出す
    let x: number;
    let y: number;
    if (slot.x + slot.w + 4 + w <= layout.width) {
      x = slot.x + slot.w + 4;
      y = Math.max(0, slot.y + slot.h - totalH);
    } else {
      x = Math.max(0, Math.min(layout.width - w, slot.x));
      y = slot.y - 4 - totalH >= 0 ? slot.y - 4 - totalH : slot.y + slot.h + 4;
    }
    items.forEach((it, i) => {
      const b = new Button(
        this,
        { x, y: y + i * (h + gap), w, h },
        it.label,
        () => {
          if (it.stance) this.setReserveStance(it.stance);
          else this.removeReserve();
        },
        { hitGroup: 'popup' },
      );
      b.setSelected(it.stance === r.stance);
      b.addTo(this.popupLayer);
      this.popupButtons.push(b);
    });
    // 操作の欄のボタンより上に出す（横長では、箱がひな形の並びに重なることがあるため）
    this.children.bringToTop(this.popupLayer);
    this.refresh();
  }

  private setReserveStance(stance: Stance): void {
    const r = this.reserve;
    if (r && this.stanceOkFor(r.kind, stance)) this.setDeploy(this.list, { kind: r.kind, stance });
    playStance();
    this.closePopup();
    this.refresh();
  }

  /** 枠から外して手持ちに戻す。続けて戦場に置けるよう、その兵種を選んだ状態にする */
  private removeReserve(): void {
    const r = this.reserve;
    if (!r) return;
    this.setDeploy(this.list, null);
    playRemove();
    this.closePopup();
    this.selectedKind = r.kind;
    this.refresh();
  }

  /**
   * 枠を出す・消す（対戦では、遊軍を使えるかが途中で変わる）と、中身の表示。縦長では「開戦」「完了」の幅も、枠の有無で変わる。
   * 枠は、使える場面で「完了」を押していなければ、空でも明るい（盤の部隊を入れる受け皿になるため。design §15.4）
   */
  private syncReserveSlot(locked: boolean): void {
    const shown = this.reserveShown();
    this.syncStartButton(shown);
    if (!shown) {
      this.reserveButton?.destroy();
      this.reserveButton = null;
      this.reserveIcon?.destroy();
      this.reserveIcon = null;
      if (this.popupReserve) this.closePopup();
      if (this.press?.src.type === 'reserve') this.cancelPress();
      return;
    }
    if (!this.reserveButton) {
      // ふつうの Button にしない（離したときに押したと決めると、枠からの引っぱりが始まらないため）
      this.reserveButton = new Card(this, this.panel.reserve, RESERVE_LABEL, '', (pointer) => this.downReserve(pointer));
      this.reserveIcon = this.add.graphics();
      // 開いている箱があれば、その下にならないようにする
      this.children.bringToTop(this.popupLayer);
    }
    const r = this.reserve;
    const b = this.reserveButton;
    b.setLines(r ? `${RESERVE_LABEL} ${KIND_LABEL[r.kind]}` : RESERVE_LABEL, '')
      .setEnabled(!locked)
      .setSelected(this.popupReserve);
    // 方針の印（戦場の自軍と同じ札）を枠の右の内側に。方針を選べない面と、文字に触れるほど狭い枠（縦長）では出さない
    const g = this.reserveIcon;
    g?.clear();
    if (g && r && this.stancesShown() && b.rect.w >= RESERVE_ICON_MIN_W) {
      const rect = b.rect;
      drawStanceIcon(g, r.stance, rect.x + rect.w - 7 - 8, Math.round(rect.y + rect.h / 2 - 4));
    }
  }

  // ---- 表示 ----

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

  /** 自軍の部隊の絵を、いまの配置に合わせて描き、前後を並べ直す */
  private applyOwn(): void {
    const bounds = this.fv.uiBounds(getLayout().field);
    this.list.forEach((p: Placement, i) => {
      const s = this.ownSprites[i];
      if (!s) return;
      // 引っぱっている部隊は showDrag が描く
      if (this.draggingIndex() === i) return;
      const highlight = i === this.popupIndex;
      // 自軍には方針の印を付ける（押さなくても方針が分かるように。敵と、方針を選べない面には付けない）
      const stance = this.stancesShown() ? p.stance : null;
      s.apply({ wx: p.col + 0.5, wy: p.row + 0.5, fx: 0, fy: -1, menRatio: 1, rout: 0, highlight, stance, bounds, time: this.time.now });
    });
    this.soldierLayer.sort('depth');
  }

  /** 見えている敵の部隊の絵（下を向いて並ぶ） */
  private applyEnemies(): void {
    const bounds = this.fv.uiBounds(getLayout().field);
    this.enemyVisible.forEach((p, i) => {
      this.enemySprites[i]?.apply({ wx: p.col + 0.5, wy: p.row + 0.5, fx: 0, fy: 1, menRatio: 1, rout: 0, highlight: false, bounds, time: this.time.now });
    });
    this.soldierLayer.sort('depth');
  }

  /** 焼いた絵が届いた：操作がなくても兵と木を出す（design §14.8） */
  private onStackReady(): void {
    if (!this.fv) return;
    this.forest?.update();
    this.applyEnemies();
    this.applyOwn();
    this.ghost?.destroy();
    this.ghost = null;
    // 引っぱっている部隊の絵も、届いた絵で描き直す（カード・枠からの絵は作り直す）
    const press = this.press;
    if (press?.dragging && press.src.type !== 'unit') {
      const kind = press.src.type === 'card' ? press.src.kind : this.reserve?.kind;
      if (kind) this.ghost = new SquadSprite(this, 0, kind, 999, this.dragLayer, this.markLayer, this.fv, 'deploy');
    }
    this.showDrag();
  }

  /** 引っぱっている盤の部隊の番号（なければ -1） */
  private draggingIndex(): number {
    const p = this.press;
    return p?.dragging && p.src.type === 'unit' ? p.src.index : -1;
  }

  /**
   * 押した画面の点のマス。立っている兵の絵（自軍と、見えている敵）を押していれば、その部隊のマス。
   * そうでなければ地面の点のマス（丘の持ち上がった面を押せば、そのマス。design §14.4）
   */
  private pressCell(sx: number, sy: number): Cell | null {
    const boxes = [...this.ownSprites, ...this.enemySprites].flatMap((s) => s.hitBoxes());
    const id = pickSquad(boxes, null, sx, sy);
    if (id !== null) {
      const p = id >= 100 ? this.enemyVisible[id - 100] : this.list[id];
      if (p) return { col: p.col, row: p.row };
    }
    return this.fv.cellAt(sx, sy);
  }

  private refresh(announce = true): void {
    if (!this.fv) return;
    const locked = this.locked();
    if (locked) this.closePopup();
    // 引っぱっている途中に、確定になった・配置が変わって覚えている部隊がなくなった・枠が空になったら、取り消す（design §15.4）
    const press = this.press;
    if (press) {
      const p = press.src.type === 'unit' ? this.list[press.src.index] : undefined;
      const u = press.unit;
      const lost =
        (press.src.type === 'unit' && (!p || !u || p.kind !== u.kind || p.col !== u.col || p.row !== u.row)) ||
        (press.src.type === 'reserve' && press.dragging && !this.reserve) ||
        (press.src.type === 'card' && !this.cardUsable(press.src.kind));
      if (locked || lost) {
        this.press = null;
        this.clearDrag();
      }
    }
    // 自軍の絵を作り直す（対戦では、部屋の知らせが来るたびに呼ばれる。引っぱっている表示は、終わりで当て直す）
    for (const s of this.ownSprites) s.destroy();
    this.ownSprites = this.list.map((p: Placement, i) => new SquadSprite(this, 0, p.kind, i, this.soldierLayer, this.markLayer, this.fv, 'deploy'));
    this.applyOwn();
    if (this.selectedKind && !this.cardUsable(this.selectedKind)) this.selectedKind = null;
    const costs = this.limits().costs;
    for (const [kind, c] of this.cards) {
      // 対戦はコスト、一人用は残りの数（design §15.3）
      const second = this.pvpMode ? `コスト${costs[kind] ?? 0}` : `残${this.remaining(kind)}`;
      c.setLines(KIND_LABEL[kind], second).setEnabled(this.cardUsable(kind)).setSelected(this.selectedKind === kind);
    }
    for (const b of this.templateButtons) b.setEnabled(!locked);
    this.syncReserveSlot(locked);
    const errors = this.errors(this.list);
    const start = this.startButton;
    if (this.pvpMode) {
      this.budgetText?.setText(pvpHeadText(this.list, this.reserve, this.limits()));
      // 確定中は「取消」（押すと取り消す）。確定できるのは、検査を通る配置のときだけ（本陣だけでは押せない）
      start?.setText(locked ? '取消' : '完了').setEnabled(locked || errors.length === 0);
    } else {
      // チュートリアルの「開戦」は、start の手順になるまで押せない見た目
      const run = this.tut ? session.tutorial : null;
      start?.setEnabled(errors.length === 0 && (!run || run.step === 'start'));
    }
    this.updateFormation(announce);
    this.showDrag();
  }

  override update(): void {
    this.dialog?.place();
    if (this.tut) {
      this.updateTutorial();
      return;
    }
    const info = this.infoLayout;
    if (!info || !this.infoText) return;
    if (this.pvpMode) {
      const room = client.room;
      if (!room) return;
      // 残り時間と、相手が確定したか（と戦場の名前）を1行で出す
      const deadline = room.deadlines.setup;
      const left = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - client.serverNow()) / 1000));
      const other = room.seats[room.you === 0 ? 1 : 0];
      const mark = other ? (other.ready ? '相手 確定' : '相手 配置中') : '';
      const mapName = PVP_MAPS.find((m) => m.id === room.map)?.name ?? '';
      const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      let text = `${mapName}  ${time}  ${mark}`;
      // 縦長の帯で陣形名と重なるなら、戦場の名前を省く（公開の画面でも出しているため）
      if (info.mode === 'strip' && this.formationName) {
        const room2 = info.info.w - this.formationText.width - 8;
        if (text.length * 16 > room2) text = `${time}  ${mark}`;
      }
      if (this.infoText.text !== text) this.infoText.setText(text);
      return;
    }
    if (info.mode === 'strip') {
      // 縦長の1人用：「？」を押してから3秒だけ、帯にヒントを出す（陣形名はそのあいだ隠す）
      const showing = this.time.now < this.hintUntil;
      if (showing !== this.hintShown) {
        this.hintShown = showing;
        this.hintBox.clear();
        if (showing) {
          const s = getLayout().strip;
          if (s) drawBox(this.hintBox, s);
          this.infoText.setPosition((s?.x ?? 0) + 8, info.info.y).setText(this.stage.hint);
          this.children.bringToTop(this.hintBox);
          this.children.bringToTop(this.infoText);
        } else {
          this.infoText.setText('');
        }
        this.formationText.setVisible(!showing && !!this.formationName);
      }
    }
  }

  /**
   * 陣形名（効果はなく、名前だけ）。配置が変わるたびに調べ、名前が付いたら「鶴翼の陣」のように出す。
   * 新しく名前が付いた瞬間だけ、短い音と、下から 4px 持ち上がる小さな動きを付ける。
   * 中間地帯には地形があるので戦場の上には出さず、横長は操作の欄、縦長は戦場の下の帯に出す。
   */
  private updateFormation(announce: boolean): void {
    // チュートリアルでは陣形名を出さない（design §8.6）
    if (this.tut) {
      this.formationText.setVisible(false);
      return;
    }
    // 配置エリアは「自分が下」なので、陣営0として調べる（対戦の陣営1でも同じ）
    const found = recognizeFormation(this.list, this.ownZone, 0);
    // 「横陣」のように名前が「陣」で終わるものはそのまま、それ以外は「鶴翼の陣」のように「の陣」を付ける
    const name = found ? (found.name.endsWith('陣') ? found.name : `${found.name}の陣`) : null;
    if (name === this.formationName) return;
    this.formationName = name;
    this.tweens.killTweensOf(this.formationText);
    const base = this.infoLayout?.formation.y ?? 0;
    this.formationText.setY(base);
    if (!name) {
      this.formationText.setVisible(false);
      return;
    }
    this.formationText.setText(name).setVisible(!this.hintShown);
    if (!announce) return;
    playFormation();
    // 2px ずつ段を付けて持ち上げる（なめらかに動かすとドットの見た目から浮くため）
    const lift = { v: 4 };
    this.formationText.y = base + 4;
    this.tweens.add({
      targets: lift,
      v: 0,
      duration: 160,
      onUpdate: () => {
        this.formationText.y = base + Math.round(lift.v / 2) * 2;
      },
    });
  }
}
