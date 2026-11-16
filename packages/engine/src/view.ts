// 映す側に渡す場面と、振り返り（design §3.4）。
// 渡してよい項目だけを書き出して作る（状態を複製して項目を消す作りにしない）。相手の方針・狙い・持ち場・迂回の進み具合・助走は渡さない。

import { remainingRatio } from './battle.ts';
import { DT, T } from './tuning.ts';
import type { BattleState, BattleSummary, BattleView, Side, UnitView } from './types.ts';

export function viewFor(state: BattleState, viewer: Side | 'both'): BattleView {
  const units: UnitView[] = state.units.map((u) => {
    const v: UnitView = {
      id: u.id,
      side: u.side,
      kind: u.kind,
      wing: u.wing,
      x: u.x,
      y: u.y,
      fx: u.fx,
      fy: u.fy,
      men: u.men,
      maxMen: u.maxMen,
      morale: u.morale,
      status: u.status,
      order: u.order ? u.order.kind : null,
      attacking: u.attacking,
    };
    if (viewer === 'both' || viewer === u.side) v.stance = u.stance;
    return v;
  });
  return {
    tick: state.tick,
    maxTicks: state.maxTicks,
    units,
    ordersLeft: [T.maxOrders - state.ordersUsed[0], T.maxOrders - state.ordersUsed[1]],
    outcome: state.outcome ? { winner: state.outcome.winner, reason: state.outcome.reason, tick: state.outcome.tick } : null,
  };
}

/** 振り返り。決着前に呼ぶと winner は 'draw'、reason は 'ongoing'、seconds はいままでの秒数 */
export function summarize(state: BattleState): BattleSummary {
  const o = state.outcome;
  return {
    winner: o ? o.winner : 'draw',
    reason: o ? o.reason : 'ongoing',
    seconds: Math.round((o ? o.tick + 1 : state.tick) * DT * 10) / 10,
    remaining: [remainingRatio(state, 0), remainingRatio(state, 1)],
    units: state.units.map((u) => ({
      id: u.id,
      side: u.side,
      kind: u.kind,
      menLeft: u.men,
      dealt: u.stats.dealt,
      routsCaused: u.stats.routsCaused,
      fate: u.status === 'active' ? 'alive' : u.goneReason === 'destroyed' ? 'destroyed' : 'routed',
    })),
    firstBroken: [state.firstBroken[0], state.firstBroken[1]],
  };
}
