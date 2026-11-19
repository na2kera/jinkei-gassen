// チュートリアル（design §8.9・§8.10 の U3〜U6）のうち、Phaser なしで確かめられる部分。
// 手順の進み方と受け付ける操作、一行の長さ、戦闘を止めて再開する口（実時間の進め方を変えても同じ結果か）、保存の済みの印。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBattle,
  KINDS,
  ORDER_KINDS,
  ORDER_TARGETS,
  STANCES,
  step,
  summarize,
  TUTORIAL_ARMY,
  TUTORIAL_ORDER,
  TUTORIAL_ORDER_TICK,
  tutorialSetup,
  type BattleSummary,
  type OrderInput,
} from '@jinkei/engine';
import type { BattleFrame } from '../src/battle/BattleSource.ts';
import { emptySave, sanitizeSave } from '../src/saveFormat.ts';
import {
  allowed,
  apply,
  armyOf,
  armyReady,
  line,
  lit,
  newRun,
  TUTORIAL_LINES,
  type TutorialAction,
  type TutorialRun,
  type TutorialStep,
} from '../src/tutorial/steps.ts';

// ---- 手順（U3） ----

const HQ = { col: 5, row: 14 };
const INF = [
  { col: 4, row: 10 },
  { col: 5, row: 10 },
  { col: 6, row: 10 },
];

/** 当てはめて、受け付けたことを確かめる */
function ok(run: TutorialRun, a: TutorialAction): TutorialRun {
  assert.equal(allowed(run, a), true, `${run.step} で ${JSON.stringify(a)} を受け付けない`);
  const next = apply(run, a);
  assert.notEqual(next, run);
  return next;
}

/** 受け付けず、状態が変わらないことを確かめる */
function ng(run: TutorialRun, a: TutorialAction): void {
  assert.equal(allowed(run, a), false, `${run.step} で ${JSON.stringify(a)} を受け付けた`);
  assert.equal(apply(run, a), run);
}

/** 試す操作の一覧（すべての兵種・すべてのマス・すべての方針・すべての号令と翼・手順の合図） */
function everyAction(): TutorialAction[] {
  const out: TutorialAction[] = [];
  for (const kind of KINDS) out.push({ type: 'pickKind', kind });
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 12; col++) {
      out.push({ type: 'cell', col, row });
      out.push({ type: 'unit', col, row });
    }
  }
  for (const stance of STANCES) out.push({ type: 'stance', stance });
  for (const target of ORDER_TARGETS) out.push({ type: 'target', target });
  for (const kind of ORDER_KINDS) out.push({ type: 'order', kind });
  out.push({ type: 'dismissStance' }, { type: 'start' }, { type: 'paused' }, { type: 'ended' });
  return out;
}

/** その状態で受け付ける操作だけを返す */
function accepted(run: TutorialRun): TutorialAction[] {
  return everyAction().filter((a) => allowed(run, a));
}

/** 歩兵を置く順を変えて、最初から done まで進める。途中の状態を返す */
function walk(order: number[]): Record<string, TutorialRun> {
  const at: Record<string, TutorialRun> = {};
  let r = newRun('auto');
  at.placeHq = r;
  r = ok(r, { type: 'pickKind', kind: 'hq' });
  at.placeHqPicked = r;
  r = ok(r, { type: 'cell', ...HQ });
  at.placeInf = r;
  r = ok(r, { type: 'pickKind', kind: 'infantry' });
  at.placeInfPicked = r;
  for (const i of order) r = ok(r, { type: 'cell', ...INF[i]! });
  at.tapUnit = r;
  r = ok(r, { type: 'unit', col: 5, row: 10 });
  at.pickStance = r;
  r = ok(r, { type: 'stance', stance: 'hunt' });
  at.start = r;
  r = ok(r, { type: 'start' });
  at.march = r;
  r = ok(r, { type: 'paused' });
  at.order = r;
  r = ok(r, { type: 'target', target: 'all' });
  at.orderPicked = r;
  r = ok(r, { type: 'order', kind: 'charge' });
  at.fight = r;
  r = ok(r, { type: 'ended' });
  at.done = r;
  return at;
}

const PERMS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

test('手順は表の順に進み、各手順で受け付ける操作は表のものだけ', () => {
  const at = walk([0, 1, 2]);
  const steps: [string, TutorialStep][] = [
    ['placeHq', 'placeHq'],
    ['placeHqPicked', 'placeHq'],
    ['placeInf', 'placeInf'],
    ['placeInfPicked', 'placeInf'],
    ['tapUnit', 'tapUnit'],
    ['pickStance', 'pickStance'],
    ['start', 'start'],
    ['march', 'march'],
    ['order', 'order'],
    ['orderPicked', 'order'],
    ['fight', 'fight'],
    ['done', 'done'],
  ];
  for (const [k, s] of steps) assert.equal(at[k]!.step, s, k);
  const key = (a: TutorialAction): string => JSON.stringify(a);
  const expect: Record<string, TutorialAction[]> = {
    placeHq: [{ type: 'pickKind', kind: 'hq' }],
    placeHqPicked: [{ type: 'pickKind', kind: 'hq' }, { type: 'cell', ...HQ }],
    placeInf: [{ type: 'pickKind', kind: 'infantry' }],
    placeInfPicked: [{ type: 'pickKind', kind: 'infantry' }, ...INF.map((c) => ({ type: 'cell' as const, ...c }))],
    tapUnit: [{ type: 'unit', col: 5, row: 10 }],
    pickStance: [{ type: 'stance', stance: 'hunt' }, { type: 'dismissStance' }],
    start: [{ type: 'start' }],
    march: [{ type: 'paused' }],
    order: [{ type: 'target', target: 'all' }],
    orderPicked: [{ type: 'order', kind: 'charge' }],
    fight: [{ type: 'ended' }],
    done: [],
  };
  for (const [k, list] of Object.entries(expect)) {
    assert.deepEqual(accepted(at[k]!).map(key).sort(), list.map(key).sort(), k);
  }
});

test('表にない操作（別の兵種・別のマス・別の部隊・別の方針・順を飛ばした操作・別の号令や翼）は受け付けず、状態が変わらない', () => {
  const at = walk([0, 1, 2]);
  for (const run of Object.values(at)) {
    for (const a of everyAction()) if (!allowed(run, a)) ng(run, a);
  }
  // いくつかを名指しで
  ng(at.placeHq!, { type: 'cell', ...HQ }); // 兵種を選ぶ前に置く
  ng(at.placeHq!, { type: 'pickKind', kind: 'infantry' });
  ng(at.placeHqPicked!, { type: 'cell', col: 5, row: 13 });
  ng(at.placeInfPicked!, { type: 'cell', ...HQ });
  ng(at.tapUnit!, { type: 'unit', col: 4, row: 10 });
  ng(at.tapUnit!, { type: 'unit', ...HQ });
  ng(at.pickStance!, { type: 'stance', stance: 'advance' });
  ng(at.tapUnit!, { type: 'start' });
  ng(at.start!, { type: 'paused' });
  ng(at.order!, { type: 'order', kind: 'charge' }); // 翼を選ぶ前の号令
  ng(at.order!, { type: 'target', target: 'left' });
  ng(at.orderPicked!, { type: 'order', kind: 'brace' });
  ng(at.orderPicked!, { type: 'target', target: 'all' }); // 2度目の「全軍」
  ng(at.march!, { type: 'target', target: 'all' });
  ng(at.fight!, { type: 'order', kind: 'charge' });
});

test('置いたマスにはもう置けない（歩兵の光るマスは、まだ空いている所だけ）', () => {
  let r = walk([0, 1, 2]).placeInfPicked!;
  r = ok(r, { type: 'cell', ...INF[1]! });
  ng(r, { type: 'cell', ...INF[1]! });
  assert.deepEqual(lit(r).cells, [INF[0], INF[2]]);
  // 選んだ兵種は、置いたあとも選んだまま
  assert.equal(r.picked, 'infantry');
});

test('方針の箱を閉じる：pickStance → dismissStance → tapUnit → 押し直す → pickStance。ほかの手順では受け付けない', () => {
  const at = walk([0, 1, 2]);
  let r = ok(at.pickStance!, { type: 'dismissStance' });
  assert.equal(r.step, 'tapUnit');
  r = ok(r, { type: 'unit', col: 5, row: 10 });
  assert.equal(r.step, 'pickStance');
  r = ok(r, { type: 'stance', stance: 'hunt' });
  assert.equal(r.step, 'start');
  for (const [k, run] of Object.entries(at)) {
    if (k !== 'pickStance') ng(run, { type: 'dismissStance' });
  }
});

test('歩兵を置く順の 6 通りすべてで、armyOf が TUTORIAL_ARMY と同じ中身・同じ順になる', () => {
  for (const order of PERMS) {
    const at = walk(order);
    assert.deepEqual(armyOf(at.start!), TUTORIAL_ARMY, order.join(''));
    assert.equal(armyReady(at.start!), true);
    // 置いた順は、置いた順のまま持つ
    assert.deepEqual(
      at.start!.placed.slice(1).map((p) => p.col),
      order.map((i) => INF[i]!.col),
    );
    // 方針を選ぶ前は、置いた部隊の方針は兵種の初期設定
    assert.equal(at.tapUnit!.placed.find((p) => p.col === 5 && p.row === 10)?.stance, 'advance');
    assert.equal(at.start!.placed.find((p) => p.col === 5 && p.row === 10)?.stance, 'hunt');
  }
  // 置き終えていなければ、戦いに渡せない
  assert.equal(armyReady(walk([0, 1, 2]).placeInfPicked!), false);
});

test('目立たせるもの', () => {
  const at = walk([2, 0, 1]);
  const none = { kinds: [], cells: [], stances: [], start: false, targets: [], orders: [], next: false };
  assert.deepEqual(lit(at.placeHq!), { ...none, kinds: ['hq'] });
  assert.deepEqual(lit(at.placeHqPicked!), { ...none, cells: [HQ] });
  assert.deepEqual(lit(at.placeInf!), { ...none, kinds: ['infantry'] });
  assert.deepEqual(lit(at.placeInfPicked!), { ...none, cells: INF });
  assert.deepEqual(lit(at.tapUnit!), { ...none, cells: [{ col: 5, row: 10 }] });
  assert.deepEqual(lit(at.pickStance!), { ...none, stances: ['hunt'] });
  assert.deepEqual(lit(at.start!), { ...none, start: true });
  assert.deepEqual(lit(at.march!), none);
  assert.deepEqual(lit(at.order!), { ...none, targets: ['all'] });
  assert.deepEqual(lit(at.orderPicked!), { ...none, orders: ['charge'] });
  assert.deepEqual(lit(at.fight!), none);
  assert.deepEqual(lit(at.done!), { ...none, next: true });
});

// ---- 一行（U4） ----

test('どの手順の一行も、全角 18 文字以内。表の文のとおり', () => {
  for (const [s, text] of Object.entries(TUTORIAL_LINES)) assert.ok([...text].length <= 18, `${s}: ${text}`);
  const at = walk([0, 1, 2]);
  assert.equal(line(at.placeHq!), '本陣を選んで、光るマスに置こう');
  assert.equal(line(at.placeInf!), '歩兵を3つ、光るマスに置こう');
  assert.equal(line(at.tapUnit!), '部隊を押すと、動き方を選べる');
  assert.equal(line(at.pickStance!), '「本陣狙い」を選ぼう');
  assert.equal(line(at.start!), '開戦。あとは部隊が自分で戦う');
  assert.equal(line(at.march!), line(at.start!));
  assert.equal(line(at.order!), '号令で、全軍に突撃を命じよう');
  assert.equal(line(at.fight!), '敵の本陣を落とせば勝ち');
  assert.equal(line(at.done!), '動き方と号令は、先の面で使える');
});

// ---- 戦闘を止める（U5） ----

// LocalBattleSource は requestAnimationFrame で回るので、テストではそれを差し替えて、渡す時刻を決める
let pendingFrame: ((now: number) => void) | null = null;
const g = globalThis as unknown as Record<string, unknown>;
g.requestAnimationFrame = (cb: (now: number) => void): number => {
  pendingFrame = cb;
  return 1;
};
g.cancelAnimationFrame = (): void => {
  pendingFrame = null;
};
const { LocalBattleSource } = await import('../src/battle/LocalBattleSource.ts');

/** engine だけで走らせた結果（U1 と同じ進め方） */
function engineRun(): { winner: unknown; reason: string; tick: number; lastTick: number; seconds: number; remaining: [number, number] } {
  const r = createBattle(tutorialSetup());
  if (!r.ok) throw new Error(r.error.message);
  const s = r.value;
  for (let i = 0; i < TUTORIAL_ORDER_TICK; i++) step(s, []);
  const o: OrderInput = { side: 0, target: TUTORIAL_ORDER.target, kind: TUTORIAL_ORDER.kind };
  step(s, [o]);
  while (!s.outcome) step(s, []);
  // tick は決着の刻み（outcome.tick）、lastTick は決着した step のあとの state.tick（最後の場面の刻み）
  const sum = summarize(s);
  return { winner: s.outcome.winner, reason: s.outcome.reason, tick: s.outcome.tick, lastTick: s.tick, seconds: sum.seconds, remaining: sum.remaining };
}

interface Driven {
  summary: BattleSummary | null;
  frames: BattleFrame[];
  pausedAtTick: number | null;
  orderEvents: { tick: number }[];
}

/**
 * LocalBattleSource を tutorialSetup() で作り、gaps（描画の間隔・ミリ秒）を順にくり返して時刻を進める。
 * 止まったら stillMs だけ時刻を進めて（止まっている間も描画は回る）、号令を渡して再開する
 */
function drive(gaps: number[], stillMs: number, stillGap = 16): Driven {
  pendingFrame = null;
  const made = LocalBattleSource.create(tutorialSetup());
  assert.ok(made.ok);
  const src = made.source;
  const out: Driven = { summary: null, frames: [], pausedAtTick: null, orderEvents: [] };
  src.onFrame((f) => {
    out.frames.push(f);
    for (const e of f.events) if (e.type === 'order') out.orderEvents.push({ tick: e.tick });
  });
  src.onEnd((s) => {
    out.summary = s;
  });
  let pausedCalls = 0;
  src.pauseAt(TUTORIAL_ORDER_TICK, () => {
    pausedCalls++;
    out.pausedAtTick = out.frames[out.frames.length - 1]!.tick;
  });
  let now = 1000;
  let i = 0;
  let guard = 0;
  while (pendingFrame && guard++ < 100000) {
    const cb: (now: number) => void = pendingFrame;
    pendingFrame = null;
    cb(now);
    if (src.paused) {
      assert.equal(out.pausedAtTick, TUTORIAL_ORDER_TICK);
      const framesBefore = out.frames.length;
      // 止まっている間に時間を進めても、刻みが 50 のまま
      for (let t = 0; t < stillMs && pendingFrame; t += stillGap) {
        const c: (now: number) => void = pendingFrame;
        pendingFrame = null;
        now += stillGap;
        c(now);
      }
      assert.equal(out.frames.length, framesBefore, '止まっている間に場面が出た');
      assert.equal(out.frames[out.frames.length - 1]!.tick, TUTORIAL_ORDER_TICK);
      assert.equal(src.canOrder(TUTORIAL_ORDER.target, TUTORIAL_ORDER.kind), true);
      src.order(TUTORIAL_ORDER.target, TUTORIAL_ORDER.kind);
      src.resume();
      assert.equal(src.paused, false);
    }
    now += gaps[i++ % gaps.length]!;
  }
  assert.equal(pausedCalls, 1);
  src.dispose();
  return out;
}

test('止めて号令を渡して再開すると、engine だけで走らせた結果と一致する（実時間の進め方を変えても同じ）', () => {
  const want = engineRun();
  assert.deepEqual({ winner: want.winner, reason: want.reason, tick: want.tick }, { winner: 0, reason: 'hq', tick: 256 });
  const cases: { name: string; gaps: number[]; still: number; stillGap?: number }[] = [
    { name: '16ms', gaps: [16], still: 2000 },
    { name: 'ふぞろい', gaps: [7, 33, 16, 101, 3, 48, 250, 1], still: 500 },
    { name: '250ms を超える', gaps: [400, 1000, 260], still: 300 },
    { name: '長く止めたあとの再開', gaps: [16, 17], still: 60000, stillGap: 5000 },
  ];
  for (const c of cases) {
    const got = drive(c.gaps, c.still, c.stillGap);
    assert.ok(got.summary, c.name);
    assert.equal(got.summary.winner, want.winner, c.name);
    assert.equal(got.summary.reason, want.reason, c.name);
    assert.deepEqual(got.summary.remaining, want.remaining, c.name);
    assert.equal(got.summary.seconds, want.seconds, c.name);
    assert.equal(got.frames[got.frames.length - 1]!.tick, want.lastTick, c.name);
    // 号令の出来事は、刻み 50 に1回だけ
    assert.deepEqual(got.orderEvents, [{ tick: TUTORIAL_ORDER_TICK }], c.name);
    // 止まる前の場面は、刻み 50 を越えない
    const idx = got.frames.findIndex((f) => f.tick === TUTORIAL_ORDER_TICK);
    assert.ok(idx >= 0, c.name);
    assert.ok(got.frames.slice(0, idx).every((f) => f.tick < TUTORIAL_ORDER_TICK), c.name);
  }
});

test('pauseAt を呼ばなければ、いままでどおり止まらずに決着まで進む', () => {
  pendingFrame = null;
  const made = LocalBattleSource.create(tutorialSetup());
  assert.ok(made.ok);
  const src = made.source;
  let ended: BattleSummary | null = null;
  src.onEnd((s) => {
    ended = s;
  });
  let now = 0;
  for (let i = 0; i < 100000 && pendingFrame; i++) {
    const cb: (now: number) => void = pendingFrame;
    pendingFrame = null;
    now += 50;
    cb(now);
    assert.equal(src.paused, false);
  }
  assert.ok(ended);
  src.dispose();
});

// ---- 保存（U6） ----

test('保存の済みの印：古い保存・真偽値でない値・範囲の外の星・v の違う保存・空の保存', () => {
  const base = { v: 1, placements: {}, muted: false };
  // 項目のない古い保存：星があれば済み、なければ済みでない
  assert.equal(sanitizeSave({ ...base, stars: { '1-1': 1 } }).tutorialDone, true);
  assert.equal(sanitizeSave({ ...base, stars: { '1-1': 0 } }).tutorialDone, false);
  assert.equal(sanitizeSave({ ...base, stars: {} }).tutorialDone, false);
  assert.equal(sanitizeSave({ ...base }).tutorialDone, false);
  // 真偽値ならその値（明示的な false と星あり → 済みでない）
  assert.equal(sanitizeSave({ ...base, stars: { '1-1': 3 }, tutorialDone: false }).tutorialDone, false);
  assert.equal(sanitizeSave({ ...base, stars: {}, tutorialDone: true }).tutorialDone, true);
  // 真偽値でない印は、項目がないのと同じ（星ありなら済み、なしなら済みでない）
  for (const v of ['true', 1, null, {}, []]) {
    assert.equal(sanitizeSave({ ...base, stars: { '1-2': 2 }, tutorialDone: v }).tutorialDone, true, JSON.stringify(v));
    assert.equal(sanitizeSave({ ...base, stars: {}, tutorialDone: v }).tutorialDone, false, JSON.stringify(v));
  }
  // 掃除で捨てる星（範囲の外の数や文字列）は数えない
  assert.equal(sanitizeSave({ ...base, stars: { '1-1': 4, '1-2': '2', '1-3': 1.5, '1-4': -1 } }).tutorialDone, false);
  // v が違う保存は空の保存になる
  assert.equal(sanitizeSave({ ...base, v: 2, stars: { '1-1': 3 }, tutorialDone: true }).tutorialDone, false);
  // 空の保存（clearSave のあとと同じ）は済みでない
  assert.equal(emptySave().tutorialDone, false);
  // 書いたものを読み直すと同じ（markTutorialDone のあとに読み直すと済み）
  const saved = { ...emptySave(), tutorialDone: true };
  assert.equal(sanitizeSave(JSON.parse(JSON.stringify(saved))).tutorialDone, true);
});
