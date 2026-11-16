// 対戦の BattleSource（design §5.2）。サーバーの snap を場面に直して流す。号令はサーバーへ送る。
// 場面はサーバーが「自分が下」に返し済みなので、ここでも戦闘の画面でも、座標は返さない。
// サーバーが作り直されると、tick が少し戻り、同じ出来事がもう一度届くことがある。
// tick が戻った snap はそのまま流し（補間が描き直す）、出来事は tick と中身で重複を除く。

import { canOrderView, type BattleEvent, type BattleSummary, type BattleView, type OrderKind, type OrderTarget, type Side, type UnitView } from '@jinkei/engine';
import type { PackedUnit, SnapMessage } from '@jinkei/server/protocol';
import type { BattleFrame, BattleSource } from '../battle/BattleSource.ts';
import type { RoomClient } from './RoomClient.ts';

/** 送った号令が、出来事として返ってくるまで「使った」と数えておく長さ（ミリ秒）。返ってこなければ数えるのをやめる */
const PENDING_MS = 3000;

/**
 * 詰めた配列を UnitView に戻す（並びは protocol の PackedUnit のとおり）。
 * server の flip.ts には戻す関数がないので、client 側で戻す。
 */
export function unpackUnit(p: PackedUnit): UnitView {
  const [id, side, kind, wing, x, y, fx, fy, men, maxMen, morale, status, order, attacking, stance] = p;
  const u: UnitView = { id, side, kind, wing, x, y, fx, fy, men, maxMen, morale, status, order, attacking };
  if (stance !== null) u.stance = stance;
  return u;
}

export function viewOfSnap(m: SnapMessage): BattleView {
  return {
    tick: m.tick,
    maxTicks: m.maxTicks,
    units: m.units.map(unpackUnit),
    ordersLeft: [m.ordersLeft[0], m.ordersLeft[1]],
    outcome: m.outcome,
  };
}

export class RemoteBattleSource implements BattleSource {
  private readonly frameListeners: ((f: BattleFrame) => void)[] = [];
  private readonly endListeners: ((s: BattleSummary) => void)[] = [];
  private readonly seen = new Set<string>();
  private view: BattleView | null = null;
  private pending: number[] = [];
  private summary: BattleSummary | null = null;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly client: RoomClient,
    readonly battleNo: number,
    private readonly you: Side,
  ) {
    this.unsubscribe.push(client.onSnap((m) => this.onSnap(m)));
    this.unsubscribe.push(
      client.onError((m) => {
        // 号令が受け付けられなかったら、使った数に入れていた分を1つ戻す
        if (m.reason === 'invalid_order') this.pending.shift();
      }),
    );
    this.unsubscribe.push(client.subscribe(() => this.checkResult()));
  }

  onFrame(cb: (frame: BattleFrame) => void): void {
    this.frameListeners.push(cb);
    // すでに届いている場面があれば、すぐ渡す（入り直したときも、その時点の戦況から描ける）
    const last = this.client.snap;
    if (last && last.battleNo === this.battleNo) this.onSnap(last, cb);
  }

  onEnd(cb: (summary: BattleSummary) => void): void {
    this.endListeners.push(cb);
    this.checkResult();
  }

  order(target: OrderTarget, kind: OrderKind): void {
    if (!this.canOrder(target, kind)) return;
    if (this.client.send({ type: 'order', battleNo: this.battleNo, target, kind })) this.pending.push(Date.now());
  }

  canOrder(target: OrderTarget, kind: OrderKind): boolean {
    const v = this.view;
    if (!v || !canOrderView(v, this.you, target, kind)) return false;
    const now = Date.now();
    this.pending = this.pending.filter((t) => now - t < PENDING_MS);
    return v.ordersLeft[this.you] - this.pending.length > 0;
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.frameListeners.length = 0;
    this.endListeners.length = 0;
  }

  private onSnap(m: SnapMessage, only?: (f: BattleFrame) => void): void {
    if (m.battleNo !== this.battleNo) return;
    const view = viewOfSnap(m);
    // 号令の残りが減っていたら、送った号令が受け付けられたので、使った数から外す
    if (this.view && view.ordersLeft[this.you] < this.view.ordersLeft[this.you]) {
      this.pending.splice(0, this.view.ordersLeft[this.you] - view.ordersLeft[this.you]);
    }
    this.view = view;
    const events: BattleEvent[] = [];
    for (const e of m.events) {
      const key = JSON.stringify(e);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      events.push(e);
    }
    const frame: BattleFrame = { tick: m.tick, view, events };
    for (const cb of only ? [only] : [...this.frameListeners]) cb(frame);
  }

  private checkResult(): void {
    const r = this.client.result;
    if (this.summary || !r || r.battleNo !== this.battleNo) return;
    this.summary = r.summary;
    for (const cb of [...this.endListeners]) cb(r.summary);
  }
}
