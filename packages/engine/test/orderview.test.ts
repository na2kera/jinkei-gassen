// canOrderView（BattleView だけから号令の受付を判定）が canOrder と一致すること
import { describe, expect, it } from 'vitest';
import { canOrder, canOrderView, MAX_ORDERS, ORDER_KINDS, ORDER_TARGETS, ROUT_TICKS, step, viewFor, type BattleState } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { battle, p } from './helpers.ts';

function agree(s: BattleState): void {
  for (const viewer of [0, 1, 'both'] as const) {
    const v = viewFor(s, viewer);
    for (const side of [0, 1] as const) {
      for (const target of ORDER_TARGETS) {
        for (const kind of ORDER_KINDS) {
          expect(canOrderView(v, side, target, kind), `${viewer} ${side} ${target} ${kind}`).toBe(canOrder(s, side, target, kind).ok);
        }
      }
    }
  }
}

describe('canOrderView', () => {
  it('いくつかの状態で、全部の組み合わせが canOrder と一致する', () => {
    // 陣営0：左翼に歩兵、中央に本陣だけ、右翼なし。陣営1：右翼（陣営1から見て）に歩兵
    const s = battle([p('infantry', 1, 12), p('hq', 5, 15, 'hold')], [p('infantry', 1, 2), p('hq', 6, 0, 'hold')], { requireHq: true });
    agree(s);
    s.units[0]!.status = 'routing';
    agree(s);
    s.units[0]!.status = 'active';
    s.ordersUsed = [MAX_ORDERS, 1];
    agree(s);
    s.ordersUsed = [0, 0];
    s.outcome = { winner: 0, reason: 'hq', tick: 0 };
    agree(s);
  });
  it('戦いの途中の状態でも一致する', () => {
    const s = battle([p('infantry', 1, 12), p('infantry', 6, 12), p('cavalry', 10, 12, 'flank')], [p('infantry', 5, 3), p('archer', 9, 2)]);
    for (let i = 0; i < 300 && !s.outcome; i++) {
      step(s, i === 50 ? [{ side: 0, target: 'left', kind: 'charge' }] : []);
      if (i % 25 === 0) agree(s);
    }
    agree(s);
  });
  it('定数は tuning の値から作る', () => {
    expect(MAX_ORDERS).toBe(T.maxOrders);
    expect(ROUT_TICKS).toBe(T.routTicks);
  });
});
