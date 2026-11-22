// 焼く仕事の列（design §14.3）。ワーカーでも主スレッドでも、同じ列を同じ順で回す。Phaser も DOM も読まない。
// 仕事の区切り：削り出しは部品 1 つごと、焼くのは 1 枚ごと、敵軍の写しは 1 コマごと。1 枚の絵（型 1 つぶんのコマの並び）ができたら emit で出す。

import { angleOf, ANGLES, bakeGeom, bakeOne, colorTable, copySwapped, extentOf, sheetLayout, slotPos, teamPixels, teamSwap, type Extent, type Geom } from './bake.ts';
import { carvePart, emptyVox, makeModel, type Model } from './carve.ts';
import { centerOf, dimsOf, MODEL_IDS, modelParts, TREE_DIMS, TREE_IDS, treeParts, WALK_FRAMES, type ModelId, type TreeId } from './parts.ts';

/** 揃い（配置・公開・戦闘・木） */
export type SetId = 'deploy' | 'reveal' | 'battle' | 'tree';
export const SET_IDS: readonly SetId[] = ['deploy', 'reveal', 'battle', 'tree'];

/** 戦闘の兵の大きさ（どの向きでも 0.84。design §14.3） */
export const BATTLE_SCALE = 0.84;
/** 木を焼く大きさ（配置・公開の 1 と、止まった向きごとの盤の縮み。design §14.7） */
export const TREE_SCALES = [1, 0.65, 0.79, 0.94] as const;

/** 1 コマの中身。soldier は 型 × 陣営 × 歩くコマ × 角度、tree は 木の種 × 角度 */
export type FrameSpec =
  | { readonly t: 'soldier'; readonly model: ModelId; readonly team: 0 | 1; readonly walk: number; readonly angle: number }
  | { readonly t: 'tree'; readonly tree: TreeId; readonly angle: number };

/** 1 枚の絵（テクスチャ 1 つ）の作り方 */
export interface SheetSpec {
  readonly key: string;
  readonly set: SetId;
  readonly scale: number;
  /** 兵の絵なら、その型 */
  readonly model?: ModelId;
  readonly frames: readonly FrameSpec[];
}

/** 列に入れる仕事（ワーカーへ送れる、ただのデータ） */
export type TaskSpec = { readonly t: 'sheet'; readonly spec: SheetSpec } | { readonly t: 'carve'; readonly model: ModelId; readonly walk: number };

/** 焼いたコマ */
export interface BakedFrame {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly ext: Extent;
}

/** 焼いた 1 枚の絵。rgba は w × h × 4 バイト（RGBA） */
export interface BakedSheet {
  readonly key: string;
  readonly set: SetId;
  readonly scale: number;
  readonly model?: ModelId;
  readonly w: number;
  readonly h: number;
  readonly g: Geom;
  readonly frames: readonly BakedFrame[];
  readonly rgba: ArrayBuffer;
  /** この 1 枚に使った時間（ミリ秒。途中で要った削り出しを含む） */
  readonly ms: number;
  /** 焼いた枚数（形を計算した回数）と、敵軍の写しの枚数 */
  readonly baked: number;
  readonly copied: number;
  /** 自軍の歩くコマ 0 を大きさ 1 で焼いたときの、角度ごとの陣営の色の点の数（戦闘の揃いの幟の護衛 A・B だけ。本陣の 2 体の選び方に使う） */
  readonly teamPx?: readonly number[];
}

// ---- 名前 ----

/** 角度の番号を 0..N−1 に収める */
export function wrapAngle(a: number, n = ANGLES): number {
  return ((a % n) + n) % n;
}

export function soldierFrameName(team: 0 | 1, walk: number, angle: number): string {
  return `${team}|${walk}|${angle}`;
}

export function treeFrameName(tree: TreeId, angle: number): string {
  return `${tree}|${angle}`;
}

export function soldierSheetKey(set: Exclude<SetId, 'tree'>, model: ModelId): string {
  return `stk-${set}-${model}`;
}

export function treeSheetKey(scale: number): string {
  return `stk-tree-${scale.toFixed(2)}`;
}

/** 公開の揃いの自軍の角度の番号（−30°〜90°。N=36 なら −3〜9 の 13 個） */
export function revealAngles(n = ANGLES): number[] {
  const out: number[] = [];
  for (let a = -n / 12; a <= n / 4; a++) out.push(wrapAngle(a, n));
  return out;
}

// ---- 揃いの中身 ----

function frameName(f: FrameSpec): string {
  return f.t === 'soldier' ? soldierFrameName(f.team, f.walk, f.angle) : treeFrameName(f.tree, f.angle);
}

/** 配置の揃い（大きさ 1。自軍の上向き＝番号 0、敵軍の下向き＝番号 N/2。歩くコマ 0） */
function deploySpec(model: ModelId, n: number): SheetSpec {
  return {
    key: soldierSheetKey('deploy', model),
    set: 'deploy',
    scale: 1,
    model,
    frames: [
      { t: 'soldier', model, team: 0, walk: 0, angle: 0 },
      { t: 'soldier', model, team: 1, walk: 0, angle: n / 2 },
    ],
  };
}

/** 公開の揃い（大きさ 1。自軍は −30°〜90°、敵軍はそれに N/2 を足したもの。歩くコマ 0） */
function revealSpec(model: ModelId, n: number): SheetSpec {
  const frames: FrameSpec[] = [];
  for (const team of [0, 1] as const) for (const a of revealAngles(n)) frames.push({ t: 'soldier', model, team, walk: 0, angle: wrapAngle(a + team * (n / 2), n) });
  return { key: soldierSheetKey('reveal', model), set: 'reveal', scale: 1, model, frames };
}

/** 戦闘の揃い（大きさ 0.84。両軍 × 歩く 4 コマ × N 角度。敵軍は自軍の写し） */
function battleSpec(model: ModelId, n: number): SheetSpec {
  const frames: FrameSpec[] = [];
  for (const team of [0, 1] as const) for (let w = 0; w < WALK_FRAMES; w++) for (let a = 0; a < n; a++) frames.push({ t: 'soldier', model, team, walk: w, angle: a });
  return { key: soldierSheetKey('battle', model), set: 'battle', scale: BATTLE_SCALE, model, frames };
}

/** 木の揃い（2 種 × N 角度。大きさごとに 1 枚） */
function treeSpec(scale: number, n: number): SheetSpec {
  const frames: FrameSpec[] = [];
  for (const tree of TREE_IDS) for (let a = 0; a < n; a++) frames.push({ t: 'tree', tree, angle: a });
  return { key: treeSheetKey(scale), set: 'tree', scale, frames };
}

/** 揃いの 1 枚 1 枚 */
export function setSheets(set: SetId, n = ANGLES): SheetSpec[] {
  switch (set) {
    case 'deploy':
      return MODEL_IDS.map((m) => deploySpec(m, n));
    case 'reveal':
      return MODEL_IDS.map((m) => revealSpec(m, n));
    case 'battle':
      return MODEL_IDS.map((m) => battleSpec(m, n));
    case 'tree':
      return TREE_SCALES.map((s) => treeSpec(s, n));
  }
}

/**
 * 起動のときの列（design §14.3。上が先）
 * 1. 配置の揃い 2. 木の揃い（大きさ 1） 3. 残りの型の削り出し（歩く 3 コマ） 4. 戦闘の揃い（型の順） 5. 木の揃い（ほかの大きさ）
 */
export function startupTasks(n = ANGLES): TaskSpec[] {
  const trees = setSheets('tree', n);
  const out: TaskSpec[] = [];
  for (const s of setSheets('deploy', n)) out.push({ t: 'sheet', spec: s });
  out.push({ t: 'sheet', spec: trees[0]! });
  for (const m of MODEL_IDS) for (let w = 1; w < WALK_FRAMES; w++) out.push({ t: 'carve', model: m, walk: w });
  for (const s of setSheets('battle', n)) out.push({ t: 'sheet', spec: s });
  for (const s of trees.slice(1)) out.push({ t: 'sheet', spec: s });
  return out;
}

// ---- 列 ----

/** 削り出した型を覚えておく所（列が空になったら捨てる） */
type ModelKey = string;
const soldierModelKey = (m: ModelId, w: number): ModelKey => `${m}|${w}`;
const treeModelKey = (t: TreeId): ModelKey => `tree|${t}`;

interface Running {
  readonly task: TaskSpec;
  readonly gen: Generator<void, void, void>;
  ms: number;
}

/** 列の数え（開発用の口に出す） */
export interface QueueStats {
  carveMs: number;
  carveParts: number;
  baked: number;
  copied: number;
  sheets: number;
  workMs: number;
}

/**
 * 焼く仕事の列。step() で小さな仕事を 1 つ進める。1 枚の絵ができるたびに emit を呼ぶ。
 * skip に入っている絵（もうできている）は作らない（途中で別の入口に引き継ぐため）。
 */
export class BakeQueue {
  readonly n: number;
  readonly stats: QueueStats = { carveMs: 0, carveParts: 0, baked: 0, copied: 0, sheets: 0, workMs: 0 };
  private readonly emit: (s: BakedSheet) => void;
  private readonly now: () => number;
  private readonly models = new Map<ModelKey, Model>();
  private readonly skip: Set<string>;
  private pending: TaskSpec[] = [];
  private cur: Running | null = null;
  private stepStart = 0;

  constructor(emit: (s: BakedSheet) => void, opts: { n?: number; skip?: Iterable<string>; now?: () => number } = {}) {
    this.emit = emit;
    this.n = opts.n ?? ANGLES;
    this.skip = new Set(opts.skip ?? []);
    this.now = opts.now ?? ((): number => performance.now());
  }

  /** 列の後ろに足す */
  push(tasks: readonly TaskSpec[]): void {
    this.pending.push(...tasks);
  }

  /** 列の先頭に入れる（いま途中の 1 枚は、終えてから）。同じ絵がもう列にあれば、そこから抜いて前へ */
  front(tasks: readonly TaskSpec[]): void {
    const keys = new Set(tasks.filter((t) => t.t === 'sheet').map((t) => (t.t === 'sheet' ? t.spec.key : '')));
    this.pending = [...tasks, ...this.pending.filter((t) => !(t.t === 'sheet' && keys.has(t.spec.key)))];
  }

  /** その揃いの、まだできていない仕事を捨てる（途中のものもやめる） */
  cancel(set: SetId): void {
    this.pending = this.pending.filter((t) => !(t.t === 'sheet' && t.spec.set === set));
    if (this.cur && this.cur.task.t === 'sheet' && this.cur.task.spec.set === set) this.cur = null;
  }

  /** できた（または外で取り込んだ）絵として扱い、作らない */
  markDone(key: string): void {
    this.skip.add(key);
  }

  /** まだ作っていない仕事（いま途中のものを含む） */
  remaining(): TaskSpec[] {
    return [...(this.cur ? [this.cur.task] : []), ...this.pending];
  }

  get idle(): boolean {
    return !this.cur && this.pending.length === 0;
  }

  /** 削り出した型の数（ワーカーの外で持ち続けていないか確かめるため） */
  get modelCount(): number {
    return this.models.size;
  }

  /** 型を捨てる */
  dropModels(): void {
    this.models.clear();
  }

  /** 小さな仕事を 1 つ進める。もう仕事がなければ false */
  step(): boolean {
    for (;;) {
      if (!this.cur) {
        const task = this.pending.shift();
        if (!task) return false;
        if (task.t === 'sheet' && this.skip.has(task.spec.key)) continue;
        this.cur = { task, gen: this.run(task), ms: 0 };
      }
      const cur = this.cur;
      const t0 = this.now();
      this.stepStart = t0;
      const r = cur.gen.next();
      const dt = this.now() - t0;
      cur.ms += dt;
      this.stats.workMs += dt;
      if (r.done && this.cur === cur) this.cur = null;
      return true;
    }
  }

  /** ms ミリ秒まで進める（1 つの仕事が終わるたびに時刻を見る）。まだ仕事が残っていれば true */
  runFor(ms: number): boolean {
    const end = this.now() + ms;
    while (this.now() < end) if (!this.step()) return false;
    return !this.idle;
  }

  /** 全部進める */
  runAll(): void {
    while (this.step());
  }

  private *run(task: TaskSpec): Generator<void, void, void> {
    if (task.t === 'carve') {
      yield* this.ensureSoldier(task.model, task.walk);
      return;
    }
    yield* this.bakeSheet(task.spec);
  }

  /** 兵の型（なければ部品 1 つずつ削り出す） */
  private *ensureSoldier(id: ModelId, walk: number): Generator<void, Model, void> {
    const key = soldierModelKey(id, walk);
    const have = this.models.get(key);
    if (have) return have;
    const dims = dimsOf(id);
    const vox = emptyVox(dims);
    for (const e of modelParts(id, walk)) {
      const t0 = this.now();
      carvePart(dims, vox, e, `${id} ${walk}`);
      this.stats.carveMs += this.now() - t0;
      this.stats.carveParts++;
      yield;
    }
    const m = makeModel(dims, vox, centerOf(id));
    this.models.set(key, m);
    return m;
  }

  /** 木の型 */
  private *ensureTree(v: TreeId): Generator<void, Model, void> {
    const key = treeModelKey(v);
    const have = this.models.get(key);
    if (have) return have;
    const vox = emptyVox(TREE_DIMS);
    for (const e of treeParts(v)) {
      const t0 = this.now();
      carvePart(TREE_DIMS, vox, e, `tree${v}`);
      this.stats.carveMs += this.now() - t0;
      this.stats.carveParts++;
      yield;
    }
    const m = makeModel(TREE_DIMS, vox);
    this.models.set(key, m);
    return m;
  }

  private *modelOf(f: FrameSpec): Generator<void, Model, void> {
    return f.t === 'soldier' ? yield* this.ensureSoldier(f.model, f.walk) : yield* this.ensureTree(f.tree);
  }

  /** 1 枚の絵を焼く（1 コマごとに区切る） */
  private *bakeSheet(spec: SheetSpec): Generator<void, void, void> {
    // 枠は、その絵の全部のコマの型が入る大きさ（試作の bakeSet と同じ）
    const used = new Map<string, Model>();
    for (const f of spec.frames) {
      const k = f.t === 'soldier' ? soldierModelKey(f.model, f.walk) : treeModelKey(f.tree);
      if (!used.has(k)) used.set(k, yield* this.modelOf(f));
    }
    let R = 0;
    let H = 0;
    for (const m of used.values()) {
      R = Math.max(R, m.R);
      H = Math.max(H, m.H);
    }
    const g = bakeGeom(R, H, spec.scale);
    const layout = sheetLayout(g, spec.frames.length);
    const rgba = new ArrayBuffer(layout.w * layout.h * 4);
    const buf = new Uint32Array(rgba);
    const vi = new Int32Array(g.fw * g.fh);
    const cmaps = [colorTable(0), colorTable(1)] as const;
    const swap = teamSwap();
    // 自軍のコマの位置（敵軍の写しの元）
    const own = new Map<string, readonly [number, number]>();
    const frames: BakedFrame[] = [];
    const teamPx: number[] = [];
    // 本陣の 2 体の選び方に使う、幟の護衛の陣営の色の点の数（戦闘の揃いのとき、大きさ 1 で数える）
    const countTeam = spec.set === 'battle' && (spec.model === 'guardA' || spec.model === 'guardB');
    const g1 = bakeGeom(R, H, 1);
    const cbuf = new Uint32Array(countTeam ? g1.fw * g1.fh : 0);
    const vi1 = new Int32Array(countTeam ? g1.fw * g1.fh : 0);
    let baked = 0;
    let copied = 0;
    for (let i = 0; i < spec.frames.length; i++) {
      const f = spec.frames[i]!;
      const pos = slotPos(layout, g, i);
      const src = f.t === 'soldier' && f.team === 1 ? own.get(`${f.walk}|${f.angle}`) : undefined;
      if (src) {
        copySwapped(buf, layout.w, src, pos, g, swap);
        copied++;
      } else {
        const m = used.get(f.t === 'soldier' ? soldierModelKey(f.model, f.walk) : treeModelKey(f.tree))!;
        bakeOne(buf, layout.w, pos[0], pos[1], g, m, angleOf(f.angle, this.n), spec.scale, cmaps[f.t === 'soldier' ? f.team : 0], vi);
        baked++;
        if (f.t === 'soldier' && f.team === 0) {
          own.set(`${f.walk}|${f.angle}`, pos);
          if (countTeam && f.walk === 0) {
            // 試作と同じく、大きさ 1 で焼いた絵で数える（0.84 の絵で数えると、選ぶ護衛が試作と 1 つの向きで違う）
            bakeOne(cbuf, g1.fw, 0, 0, g1, m, angleOf(f.angle, this.n), 1, cmaps[0], vi1);
            teamPx[f.angle] = teamPixels(cbuf, g1.fw, 0, 0, g1);
            cbuf.fill(0);
          }
        }
      }
      frames.push({ name: frameName(f), x: pos[0], y: pos[1], ext: extentOf(buf, layout.w, pos[0], pos[1], g) });
      if (i < spec.frames.length - 1) yield;
    }
    // この 1 枚に使った時間＝これまでの区切りの合計＋いまの区切り（待っていた時間は入れない）
    const ms = (this.cur?.ms ?? 0) + (this.now() - this.stepStart);
    this.stats.baked += baked;
    this.stats.copied += copied;
    this.stats.sheets++;
    const out: BakedSheet = {
      key: spec.key,
      set: spec.set,
      scale: spec.scale,
      ...(spec.model ? { model: spec.model } : {}),
      w: layout.w,
      h: layout.h,
      g,
      frames,
      rgba,
      ms,
      baked,
      copied,
      ...(countTeam ? { teamPx } : {}),
    };
    this.skip.add(spec.key);
    this.emit(out);
  }
}
