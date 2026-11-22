// 立体の絵のテクスチャの、主スレッドの口（design §14.3）。
// 焼く仕事をワーカーに頼み、届いた絵を「取り込み待ちの列」に入れ、1 コマに 1 枚までテクスチャにする。
// ワーカーが使えないとき（new Worker が例外を投げた・起動のあとに error か messageerror が届いた）は、
// まだできていない分を主スレッドの列で続ける（1 コマに 4 ミリ秒まで。できた絵は捨てない）。
// テクスチャはゲーム全体のもので、シーンをまたいで持ち続ける（公開の揃いだけは、release で捨てる）。

import Phaser from 'phaser';
import { ANGLES, type Geom } from './bake.ts';
import type { FromWorker, ToWorker } from './bakeWorker.ts';
import { BakeQueue, BATTLE_SCALE, SET_IDS, setSheets, soldierFrameName, startupTasks, treeFrameName, treeSheetKey, soldierSheetKey, wrapAngle, type BakedFrame, type BakedSheet, type SetId, type SheetSpec, type TaskSpec } from './jobs.ts';
import type { ModelId, TreeId } from './parts.ts';

/** 主スレッドの列が 1 コマに進める時間（ミリ秒） */
const MAIN_BUDGET_MS = 4;

/** テクスチャの作り方。uint8 は addUint8Array（WebGL。画素が 2 か所に載る）、canvas は addCanvas（WebGL なら 3 か所、Canvas で描くなら 2 か所） */
export type TexturePath = 'uint8' | 'canvas';

/** 取り込んだ 1 枚の絵 */
export interface SheetInfo {
  readonly key: string;
  readonly set: SetId;
  readonly scale: number;
  readonly model?: ModelId;
  readonly w: number;
  readonly h: number;
  readonly g: Geom;
  readonly frames: ReadonlyMap<string, BakedFrame>;
  readonly teamPx?: readonly number[];
  /** 画素 1 枚ぶんの量（バイト） */
  readonly bytes: number;
  /** 画素が載る場所の数（§14.3 の「実際に載る量」） */
  readonly places: number;
  readonly path: TexturePath;
  /** 焼くのにかかった時間・取り込みにかかった時間（ミリ秒） */
  readonly bakeMs: number;
  readonly importMs: number;
  /** 起動（start）から取り込みまでの時間（ミリ秒） */
  readonly readyAt: number;
  /** どこで焼いたか */
  readonly by: 'worker' | 'main';
}

/** 兵の 1 コマの引き先 */
export interface FrameRef {
  readonly key: string;
  readonly frame: string;
  readonly sheet: SheetInfo;
  readonly info: BakedFrame;
  /** その絵（Image）に掛ける表示の倍率（代わりの絵のときだけ 1 以外） */
  readonly display: number;
  /** 代わりの絵か */
  readonly fallback: boolean;
}

export type WorkerState = 'off' | 'idle' | 'running' | 'done' | 'failed';

export interface StartOptions {
  /** false ならワーカーを使わず、主スレッドの列で焼く（確かめ用） */
  readonly worker?: boolean;
  /** canvas なら、WebGL でも addCanvas で取り込む（確かめ用） */
  readonly path?: 'auto' | 'canvas';
}

type Listener = (s: SheetInfo) => void;

class StackTextures {
  private game: Phaser.Game | null = null;
  private opts: Required<StartOptions> = { worker: true, path: 'auto' };
  /** 要る絵（先に要るものが前） */
  private wanted: SheetSpec[] = [];
  private readonly ready = new Map<string, SheetInfo>();
  private inbox: { sheet: BakedSheet; by: 'worker' | 'main' }[] = [];
  private readonly released = new Set<SetId>();
  private readonly listeners = new Set<Listener>();
  private worker: Worker | null = null;
  private workerState: WorkerState = 'off';
  private mainQ: BakeQueue | null = null;
  private startedAt = 0;
  private stepHooked = false;
  private readonly stats = {
    workersStarted: 0,
    workerErrors: [] as string[],
    importMsMax: 0,
    importMsTotal: 0,
    fallbackDraws: 0,
    dropped: 0,
    mainSteps: 0,
    mainStepMsMax: 0,
  };

  /** 起動で呼ぶ。頼むだけで、待たない */
  start(game: Phaser.Game, opts: StartOptions = {}): void {
    if (this.game) return;
    this.game = game;
    this.opts = { worker: opts.worker ?? true, path: opts.path ?? 'auto' };
    this.startedAt = performance.now();
    if (!this.stepHooked) {
      game.events.on(Phaser.Core.Events.STEP, () => this.onStep());
      this.stepHooked = true;
    }
    const tasks = startupTasks();
    for (const t of tasks) if (t.t === 'sheet') this.wanted.push(t.spec);
    this.dispatch(tasks);
  }

  /** 揃いを頼む（できていない分を、列の先頭に入れる） */
  request(set: SetId): void {
    this.released.delete(set);
    const specs = setSheets(set).filter((s) => !this.ready.has(s.key) && !this.inbox.some((x) => x.sheet.key === s.key));
    if (specs.length === 0) return;
    const keys = new Set(specs.map((s) => s.key));
    this.wanted = [...specs, ...this.wanted.filter((s) => !keys.has(s.key))];
    const tasks = specs.map((spec): TaskSpec => ({ t: 'sheet', spec }));
    if (this.worker && this.workerState === 'running') this.post({ t: 'front', tasks });
    else if (this.mainQ) this.mainQ.front(tasks);
    else this.dispatch(tasks);
  }

  /** 揃いを捨てる（テクスチャを消す。まだ焼いていない分は作らない） */
  release(set: SetId): void {
    this.released.add(set);
    this.wanted = this.wanted.filter((s) => s.set !== set);
    this.inbox = this.inbox.filter((x) => x.sheet.set !== set);
    for (const [key, s] of [...this.ready]) {
      if (s.set !== set) continue;
      this.ready.delete(key);
      if (this.game?.textures.exists(key)) this.game.textures.remove(key);
    }
    if (this.worker && this.workerState === 'running') this.post({ t: 'cancel', set });
    this.mainQ?.cancel(set);
  }

  /** 絵ができた（テクスチャに取り込んだ）ことの知らせを受け取る。やめるための関数が返る */
  onReady(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  sheet(key: string): SheetInfo | undefined {
    return this.ready.get(key);
  }

  /** 揃いが全部できたか（model を渡せば、その型の 1 枚だけ） */
  isReady(set: SetId, model?: ModelId): boolean {
    if (model && set !== 'tree') return this.ready.has(soldierSheetKey(set, model));
    return setSheets(set).every((s) => this.ready.has(s.key));
  }

  /** 揃いの兵の 1 コマ（なければ null） */
  soldier(set: Exclude<SetId, 'tree'>, model: ModelId, team: 0 | 1, walk: number, angle: number): FrameRef | null {
    const sheet = this.ready.get(soldierSheetKey(set, model));
    if (!sheet) return null;
    const name = soldierFrameName(team, walk, wrapAngle(angle));
    const info = sheet.frames.get(name);
    return info ? { key: sheet.key, frame: name, sheet, info, display: 1, fallback: false } : null;
  }

  /**
   * 戦闘の兵の 1 コマ。戦闘の揃いがまだなら、配置の揃いのコマ（向きと歩く動きは変わらない）を表示の倍率 0.84 で（design §14.3）。
   * どちらもなければ null。代わりの絵を返した回数を数える
   */
  battle(model: ModelId, team: 0 | 1, walk: number, angle: number): FrameRef | null {
    const hit = this.soldier('battle', model, team, walk, angle);
    if (hit) return hit;
    const dep = this.soldier('deploy', model, team, 0, team === 0 ? 0 : ANGLES / 2);
    if (!dep) return null;
    this.stats.fallbackDraws++;
    return { ...dep, display: BATTLE_SCALE, fallback: true };
  }

  /** 木の 1 コマ（その大きさの揃いがなければ null） */
  tree(scale: number, tree: TreeId, angle: number): FrameRef | null {
    const sheet = this.ready.get(treeSheetKey(scale));
    if (!sheet) return null;
    const name = treeFrameName(tree, wrapAngle(angle));
    const info = sheet.frames.get(name);
    return info ? { key: sheet.key, frame: name, sheet, info, display: 1, fallback: false } : null;
  }

  /** 開発用の口に出す、でき具合と時間と量 */
  status(): object {
    const sets: Record<string, { done: number; total: number; mb: number; loadedMb: number }> = {};
    for (const set of SET_IDS) {
      const specs = setSheets(set);
      const got = specs.map((s) => this.ready.get(s.key)).filter((s): s is SheetInfo => !!s);
      sets[set] = {
        done: got.length,
        total: specs.length,
        mb: round1(got.reduce((a, s) => a + s.bytes, 0) / 1e6),
        loadedMb: round1(got.reduce((a, s) => a + s.bytes * s.places, 0) / 1e6),
      };
    }
    const all = [...this.ready.values()];
    return {
      worker: this.workerState,
      workersStarted: this.stats.workersStarted,
      workerErrors: this.stats.workerErrors,
      mainQueue: !!this.mainQ,
      mainSteps: this.stats.mainSteps,
      mainStepMsMax: round1(this.stats.mainStepMsMax),
      path: all[0]?.path ?? null,
      sets,
      sheetsDone: all.length,
      sheetsTotal: this.wanted.length,
      inbox: this.inbox.length,
      bakeMs: round1(all.reduce((a, s) => a + s.bakeMs, 0)),
      importMsMax: round1(this.stats.importMsMax),
      importMsTotal: round1(this.stats.importMsTotal),
      firstSheetAt: round1(Math.min(...all.map((s) => s.readyAt))),
      lastSheetAt: round1(Math.max(...all.map((s) => s.readyAt))),
      setReadyAt: Object.fromEntries(SET_IDS.map((set) => [set, this.isReady(set) ? round1(Math.max(...setSheets(set).map((s) => this.ready.get(s.key)!.readyAt))) : null])),
      fallbackDraws: this.stats.fallbackDraws,
      dropped: this.stats.dropped,
      loadedMb: round1(all.reduce((a, s) => a + s.bytes * s.places, 0) / 1e6),
      sheets: all.map((s) => ({ key: s.key, w: s.w, h: s.h, frames: s.frames.size, bakeMs: round1(s.bakeMs), importMs: round1(s.importMs), readyAt: round1(s.readyAt), by: s.by, places: s.places })),
    };
  }

  /** 確かめ用：ワーカーが誤りで止まったことにする（起動のあとの error と同じ道筋） */
  simulateWorkerError(): boolean {
    if (!this.worker) return false;
    this.failWorker('確かめ用に止めた');
    return true;
  }

  // ---- 中 ----

  /** 仕事を、ワーカー（使えれば）か主スレッドの列に渡す */
  private dispatch(tasks: TaskSpec[]): void {
    if (this.opts.worker && this.workerState !== 'failed' && typeof Worker !== 'undefined') {
      try {
        const w = new Worker(new URL('./bakeWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<FromWorker>): void => this.onWorkerMessage(w, e.data);
        w.onerror = (e: ErrorEvent): void => {
          e.preventDefault();
          if (w === this.worker) this.failWorker(`error: ${e.message}`);
        };
        w.onmessageerror = (): void => {
          if (w === this.worker) this.failWorker('messageerror');
        };
        this.worker = w;
        this.workerState = 'running';
        this.stats.workersStarted++;
        this.post({ t: 'start', tasks, skip: this.doneKeys() });
        return;
      } catch (e) {
        this.stats.workerErrors.push(`new Worker: ${String(e)}`);
        this.workerState = 'failed';
      }
    }
    this.runOnMain(tasks);
  }

  private post(m: ToWorker): void {
    this.worker?.postMessage(m);
  }

  private onWorkerMessage(w: Worker, m: FromWorker): void {
    if (w !== this.worker) return;
    if (m.t === 'sheet') this.accept(m.sheet, 'worker');
    else if (m.t === 'error') this.failWorker(m.message);
    else if (m.t === 'done') {
      w.terminate();
      this.worker = null;
      this.workerState = 'done';
      // 終わる間際に頼んだ分など、まだ要る絵が残っていれば、その分だけでワーカーを作り直す
      const rest = this.missing();
      if (rest.length > 0) this.dispatch(rest.map((spec): TaskSpec => ({ t: 'sheet', spec })));
    }
  }

  /** ワーカーをやめ、まだできていない分を主スレッドの列で続ける */
  private failWorker(why: string): void {
    this.stats.workerErrors.push(why);
    this.worker?.terminate();
    this.worker = null;
    this.workerState = 'failed';
    this.runOnMain(this.missing().map((spec): TaskSpec => ({ t: 'sheet', spec })));
  }

  private runOnMain(tasks: TaskSpec[]): void {
    if (!this.mainQ) this.mainQ = new BakeQueue((s) => this.accept(s, 'main'), { skip: this.doneKeys() });
    this.mainQ.push(tasks);
  }

  /** 届いた絵を取り込み待ちに入れる（捨てた揃いの絵は捨てる） */
  private accept(sheet: BakedSheet, by: 'worker' | 'main'): void {
    if (this.released.has(sheet.set) || !this.wanted.some((s) => s.key === sheet.key)) {
      this.stats.dropped++;
      return;
    }
    this.inbox.push({ sheet, by });
  }

  /** できた・取り込み待ちの絵 */
  private doneKeys(): string[] {
    return [...this.ready.keys(), ...this.inbox.map((x) => x.sheet.key)];
  }

  /** 要るのに、まだできていない絵 */
  private missing(): SheetSpec[] {
    const done = new Set(this.doneKeys());
    return this.wanted.filter((s) => !done.has(s.key));
  }

  /** 毎コマ：主スレッドの列を少し進め、取り込み待ちを 1 枚だけテクスチャにする */
  private onStep(): void {
    const q = this.mainQ;
    if (q) {
      const t0 = performance.now();
      const more = q.runFor(MAIN_BUDGET_MS);
      const dt = performance.now() - t0;
      this.stats.mainSteps++;
      this.stats.mainStepMsMax = Math.max(this.stats.mainStepMsMax, dt);
      if (!more) {
        q.dropModels();
        this.mainQ = null;
      }
    }
    const next = this.inbox.shift();
    if (next) this.importSheet(next.sheet, next.by);
  }

  private importSheet(s: BakedSheet, by: 'worker' | 'main'): void {
    const game = this.game;
    if (!game) return;
    const t0 = performance.now();
    const tm = game.textures;
    if (tm.exists(s.key)) tm.remove(s.key);
    const webgl = game.renderer.type === Phaser.WEBGL;
    let path: TexturePath = webgl && this.opts.path !== 'canvas' ? 'uint8' : 'canvas';
    let tex: Phaser.Textures.Texture | null = null;
    if (path === 'uint8') {
      tex = tm.addUint8Array(s.key, new Uint8Array(s.rgba), s.w, s.h);
      if (!tex) path = 'canvas';
    }
    if (!tex) {
      const cv = document.createElement('canvas');
      cv.width = s.w;
      cv.height = s.h;
      cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.rgba), s.w, s.h), 0, 0);
      tex = tm.addCanvas(s.key, cv);
    }
    if (!tex) {
      console.error(`立体の絵を取り込めなかった：${s.key}`);
      return;
    }
    for (const f of s.frames) tex.add(f.name, 0, f.x, f.y, s.g.fw, s.g.fh);
    const importMs = performance.now() - t0;
    this.stats.importMsMax = Math.max(this.stats.importMsMax, importMs);
    this.stats.importMsTotal += importMs;
    const info: SheetInfo = {
      key: s.key,
      set: s.set,
      scale: s.scale,
      ...(s.model ? { model: s.model } : {}),
      w: s.w,
      h: s.h,
      g: s.g,
      frames: new Map(s.frames.map((f) => [f.name, f])),
      ...(s.teamPx ? { teamPx: s.teamPx } : {}),
      bytes: s.w * s.h * 4,
      places: path === 'uint8' ? 2 : webgl ? 3 : 2,
      path,
      bakeMs: s.ms,
      importMs,
      readyAt: performance.now() - this.startedAt,
      by,
    };
    this.ready.set(s.key, info);
    // シーンが終わったあとに届いた絵は、取り込むだけ（知らせる相手は、シーンが SHUTDOWN でやめている）
    for (const cb of [...this.listeners]) cb(info);
  }
}

function round1(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}

/** ゲーム全体で 1 つ */
export const stackTextures = new StackTextures();
