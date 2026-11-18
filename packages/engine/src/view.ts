// 映す側に渡す場面と、振り返り（design §3.4）。
// 渡してよい項目だけを書き出して作る（状態を複製して項目を消す作りにしない）。相手の方針・狙い・持ち場・迂回の進み具合・助走は渡さない。

import { isGate, remainingRatio } from './battle.ts';
import { reservesOf } from './reserve.ts';
import { DT, KIND_STATS, T } from './tuning.ts';
import type { BattleState, BattleSummary, BattleView, Kind, ReserveState, ReserveView, Side, Unit, UnitView } from './types.ts';

/** 映す側に渡す遊軍の値 */
function reserveView(state: BattleState, r: ReserveState): ReserveView {
  const st: ReserveView['state'] = r.used ? 'used' : state.tick < T.reserveMinTick ? 'waiting' : 'ready';
  return { kind: r.kind, stance: r.stance, state: st };
}

export function viewFor(state: BattleState, viewer: Side | 'both'): BattleView {
  // 門は units に入れず、gate として別に渡す
  const units: UnitView[] = [];
  for (const u of state.units) {
    if (u.kind === 'gate') continue;
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
    units.push(v);
  }
  const view: BattleView = {
    tick: state.tick,
    maxTicks: state.maxTicks,
    units,
    ordersLeft: [T.maxOrders - state.ordersUsed[0], T.maxOrders - state.ordersUsed[1]],
    outcome: state.outcome ? { winner: state.outcome.winner, reason: state.outcome.reason, tick: state.outcome.tick } : null,
  };
  if (state.gate) {
    const g = state.units[state.gate.id] as Unit;
    view.gate = { id: g.id, side: g.side, col: state.gate.col, row: state.gate.row, x: g.x, y: g.y, men: g.men, maxMen: g.maxMen, status: g.status };
  }
  // 遊軍（§7.2）：見る人の陣営のぶんだけ。相手の遊軍は、あるかないかも見せない。入れる値がなければ項目ごと入れない
  const rs = reservesOf(state);
  const pick = (side: Side): ReserveView | null => {
    const r = rs[side];
    return r && (viewer === 'both' || viewer === side) ? reserveView(state, r) : null;
  };
  const reserve: [ReserveView | null, ReserveView | null] = [pick(0), pick(1)];
  if (reserve[0] || reserve[1]) view.reserve = reserve;
  return view;
}

/** 呼ばなかった遊軍（いなければ、または呼んだなら null） */
function unusedOf(state: BattleState, side: Side): { kind: Kind; men: number } | null {
  const r = reservesOf(state)[side];
  return r && !r.used ? { kind: r.kind, men: KIND_STATS[r.kind].men } : null;
}

/**
 * 星の条件に使う割合（§7.5）：(active な部隊の兵数の合計 + 呼ばなかった遊軍の兵数) ÷ (開戦時の兵数 + 呼ばなかった遊軍の兵数)。
 * 呼ばなかった遊軍がいなければ remainingRatio と同じ値（同じ計算を通す）
 */
function remainingForStarsOf(state: BattleState, side: Side): number {
  const unused = unusedOf(state, side);
  if (!unused) return remainingRatio(state, side);
  const init = state.initialMen[side] + unused.men;
  if (init <= 0) return 0;
  let sum = unused.men;
  for (const u of state.units) if (u.side === side && u.status === 'active' && !isGate(u)) sum += u.men;
  return sum / init;
}

/** 振り返り。決着前に呼ぶと winner は 'draw'、reason は 'ongoing'、seconds はいままでの秒数 */
export function summarize(state: BattleState): BattleSummary {
  const o = state.outcome;
  return {
    winner: o ? o.winner : 'draw',
    reason: o ? o.reason : 'ongoing',
    seconds: Math.round((o ? o.tick + 1 : state.tick) * DT * 10) / 10,
    remaining: [remainingRatio(state, 0), remainingRatio(state, 1)],
    units: state.units.flatMap((u) => (u.kind === 'gate' ? [] : [{
      id: u.id,
      side: u.side,
      kind: u.kind,
      wing: u.wing,
      menLeft: u.men,
      dealt: u.stats.dealt,
      routsCaused: u.stats.routsCaused,
      fate: (u.status === 'active' ? 'alive' : u.goneReason === 'destroyed' ? 'destroyed' : 'routed') as 'alive' | 'routed' | 'destroyed',
    }])),
    firstBroken: [state.firstBroken[0], state.firstBroken[1]],
    unusedReserve: [unusedOf(state, 0), unusedOf(state, 1)],
    remainingForStars: [remainingForStarsOf(state, 0), remainingForStarsOf(state, 1)],
  };
}
