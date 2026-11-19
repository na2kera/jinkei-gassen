// ブラウザで engine を動かす BattleSource（design §5.2）。
// 実時間をためて 0.1 秒（DT）ごとに step を呼ぶ。場面は2刻みごとに出し（対戦の毎秒5回と同じ見え方にする。assumptions S10）、
// 決着した刻みは待たずにすぐ出す。出来事は前の場面のあとの分をまとめて渡す。
// チュートリアル（design §8.5、§8.10-5）では、決めた刻みで step を止め、号令を受けてから再開する。

import {
  canOrder,
  canSummon,
  createBattle,
  DT,
  step,
  summarize,
  viewFor,
  type BattleEvent,
  type BattleSetup,
  type BattleView,
  type BattleState,
  type BattleSummary,
  type EngineError,
  type OrderInput,
  type OrderKind,
  type OrderTarget,
  type ReserveFrom,
  type ReserveInput,
  type ReserveView,
  type Side,
} from '@jinkei/engine';
import type { BattleFrame, BattleSource } from './BattleSource.ts';
import { summonEnabled } from './reserveUi.ts';

/** 何刻みごとに場面を出すか */
const FRAME_EVERY = 2;
/**
 * 1回の描画でためる実時間の上限（ミリ秒）。タブが裏に回って戻ったときに、
 * 何百刻みも一気に進めて画面が飛ぶのを防ぐ（その間は止まっていたことにする）。
 */
const MAX_ACCUMULATE_MS = 250;

export class LocalBattleSource implements BattleSource {
  private readonly state: BattleState;
  private readonly frameListeners: ((f: BattleFrame) => void)[] = [];
  private readonly endListeners: ((s: BattleSummary) => void)[] = [];
  private pending: OrderInput[] = [];
  /** 次の step に渡す遊軍の呼び出し（1つまで） */
  private pendingSummon: ReserveInput | null = null;
  private buffered: BattleEvent[] = [];
  private speed = 1;
  private acc = 0;
  private last: number | null = null;
  private raf = 0;
  private disposed = false;
  private summary: BattleSummary | null = null;
  private lastView: BattleView | null = null;
  private readonly viewer: Side;
  /** この刻みに達したら止める（チュートリアルだけ。1回だけ） */
  private pauseTick: number | null = null;
  private pauseCb: (() => void) | null = null;
  private isPaused = false;

  /** viewer は見る側の陣営。場面（相手の方針を隠す）と号令は、この陣営のものになる */
  static create(setup: BattleSetup, viewer: Side = 0): { ok: true; source: LocalBattleSource } | { ok: false; error: EngineError } {
    const r = createBattle(setup);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, source: new LocalBattleSource(r.value, viewer) };
  }

  private constructor(state: BattleState, viewer: Side) {
    this.state = state;
    this.viewer = viewer;
    this.raf = requestAnimationFrame(this.loop);
  }

  onFrame(cb: (frame: BattleFrame) => void): void {
    this.frameListeners.push(cb);
    this.lastView = viewFor(this.state, this.viewer);
    cb({ tick: this.state.tick, view: this.lastView, events: [] });
  }

  onEnd(cb: (summary: BattleSummary) => void): void {
    this.endListeners.push(cb);
    if (this.summary) cb(this.summary);
  }

  order(target: OrderTarget, kind: OrderKind): void {
    if (!this.canOrder(target, kind)) return;
    // 次の step にまとめて渡す（engine は step の初めに号令を受け付ける）
    this.pending.push({ side: this.viewer, target, kind });
  }

  canOrder(target: OrderTarget, kind: OrderKind): boolean {
    const left = viewFor(this.state, this.viewer).ordersLeft[this.viewer];
    if (left - this.pending.length <= 0) return false;
    return canOrder(this.state, this.viewer, target, kind).ok;
  }

  reserve(): ReserveView | null {
    // 最後に出した場面から読む（毎回 viewFor を作り直さないため）
    return (this.lastView ?? viewFor(this.state, this.viewer)).reserve?.[this.viewer] ?? null;
  }

  canSummon(): boolean {
    // 現れるマスまでは見ない（押したときに engine の canSummon で調べる）
    return summonEnabled(this.reserve(), { ended: !!this.state.outcome, allowed: true, sent: this.pendingSummon !== null });
  }

  summon(from: ReserveFrom): void {
    if (!this.canSummon() || !canSummon(this.state, this.viewer, from).ok) return;
    // 次の step にまとめて渡す（engine は step の初めに、号令より先に遊軍を呼ぶ）
    this.pendingSummon = { side: this.viewer, from };
  }

  setSpeed(mult: number): void {
    if (Number.isFinite(mult) && mult > 0) this.speed = mult;
  }

  /**
   * その刻みに達したら step を止め、その場面を出してから cb を呼ぶ。1回だけ（チュートリアルの号令。design §8.5）。
   * BattleSource の形には足さない（チュートリアルは1人用だけ）
   */
  pauseAt(tick: number, cb: () => void): void {
    this.pauseTick = tick;
    this.pauseCb = cb;
  }

  /** 止まっているか */
  get paused(): boolean {
    return this.isPaused;
  }

  /** 再開する。止まっている間にたまった実時間は捨てる（まだ step に渡していない号令は残す） */
  resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.acc = 0;
    this.last = null;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.frameListeners.length = 0;
    this.endListeners.length = 0;
  }

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    const elapsed = this.last === null ? 0 : Math.min(MAX_ACCUMULATE_MS, now - this.last);
    this.last = now;
    // 止まっている間は時間をためない（場面の描画は、最後の場面のまま続く）
    if (!this.isPaused) this.acc += (elapsed / 1000) * this.speed;
    while (!this.isPaused && this.acc >= DT && !this.state.outcome) {
      this.acc -= DT;
      this.stepOnce();
      // 止めるかは1刻みごとに調べる（1回の描画で何刻みも進めることがあるため。design §8.10-5）
      if (this.pauseTick !== null && this.state.tick === this.pauseTick && !this.state.outcome) this.pauseHere();
    }
    if (!this.state.outcome) this.raf = requestAnimationFrame(this.loop);
  };

  private stepOnce(): void {
    const orders = this.pending;
    this.pending = [];
    const summons = this.pendingSummon ? [this.pendingSummon] : [];
    this.pendingSummon = null;
    // 遊軍の入力がなければ、いままでと同じ呼び方にする
    const events = summons.length > 0 ? step(this.state, orders, summons) : step(this.state, orders);
    for (const e of events) this.buffered.push(e);
    if (this.state.outcome || this.state.tick % FRAME_EVERY === 0) this.emit();
  }

  /** 止める刻みに達した：その場面を出してから（まだ出していなければ）cb を呼ぶ */
  private pauseHere(): void {
    this.pauseTick = null;
    this.isPaused = true;
    if (this.state.tick % FRAME_EVERY !== 0) this.emit();
    const cb = this.pauseCb;
    this.pauseCb = null;
    cb?.();
  }

  private emit(): void {
    const frame: BattleFrame = { tick: this.state.tick, view: viewFor(this.state, this.viewer), events: this.buffered };
    this.lastView = frame.view;
    this.buffered = [];
    for (const cb of [...this.frameListeners]) cb(frame);
    if (this.state.outcome && !this.summary) {
      this.summary = summarize(this.state);
      for (const cb of [...this.endListeners]) cb(this.summary);
    }
  }
}
