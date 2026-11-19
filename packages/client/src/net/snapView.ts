// 対戦の snap を、戦闘の画面が読む場面（BattleView）に直す。RemoteBattleSource から分けて、画面なしで確かめられるようにした。
// 場面はサーバーが「自分が下」に返し済みなので、座標は返さない。

import type { BattleView, ReserveView, Side, UnitView } from '@jinkei/engine';
import type { PackedUnit, SnapMessage } from '@jinkei/server/protocol';

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

/** snap の遊軍（自分のぶんだけ届く）。項目がない古い server や、形の合わない値は null として読む */
export function snapReserve(m: Pick<SnapMessage, 'reserve'>): ReserveView | null {
  const r: unknown = m.reserve;
  if (typeof r !== 'object' || r === null) return null;
  const v = r as ReserveView;
  return v.state === 'waiting' || v.state === 'ready' || v.state === 'used' ? { kind: v.kind, stance: v.stance, state: v.state } : null;
}

/**
 * snap を場面に直す。遊軍は you の側に入れ、相手の側は null（design §7.7）。
 * 自分に遊軍がなければ、項目ごと入れない（engine の viewFor と同じく、遊軍のない戦いの場面の形を変えない）
 */
export function viewOfSnap(m: SnapMessage, you: Side): BattleView {
  const view: BattleView = {
    tick: m.tick,
    maxTicks: m.maxTicks,
    units: m.units.map(unpackUnit),
    ordersLeft: [m.ordersLeft[0], m.ordersLeft[1]],
    outcome: m.outcome,
  };
  const mine = snapReserve(m);
  if (mine) view.reserve = you === 0 ? [mine, null] : [null, mine];
  return view;
}
