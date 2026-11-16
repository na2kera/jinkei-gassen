// 号令の受付と後始末（design §3.6.5）。

import { ORDER_KINDS, ORDER_TARGETS, type BattleState, type BattleView, type OrderKind, type OrderTarget, type Result, type Side, type Unit } from './types.ts';
import { T } from './tuning.ts';
import { isObject } from './input.ts';

/** その部隊が号令の対象になるか（翼と、突撃は本陣にかからないこと） */
export function orderApplies(u: Unit, side: Side, target: OrderTarget, kind: OrderKind): boolean {
  // 門には号令がかからない
  if (u.side !== side || u.status !== 'active' || u.kind === 'gate') return false;
  if (target !== 'all' && u.wing !== target) return false;
  if (kind === 'charge' && u.kind === 'hq') return false;
  return true;
}

/** 号令を受け付けられるか。受け付けられないときは理由を返す（状態は変えない） */
export function canOrder(state: BattleState, side: Side, target: OrderTarget, kind: OrderKind): Result<true> {
  if (!isObject(state) || !Array.isArray(state.units) || !Array.isArray(state.ordersUsed)) {
    return { ok: false, error: { code: 'invalid_order', message: '状態が正しくない' } };
  }
  if (side !== 0 && side !== 1) return { ok: false, error: { code: 'invalid_order', message: '陣営が正しくない' } };
  if (!ORDER_TARGETS.includes(target)) return { ok: false, error: { code: 'invalid_order', message: '号令の相手が正しくない' } };
  if (!ORDER_KINDS.includes(kind)) return { ok: false, error: { code: 'invalid_order', message: '号令の種類が正しくない' } };
  if (state.outcome) return { ok: false, error: { code: 'battle_over', message: '決着している' } };
  if ((state.ordersUsed[side] ?? 0) >= T.maxOrders) {
    return { ok: false, error: { code: 'no_orders_left', message: `号令は1戦に${T.maxOrders}回まで` } };
  }
  if (!state.units.some((u) => orderApplies(u, side, target, kind))) {
    return { ok: false, error: { code: 'no_target_units', message: 'その号令がかかる部隊がいない' } };
  }
  return { ok: true, value: true };
}

export function orderTicks(kind: OrderKind): number {
  switch (kind) {
    case 'charge':
      return T.chargeTicks;
    case 'brace':
      return T.braceTicks;
    case 'retreat':
      return T.retreatTicks;
  }
}

/**
 * 号令が終わるときの後始末（期限が来たとき、新しい号令に入れ替わるとき）。
 * 守備の部隊は、その時点の位置を新しい持ち場にする。迂回の進み具合は flankPhase に残っているので、そのまま引き継がれる。
 */
export function endOrder(u: Unit): void {
  if (!u.order) return;
  if (u.stance === 'hold') u.home = { x: u.x, y: u.y };
  u.order = null;
}

/**
 * 号令をかける。受け付けたら true を返し、かかった部隊に士気の上乗せを moraleDelta に足す。
 * 受け付けの条件は canOrder と同じ。
 */
export function applyOrder(
  state: BattleState,
  side: Side,
  target: OrderTarget,
  kind: OrderKind,
  moraleDelta: number[],
): boolean {
  if (!canOrder(state, side, target, kind).ok) return false;
  const until = state.tick + orderTicks(kind);
  for (const u of state.units) {
    if (!orderApplies(u, side, target, kind)) continue;
    endOrder(u);
    u.order = { kind, untilTick: until };
    if (kind === 'charge') moraleDelta[u.id] = (moraleDelta[u.id] ?? 0) + T.chargeMoraleBonus;
    if (kind === 'brace') moraleDelta[u.id] = (moraleDelta[u.id] ?? 0) + T.braceMoraleBonus;
  }
  state.ordersUsed[side] = (state.ordersUsed[side] ?? 0) + 1;
  return true;
}

/**
 * 映す側の場面（BattleView）だけから、号令を受け付けられるかを判定する。対戦の画面は BattleState を持たないため。
 * 条件は canOrder と同じ：決着していない、残り回数がある、対象の翼にその号令がかかる active な部隊がいる（突撃は本陣にかからない）。
 */
export function canOrderView(view: BattleView, side: Side, target: OrderTarget, kind: OrderKind): boolean {
  if (!isObject(view) || !Array.isArray(view.units) || !Array.isArray(view.ordersLeft)) return false;
  if (side !== 0 && side !== 1) return false;
  if (!ORDER_TARGETS.includes(target) || !ORDER_KINDS.includes(kind)) return false;
  if (view.outcome) return false;
  const left = view.ordersLeft[side];
  if (typeof left !== 'number' || !(left > 0)) return false;
  return view.units.some(
    (u) => isObject(u) && u.side === side && u.status === 'active' && (target === 'all' || u.wing === target) && !(kind === 'charge' && u.kind === 'hq'),
  );
}
