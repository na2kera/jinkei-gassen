// 動かして確かめるための口（design §5.5）。開発時だけ window.__jg に出す。
// シーンはこの入れ物に、いまの状態と操作を書き込むだけにする（本番では window に出さないので無害）。
// installDebug は main.ts の import.meta.env.DEV の分岐の中からだけ呼ぶので、本番のビルドからは消える。

import {
  KINDS,
  plainField,
  PVP_MAPS,
  pvpField,
  STAGES,
  type Field,
  type GateSetup,
  type PvpMapId,
  type Stage,
  type BattleEvent,
  type BattleView,
  type OrderKind,
  type OrderTarget,
  type Placement,
  type Side,
  type TemplateId,
  type Kind,
  type ReserveFrom,
  type ReserveSetup,
} from '@jinkei/engine';
import type Phaser from 'phaser';
import { effectCounts } from './art/effects.ts';
import { LocalBattleSource } from './battle/LocalBattleSource.ts';
import { unitReach } from './art/formation.ts';
import { audioState, isMuted, sfxCounts } from './audio/sfx.ts';
import { runEventDedup } from './net/eventDedup.ts';
import { overflows, type Overflow } from './ui/overflow.ts';
import { client, pvp, pvpLocal } from './net/pvp.ts';
import { clearSave, loadSave, playerId, savedFormations, resetPlayerIdForDebug, savedName, savedRoomCode, setStarsForDebug, setTutorialDoneForDebug } from './save.ts';
import { session, type ResultData } from './session.ts';
import { startTutorial, tutorialPaused } from './tutorial/run.ts';
import type { TutorialAction, TutorialRun } from './tutorial/steps.ts';

interface DebugHooks {
  scene: string;
  view: BattleView | null;
  result: ResultData | null;
  /** 届いた場面の tick の列（2刻みごと・決着は即時、を確かめるため。最後の 400 個） */
  frameTicks: number[];
  /** 届いた出来事の種類と tick（最後の 200 個） */
  events: string[];
  /** 画面に出した号令の文言 */
  announcements: string[];
  applyTemplate: ((id: TemplateId) => void) | null;
  start: ((viewer: Side) => boolean) | null;
  order: ((target: OrderTarget, kind: OrderKind) => boolean) | null;
  setSpeed: ((n: number) => void) | null;
  retry: (() => void) | null;
  /** 結果の画面の「次へ」「戻る」 */
  next: (() => void) | null;
  back: (() => void) | null;
  /** 配置の画面で、面の見本の配置を置く */
  placeSolution: (() => void) | null;
  /** 見本の配置を置き、見本の号令を予定に入れて開戦する */
  startSolution: (() => boolean) | null;
  /** 配置の画面の陣形の保存と呼び出し（確かめるときに画面の操作を省くため） */
  /** 戦闘の画面の視点を切り替える */
  toggleView: (() => void) | null;
  formationOps: { save: (name: string, replaceIndex?: number) => boolean; recall: (name: string) => boolean } | null;
  /** 配置の画面の遊軍の枠（get はいまの遊軍、put はその兵種を選んで枠を押す、tap は枠を押す） */
  reserveOps: { get: () => ReserveSetup | null; put: (kind: Kind) => boolean; tap: () => void } | null;
  /** 戦闘の画面の遊軍（画面のボタンと同じ）。呼べたら true */
  summon: ((from: ReserveFrom) => boolean) | null;
  /** 矢を飛ばした組（射手の id と、その刻みの attacking）。最後の 50 組 */
  arrows: [number, number][];
  /** チュートリアル（design §8.8）：TutorialAction を、いまの画面の操作と同じ道筋で当てはめる。受け付けたら true */
  tutorialAct: ((a: TutorialAction) => boolean) | null;
  /** チュートリアルの「飛ばす」と同じ */
  tutorialSkip: (() => void) | null;
}

export const debug: DebugHooks = {
  scene: '',
  view: null,
  result: null,
  frameTicks: [],
  events: [],
  announcements: [],
  applyTemplate: null,
  start: null,
  order: null,
  setSpeed: null,
  retry: null,
  next: null,
  back: null,
  placeSolution: null,
  startSolution: null,
  formationOps: null,
  reserveOps: null,
  summon: null,
  toggleView: null,
  arrows: [],
  tutorialAct: null,
  tutorialSkip: null,
};

export function pushCapped<T>(arr: T[], v: T, cap: number): void {
  arr.push(v);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

export function installDebug(game: Phaser.Game): void {
  const api = {
    /** 実際のフレームの速さ（32部隊で 55 以上あることを確かめるため） */
    get fps(): number {
      return game.loop.actualFps;
    },
    /** 音の状態と、鳴らす関数が呼ばれた回数・実際に鳴らした回数（耳では確かめられないため） */
    get audio(): { state: string; muted: boolean; counts: typeof sfxCounts } {
      return { state: audioState(), muted: isMuted(), counts: JSON.parse(JSON.stringify(sfxCounts)) as typeof sfxCounts };
    },
    /** 演出ごとに出した回数 */
    get effects(): typeof effectCounts {
      return { ...effectCounts };
    },
    /** 起動時に作った絵（兵やタイル）の canvas。拡大して見比べるため */
    texture(key: string): HTMLCanvasElement | null {
      if (!game.textures.exists(key)) return null;
      return game.textures.get(key).getSourceImage() as HTMLCanvasElement;
    },
    /** 兵種ごとの、部隊の絵が中心から届く距離（px）。10 以下なら、隣の部隊と重ならない */
    get reach(): Record<string, number> {
      return Object.fromEntries(KINDS.map((k) => [k, Math.round(unitReach(k) * 100) / 100]));
    },
    get scene(): string {
      return debug.scene;
    },
    get placements(): Placement[] {
      return session.placements.map((p) => ({ ...p }));
    },
    get view(): BattleView | null {
      return debug.view;
    },
    get result(): ResultData | null {
      return debug.result;
    },
    get frameTicks(): number[] {
      return [...debug.frameTicks];
    },
    get events(): string[] {
      return [...debug.events];
    },
    get announcements(): string[] {
      return [...debug.announcements];
    },
    applyTemplate(id: TemplateId): boolean {
      if (!debug.applyTemplate) return false;
      debug.applyTemplate(id);
      return true;
    },
    /** 開戦。viewer に 1 を渡すと、陣営1の側から同じ戦いを映す（対戦の陣営1の人の見え方を確かめるため） */
    start(viewer: Side = 0): boolean {
      return debug.start ? debug.start(viewer) : false;
    },
    /** 対戦の状態（段階・成績・自分の陣営・つながり・最後に届いたメッセージの種類と数・送ったメッセージの記録） */
    get pvp(): unknown {
      const r = client.room;
      return {
        active: pvp.active,
        status: client.status,
        code: client.code,
        phase: r?.phase ?? null,
        map: r?.map ?? null,
        battleNo: r?.battleNo ?? null,
        you: r?.you ?? null,
        score: r?.score ?? null,
        seats: r?.seats ?? null,
        rematch: r?.rematch ?? null,
        lastType: client.lastType,
        received: { ...client.received },
        sent: [...client.sentLog],
        placements: pvpLocal.placements.length,
        roster: { ...pvpLocal.roster },
        result: client.result ? { winner: client.result.winner, reason: client.result.reason, score: client.result.score } : null,
        snapTick: client.snap?.tick ?? null,
        myArmy: r?.myArmy ?? null,
        myReserve: r?.myReserve ?? null,
        rulesReserve: r?.rules.reserve ?? null,
        reserve: pvpLocal.reserve ? { ...pvpLocal.reserve } : null,
        snapReserve: client.snap?.reserve ?? null,
        draftDirty: pvpLocal.draftDirty,
        wantReady: pvpLocal.wantReady,
        local: pvpLocal.placements.map((p) => ({ ...p })),
        failure: client.failure,
        // 通信の購読の数（解放し忘れがないかを確かめるため）
        listeners: client.listenerCounts,
      };
    },
    /** いま動いているシーン（2つの画面が同時に動いていないかを確かめるため） */
    get scenes(): string[] {
      return game.scene.getScenes(true).map((s) => s.scene.key);
    },
    /** 前の部屋（または指定したコードの部屋）に、保存した名前で入る（確かめるときに画面の操作を省くため） */
    pvpJoin(code?: string): boolean {
      const c = code ?? savedRoomCode();
      if (!c) return false;
      pvp.begin();
      client.join(c, playerId(), savedName() || '試し');
      return true;
    },
    /**
     * 任意の戦場で戦いを始めて、戦闘の画面を開く（地形・門・幅の違う戦場を画面で確かめるため）。
     * engine の createBattle にそのまま渡す。敵の配置はエリアの検査を外す（面のデータと同じ扱い）
     */
    startCustom(opts: {
      field: Field;
      armies: [Placement[], Placement[]];
      gate?: GateSetup;
      seconds?: number;
      viewer?: Side;
      fog?: { col: number; row: number }[];
      survive?: boolean;
      /** 遊軍（design §7）。engine の BattleSetup にそのまま渡す */
      reserves?: [ReserveSetup | null, ReserveSetup | null];
      scriptedReserves?: { tick: number; side: Side; from: ReserveFrom }[];
    }): unknown {
      const viewer = opts.viewer ?? 0;
      const made = LocalBattleSource.create(
        {
          field: opts.field,
          armies: opts.armies,
          seed: (Math.random() * 0x100000000) >>> 0,
          maxTicks: Math.round((opts.seconds ?? 180) * 10),
          timeout: opts.survive ? 'side0_wins' : 'compare',
          skipZoneCheck: 1,
          ...(opts.gate ? { gate: opts.gate } : {}),
          ...(opts.reserves ? { reserves: opts.reserves } : {}),
          ...(opts.scriptedReserves ? { scriptedReserves: opts.scriptedReserves } : {}),
        },
        viewer,
      );
      if (!made.ok) return made.error;
      const cur = game.scene.getScenes(true).find((s) => s.scene.key !== 'NetOverlay');
      const data = {
        source: made.source,
        field: opts.field,
        viewer,
        orders: true,
        onQuit: (b: Phaser.Scene) => b.scene.start('Title'),
        stageId: '',
        ...(opts.fog ? { fog: opts.fog } : {}),
        survive: opts.survive ?? false,
      };
      if (cur) cur.scene.start('Battle', data);
      else game.scene.start('Battle', data);
      return true;
    },
    /** 城壁と門の場面（engine の sim/terrain-scenes.ts の castleSetup と同じ形）を戦闘の画面で流す */
    castle(win = false): unknown {
      const at = (kind: Placement['kind'], stance: Placement['stance'], cols: number[], row: number): Placement[] =>
        cols.map((col) => ({ kind, stance, col, row }));
      const f = plainField();
      for (let c = 0; c < f.width; c++) if (c !== 5) f.terrain[5 * f.width + c] = 'wall';
      f.zones = [f.zones[0], { col: 0, row: 0, width: f.width, height: 6 }];
      return api.startCustom({
        field: f,
        armies: [
          [{ kind: 'hq', stance: 'hold', col: 5, row: 14 }, ...at('infantry', 'advance', [3, 4, 5, 6], 10), ...at('shield', 'advance', [4, 6], 11)],
          [{ kind: 'hq', stance: 'hold', col: 5, row: 1 }, ...at('infantry', 'hold', [4, 6], 3), ...at('archer', 'hold', [2, 8], 2)],
        ],
        gate: { side: 1, col: 5, row: 5, win },
      });
    },
    /** 面を仮に足す（同じ id があれば置き換える）。第2章・第3章のデータができるまで、霧・狭い戦場・門・ステージ選択を確かめるため */
    addStage(stage: Stage): number {
      const i = STAGES.findIndex((s) => s.id === stage.id);
      if (i >= 0) STAGES[i] = stage;
      else STAGES.push(stage);
      return STAGES.length;
    },
    /** 確かめ用の戦場を作る道具 */
    fields: {
      plain: (width = 12) => plainField(width),
      pvp: (id: PvpMapId) => pvpField(id),
      /** engine の sim/terrain-scenes.ts の castleField と同じ形：城壁は行 5、切れ目（門）は列 5 */
      castle: () => {
        const f = plainField();
        for (let c = 0; c < f.width; c++) if (c !== 5) f.terrain[5 * f.width + c] = 'wall';
        f.zones = [f.zones[0], { col: 0, row: 0, width: f.width, height: 6 }];
        return f;
      },
      maps: () => PVP_MAPS,
    },
    /** フレームを止める・再開する（タブを裏にしてフレームが進まない状態を作り、その間に段階を進めて確かめるため） */
    pauseLoop(): void {
      game.loop.sleep();
    },
    resumeLoop(): void {
      game.loop.wake();
    },
    /** 文字が枠からはみ出したボタンの記録（開発時だけ）。clear で消す */
    get overflows(): Overflow[] {
      return overflows.map((o) => ({ ...o }));
    },
    clearOverflows(): void {
      overflows.length = 0;
    },
    /** 出来事の重複の見分け方を、snap の並び（tick と出来事）で試す。渡された出来事の列を返す */
    dedupEvents(snaps: { tick: number; events: BattleEvent[] }[]): BattleEvent[] {
      return runEventDedup(snaps);
    },
    /** 戦闘の画面の視点を切り替える（画面の「視点」と同じ） */
    toggleView(): boolean {
      if (!debug.toggleView) return false;
      debug.toggleView();
      return true;
    },
    /** 保存した陣形の一覧 */
    get formations(): unknown {
      return savedFormations().map((f) => ({ name: f.name, width: f.width, units: f.units.length, kinds: f.units.map((u) => u.kind[0]).join('') }));
    },
    /** いまの配置を陣形として保存する（配置の画面だけ） */
    saveFormation(name: string, replaceIndex?: number): boolean {
      return debug.formationOps ? debug.formationOps.save(name, replaceIndex) : false;
    },
    /** 保存した陣形を呼び出す（配置の画面だけ） */
    recallFormation(name: string): boolean {
      return debug.formationOps ? debug.formationOps.recall(name) : false;
    },
    /** 配置の画面の遊軍（design §7.8）。なければ null */
    get reserve(): ReserveSetup | null {
      return debug.reserveOps ? debug.reserveOps.get() : null;
    },
    /** その兵種を選んで「遊軍」の枠を押す（画面の操作と同じ）。枠に入ったら true */
    putReserve(kind: Kind): boolean {
      return debug.reserveOps ? debug.reserveOps.put(kind) : false;
    },
    /** 「遊軍」の枠を押す（入っていれば、方針と「外す」の箱が開く・閉じる） */
    tapReserve(): boolean {
      if (!debug.reserveOps) return false;
      debug.reserveOps.tap();
      return true;
    },
    /** 戦闘の画面の「遊軍 左から」「遊軍 右から」と同じ。呼べたら true */
    summon(from: ReserveFrom): boolean {
      return debug.summon ? debug.summon(from) : false;
    },
    /**
     * 面の敵に遊軍を持たせる（いまの15面は使わないので、面のデータに書いたときの流れを確かめるため）。
     * 面のデータを写して enemyReserve を足し、addStage で置き換える。null を渡すと外す。開き直すと反映される
     */
    setEnemyReserve(stageId: string, r: { kind: Kind; stance: ReserveSetup['stance']; atSec: number; from: ReserveFrom } | null): boolean {
      const s = STAGES.find((x) => x.id === stageId);
      if (!s) return false;
      const { enemyReserve: _old, ...rest } = s;
      api.addStage(r ? { ...rest, enemyReserve: { ...r } } : rest);
      return true;
    },
    /** 部屋を作って入る（部屋の画面の「部屋を作る」と同じ。確かめるときに画面の操作を省くため）。部屋のコードを返す */
    async pvpCreate(name = '試し'): Promise<string | null> {
      pvp.begin();
      await client.create(playerId(), name);
      return client.code;
    },
    /** 部屋を出る（画面の「出る」と同じ） */
    pvpLeave(): void {
      pvp.leave();
    },
    /** 対戦のつながりを切る（自動でつなぎ直すかを確かめるため） */
    pvpDrop(): void {
      client.dropForDebug();
    },
    /** すぐにつなぎ直す */
    pvpReconnect(): void {
      client.reconnectForDebug();
    },
    /** pid を作り直す（同じ保存の2枚のタブで、別の人として入るため） */
    newPid(): string {
      return resetPlayerIdForDebug();
    },
    /** 面ごとの星と、保存の中身 */
    get save(): unknown {
      return JSON.parse(JSON.stringify(loadSave()));
    },
    get stageId(): string {
      return session.stageId;
    },
    get arrows(): [number, number][] {
      return [...debug.arrows];
    },
    /** 指定した面まで（その面も含めて）勝ったことにする。星は1つ（すでに多ければそのまま） */
    skipTo(stageId: string): boolean {
      const i = STAGES.findIndex((s) => s.id === stageId);
      if (i < 0) return false;
      for (const s of STAGES.slice(0, i + 1)) setStarsForDebug(s.id, Math.max(1, loadSave().stars[s.id] ?? 0));
      return true;
    },
    /** 保存を消す（画面はいまのまま。開き直すと反映される） */
    clearSave(): void {
      clearSave();
    },
    /** 面を指定して配置の画面を開く */
    /** 任意の画面を開く（すべての画面の見た目を順に確かめるため） */
    goScene(key: string, data?: object): boolean {
      const cur = game.scene.getScenes(true).find((s) => s.scene.key !== 'NetOverlay');
      if (!cur) return false;
      cur.scene.start(key, data);
      return true;
    },
    openStage(stageId: string): boolean {
      const cur = game.scene.getScenes(true)[0];
      if (!cur || !STAGES.some((s) => s.id === stageId)) return false;
      cur.scene.start('Deploy', { stageId });
      return true;
    },
    placeSolution(): boolean {
      if (!debug.placeSolution) return false;
      debug.placeSolution();
      return true;
    },
    startSolution(): boolean {
      return debug.startSolution ? debug.startSolution() : false;
    },
    next(): boolean {
      if (!debug.next) return false;
      debug.next();
      return true;
    },
    back(): boolean {
      if (!debug.back) return false;
      debug.back();
      return true;
    },
    order(target: OrderTarget, kind: OrderKind): boolean {
      return debug.order ? debug.order(target, kind) : false;
    },
    setSpeed(n: number): boolean {
      if (!debug.setSpeed) return false;
      debug.setSpeed(n);
      return true;
    },
    retry(): boolean {
      if (!debug.retry) return false;
      debug.retry();
      return true;
    },
    /** チュートリアルのいまの進み具合（なければ null）と、戦闘が止まっているか（design §8.8） */
    get tutorial(): { run: TutorialRun | null; paused: boolean } {
      return { run: session.tutorial ? (JSON.parse(JSON.stringify(session.tutorial)) as TutorialRun) : null, paused: tutorialPaused() };
    },
    /** チュートリアルを始める（from は 'auto' か 'list'。終えたあとの行き先が変わる） */
    tutorialStart(from: TutorialRun['from'] = 'list'): boolean {
      startTutorial(from);
      return api.goScene('Deploy', { stageId: 'tutorial' });
    },
    /** TutorialAction を、画面の操作と同じ道筋で当てはめる（受け付けたら true） */
    tutorialAct(action: TutorialAction): boolean {
      return debug.tutorialAct ? debug.tutorialAct(action) : false;
    },
    /** 「飛ばす」と同じ */
    tutorialSkip(): boolean {
      if (!debug.tutorialSkip) return false;
      debug.tutorialSkip();
      return true;
    },
    /** 済みの印を付ける・外す */
    setTutorialDone(v: boolean): void {
      setTutorialDoneForDebug(v);
    },
  };
  (window as unknown as { __jg: typeof api }).__jg = api;
}

/**
 * 開発用：URL に ?harness=col（上下）か ?harness=row（左右）を付けると、このページを「2人分の画面を並べる台」にする。
 * 中に ?save=a と ?save=b の2つの画面を iframe で開く（別のタブにすると、裏のタブが読み込み直されて確かめられないため）。
 * 読み込み直されても、自分で組み直す。本番では呼ばれない（main.ts の DEV の分岐の中から呼ぶ）。
 */
export function installHarness(): boolean {
  const mode = new URLSearchParams(window.location.search).get('harness');
  if (mode !== 'col' && mode !== 'row') return false;
  document.body.innerHTML = '';
  Object.assign(document.body.style, { background: '#000', display: 'flex', flexDirection: mode === 'row' ? 'row' : 'column', gap: '4px' });
  for (const s of ['a', 'b']) {
    const f = document.createElement('iframe');
    f.id = `f${s}`;
    f.src = `/?save=${s}`;
    Object.assign(f.style, { flex: '1 1 0', border: '0', minWidth: '0', minHeight: '0' });
    document.body.appendChild(f);
  }
  const w = window as unknown as Record<string, unknown>;
  w.A = () => (document.getElementById('fa') as HTMLIFrameElement).contentWindow;
  w.B = () => (document.getElementById('fb') as HTMLIFrameElement).contentWindow;
  return true;
}
