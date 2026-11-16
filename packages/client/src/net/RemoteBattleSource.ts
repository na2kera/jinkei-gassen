// 対戦の BattleSource（design §5.2）。サーバーの snap を場面に直して流す。号令はサーバーへ送る。
// 場面はサーバーが「自分が下」に返し済みなので、ここでも戦闘の画面でも、座標は返さない。
//
// 出来事の重複は、「刻みと中身が同じ出来事を、何回渡したか」で除く（eventDedup.ts）。
// サーバーが作り直されると tick が少し戻り、同じ出来事がもう一度届くが、渡した回数を超えた分だけを渡す。
// snap の evBase（通し番号）は、重複の判断には使わない（やり直しの区間に新しい号令が入ると番号がずれるため）。
// 「受け取った」と「渡した」は分ける。onFrame を登録する前に届いた出来事・決着は、登録した時点で渡す。

import { canOrderView, type BattleEvent, type BattleSummary, type BattleView, type OrderKind, type OrderTarget, type Side, type UnitView } from '@jinkei/engine';
import type { PackedUnit, SnapMessage } from '@jinkei/server/protocol';
import type { BattleFrame, BattleSource } from '../battle/BattleSource.ts';
import type { RoomClient } from './RoomClient.ts';
import { acceptEvents, createEventDedup } from './eventDedup.ts';

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
  /** 出来事の重複を除くための、渡した回数の記録 */
  private readonly dedup = createEventDedup();
  /** 受け取ったが、まだ画面に渡していない出来事（onFrame の登録前に届いた分） */
  private undelivered: BattleEvent[] = [];
  private view: BattleView | null = null;
  private tick = 0;
  /**
   * 送ったが、まだ残りの回数に反映されていない号令の数。時間では減らさない。
   * 減らすのは、残りの回数が減った snap が届いたとき・invalid_order が返ったとき・つなぎ直して最初の snap のとき
   */
  private pending = 0;
  /** この source が見た、client の入り直しの回数（変わったら、つなぎ直したあと） */
  private session: number;
  private summary: BattleSummary | null = null;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly client: RoomClient,
    readonly battleNo: number,
    private readonly you: Side,
  ) {
    this.session = client.session;
    this.unsubscribe.push(client.onSnap((m) => this.onSnap(m)));
    this.unsubscribe.push(
      client.onError((m) => {
        // 号令が受け付けられなかったら、使った数に入れていた分を1つ戻す
        if (m.reason === 'invalid_order' && this.pending > 0) this.pending--;
      }),
    );
    this.unsubscribe.push(client.subscribe(() => this.checkResult()));
    // すでに届いている場面があれば、受け取っておく（入り直したときも、その時点の戦況から描ける）
    const last = client.snap;
    if (last && last.battleNo === battleNo) this.onSnap(last);
    this.checkResult();
  }

  onFrame(cb: (frame: BattleFrame) => void): void {
    this.frameListeners.push(cb);
    // 登録した時点で、いまの場面を、まだ渡していない出来事を付けて渡す
    if (this.view) this.emit();
  }

  onEnd(cb: (summary: BattleSummary) => void): void {
    this.endListeners.push(cb);
    // すでに決着していれば、その場で渡す（LocalBattleSource と同じ動き）
    if (this.summary) cb(this.summary);
  }

  order(target: OrderTarget, kind: OrderKind): void {
    if (!this.canOrder(target, kind)) return;
    if (this.client.send({ type: 'order', battleNo: this.battleNo, target, kind })) this.pending++;
  }

  canOrder(target: OrderTarget, kind: OrderKind): boolean {
    const v = this.view;
    if (!v || !canOrderView(v, this.you, target, kind)) return false;
    return v.ordersLeft[this.you] - this.pending > 0;
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.frameListeners.length = 0;
    this.endListeners.length = 0;
  }

  private onSnap(m: SnapMessage): void {
    if (m.battleNo !== this.battleNo) return;
    const view = viewOfSnap(m);
    if (this.client.session !== this.session) {
      // つなぎ直したあとの最初の場面：サーバーの残りの回数を正とし、送った号令の数え方を正し直す
      this.session = this.client.session;
      this.pending = 0;
    } else if (this.view && view.ordersLeft[this.you] < this.view.ordersLeft[this.you]) {
      // 残りの回数が減った：送った号令が受け付けられたので、その分を数えるのをやめる
      this.pending = Math.max(0, this.pending - (this.view.ordersLeft[this.you] - view.ordersLeft[this.you]));
    }
    this.view = view;
    this.tick = m.tick;
    // 入り直して最初の snap は events が空なので、その間の出来事は演出しない
    this.undelivered.push(...acceptEvents(this.dedup, m.tick, m.events));
    if (this.frameListeners.length > 0) this.emit();
  }

  /** いまの場面を、まだ渡していない出来事を付けて渡す */
  private emit(): void {
    const view = this.view;
    if (!view) return;
    const events = this.undelivered;
    this.undelivered = [];
    const frame: BattleFrame = { tick: this.tick, view, events };
    for (const cb of [...this.frameListeners]) cb(frame);
  }

  private checkResult(): void {
    const r = this.client.result;
    if (this.summary || !r || r.battleNo !== this.battleNo) return;
    this.summary = r.summary;
    for (const cb of [...this.endListeners]) cb(r.summary);
  }
}
