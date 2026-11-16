// 動かして確かめるための口（design §5.5）。開発時だけ window.__jg に出す。
// シーンはこの入れ物に、いまの状態と操作を書き込むだけにする（本番では window に出さないので無害）。
// installDebug は main.ts の import.meta.env.DEV の分岐の中からだけ呼ぶので、本番のビルドからは消える。

import {
  KINDS,
  STAGES,
  type BattleView,
  type OrderKind,
  type OrderTarget,
  type Placement,
  type Side,
  type TemplateId,
} from '@jinkei/engine';
import type Phaser from 'phaser';
import { effectCounts } from './art/effects.ts';
import { unitReach } from './art/UnitSprite.ts';
import { audioState, isMuted, sfxCounts } from './audio/sfx.ts';
import { clearSave, loadSave, setStarsForDebug } from './save.ts';
import { session, type ResultData } from './session.ts';

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
  /** 矢を飛ばした組（射手の id と、その刻みの attacking）。最後の 50 組 */
  arrows: [number, number][];
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
  arrows: [],
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
  };
  (window as unknown as { __jg: typeof api }).__jg = api;
}
