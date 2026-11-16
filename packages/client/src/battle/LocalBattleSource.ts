// ブラウザで engine を動かす BattleSource（design §5.2）。
// 実時間をためて 0.1 秒（DT）ごとに step を呼ぶ。場面は2刻みごとに出し（対戦の毎秒5回と同じ見え方にする。assumptions S10）、
// 決着した刻みは待たずにすぐ出す。出来事は前の場面のあとの分をまとめて渡す。

import {
  canOrder,
  createBattle,
  DT,
  step,
  summarize,
  viewFor,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type BattleSummary,
  type EngineError,
  type OrderInput,
  type OrderKind,
  type OrderTarget,
  type Side,
} from '@jinkei/engine';
import type { BattleFrame, BattleSource } from './BattleSource.ts';

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
  private buffered: BattleEvent[] = [];
  private speed = 1;
  private acc = 0;
  private last: number | null = null;
  private raf = 0;
  private disposed = false;
  private summary: BattleSummary | null = null;

  /** viewer は見る側の陣営。場面（相手の方針を隠す）と号令は、この陣営のものになる */
  static create(setup: BattleSetup, viewer: Side = 0): { ok: true; source: LocalBattleSource } | { ok: false; error: EngineError } {
    const r = createBattle(setup);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, source: new LocalBattleSource(r.value, viewer) };
  }

  private constructor(
    state: BattleState,
    private readonly viewer: Side,
  ) {
    this.state = state;
    this.raf = requestAnimationFrame(this.loop);
  }

  onFrame(cb: (frame: BattleFrame) => void): void {
    this.frameListeners.push(cb);
    cb({ tick: this.state.tick, view: viewFor(this.state, this.viewer), events: [] });
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

  setSpeed(mult: number): void {
    if (Number.isFinite(mult) && mult > 0) this.speed = mult;
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
    this.acc += (elapsed / 1000) * this.speed;
    while (this.acc >= DT && !this.state.outcome) {
      this.acc -= DT;
      this.stepOnce();
    }
    if (!this.state.outcome) this.raf = requestAnimationFrame(this.loop);
  };

  private stepOnce(): void {
    const orders = this.pending;
    this.pending = [];
    const events = step(this.state, orders);
    for (const e of events) this.buffered.push(e);
    if (this.state.outcome || this.state.tick % FRAME_EVERY === 0) this.emit();
  }

  private emit(): void {
    const frame: BattleFrame = { tick: this.state.tick, view: viewFor(this.state, this.viewer), events: this.buffered };
    this.buffered = [];
    for (const cb of [...this.frameListeners]) cb(frame);
    if (this.state.outcome && !this.summary) {
      this.summary = summarize(this.state);
      for (const cb of [...this.endListeners]) cb(this.summary);
    }
  }
}
