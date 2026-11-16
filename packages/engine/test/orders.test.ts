// 号令の受付と後始末（design §3.6.5）
import { describe, expect, it } from 'vitest';
import { canOrder, step } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { battle, clone, p, place } from './helpers.ts';

function army() {
  // 陣営0：左翼に歩兵、中央に本陣、右翼に守備の歩兵。陣営1は遠くで守備
  return battle([p('infantry', 1, 12), p('hq', 5, 15, 'hold'), p('infantry', 10, 12, 'hold')], [p('infantry', 5, 0, 'hold')]);
}

describe('受け付けの条件', () => {
  it('1戦に3回まで。4回目は受け付けず、状態も変わらない', () => {
    const s = army();
    for (let i = 0; i < 3; i++) expect(step(s, [{ side: 0, target: 'all', kind: 'brace' }]).some((e) => e.type === 'order')).toBe(true);
    expect(s.ordersUsed).toEqual([3, 0]);
    const r = canOrder(s, 0, 'all', 'brace');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no_orders_left');
    const ref = clone(s);
    const ev = step(s, [{ side: 0, target: 'all', kind: 'charge' }]);
    const ev2 = step(ref, []);
    expect(ev).toEqual(ev2);
    expect(s).toEqual(ref);
  });
  it('突撃は本陣にかからない。本陣しかいない翼への突撃は受け付けない', () => {
    const s = army();
    const r = canOrder(s, 0, 'center', 'charge');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no_target_units');
    expect(canOrder(s, 0, 'center', 'brace').ok).toBe(true);
    step(s, [{ side: 0, target: 'all', kind: 'charge' }]);
    expect(s.units[0]!.order?.kind).toBe('charge');
    expect(s.units[1]!.order).toBeNull();
  });
  it('対象のいない翼への号令は受け付けず、回数も減らない', () => {
    const s = battle([p('infantry', 1, 12)], [p('infantry', 5, 0, 'hold')]);
    expect(canOrder(s, 0, 'right', 'brace').ok).toBe(false);
    step(s, [{ side: 0, target: 'right', kind: 'brace' }]);
    expect(s.ordersUsed).toEqual([0, 0]);
  });
  it('決着したあとは受け付けない', () => {
    const s = army();
    s.outcome = { winner: 0, reason: 'wipeout', tick: 0 };
    const r = canOrder(s, 0, 'all', 'brace');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('battle_over');
  });
  it('同じ step に複数の号令が来たら、配列の順に1つずつ調べる', () => {
    const s = army();
    s.ordersUsed[0] = 2;
    const ev = step(s, [
      { side: 0, target: 'left', kind: 'charge' },
      { side: 0, target: 'right', kind: 'brace' },
    ]);
    expect(ev.filter((e) => e.type === 'order')).toEqual([{ type: 'order', tick: 0, side: 0, target: 'left', kind: 'charge' }]);
    expect(s.units[2]!.order).toBeNull();
  });
  it('正しくない入力はエラーで返す（例外を投げない）', () => {
    const s = army();
    expect(canOrder(s, 0, 'middle' as never, 'brace').ok).toBe(false);
    expect(canOrder(s, 2 as never, 'all', 'brace').ok).toBe(false);
    expect(() => step(s, [{ side: 0, target: 'all', kind: 'nope' as never }, null as never])).not.toThrow();
    expect(s.ordersUsed).toEqual([0, 0]);
  });
});

describe('号令中の動き', () => {
  it('突撃：方針が前進になり、速さ 1.25 倍', () => {
    const s = army();
    const x0 = s.units[2]!.x;
    const y0 = s.units[2]!.y;
    step(s, [{ side: 0, target: 'right', kind: 'charge' }]);
    // 守備の歩兵が、狙いの敵へ向かって前へ出る
    expect(Math.hypot(s.units[2]!.x - x0, s.units[2]!.y - y0)).toBeCloseTo(1.0 * T.chargeSpeedMult * 0.1, 9);
    expect(s.units[2]!.y).toBeLessThan(y0);
  });
  it('堅守：その場で止まる（持ち場には戻らない）', () => {
    const s = army();
    step(s, [{ side: 0, target: 'left', kind: 'brace' }]);
    const y0 = s.units[0]!.y;
    for (let i = 0; i < 5; i++) step(s, []);
    expect(s.units[0]!.y).toBe(y0);
  });
  it('後退：自陣の奥へまっすぐ下がり、背中を見せる。奥の2行に入ったら止まる', () => {
    const s = battle([p('infantry', 5, 10), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold')]);
    // 陣営0の配置エリアを標準の y 10〜16 にして、奥の2行（y 14 以上）を使う
    s.field.zones[0] = { col: 0, row: 10, width: 12, height: 6 };
    step(s, []); // 組み合う
    step(s, [{ side: 0, target: 'all', kind: 'retreat' }]);
    expect(s.units[0]!.target).toBeNull();
    for (let i = 0; i < 10; i++) step(s, []);
    expect(s.units[0]!.fy).toBeGreaterThan(0.9); // 後ろ（y が増える向き）を向いた
    for (let i = 0; i < 40; i++) step(s, []); // 号令の 6 秒のうち 5 秒目
    expect(s.units[0]!.order?.kind).toBe('retreat');
    expect(s.units[0]!.y).toBeGreaterThanOrEqual(14);
    expect(s.units[0]!.y).toBeLessThan(14.5);
  });
  it('後退中は戦わず、撃たない', () => {
    const s = battle([p('infantry', 5, 10), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold')]);
    s.field.zones[0] = { col: 0, row: 10, width: 12, height: 6 };
    step(s, []);
    const m = s.units[2]!.men;
    step(s, [{ side: 0, target: 'all', kind: 'retreat' }]);
    expect(s.units[2]!.men).toBe(m);
  });
});

describe('入れ替わりと後始末', () => {
  it('新しい号令に入れ替わる。同じ号令をもう一度かけると長さが延び、上乗せももう一度入る', () => {
    const s = army();
    s.units[0]!.morale = 50;
    s.units[0]!.lastHitTick = 0;
    step(s, [{ side: 0, target: 'left', kind: 'brace' }]);
    expect(s.units[0]!.order).toEqual({ kind: 'brace', untilTick: 100 });
    for (let i = 0; i < 4; i++) step(s, []);
    const m = s.units[0]!.morale;
    step(s, [{ side: 0, target: 'left', kind: 'brace' }]);
    expect(s.units[0]!.order).toEqual({ kind: 'brace', untilTick: 105 });
    expect(s.units[0]!.morale).toBeCloseTo(m + T.braceMoraleBonus, 9);
    step(s, [{ side: 0, target: 'left', kind: 'charge' }]);
    expect(s.units[0]!.order).toEqual({ kind: 'charge', untilTick: 106 });
    expect(s.ordersUsed[0]).toBe(3);
  });
  it('号令が終わると、守備の部隊はその時点の位置を新しい持ち場にする', () => {
    const s = army();
    step(s, [{ side: 0, target: 'right', kind: 'charge' }]);
    for (let i = 0; i < 99; i++) step(s, []);
    expect(s.units[2]!.order).not.toBeNull();
    step(s, []); // 期限が来て外れる
    expect(s.units[2]!.order).toBeNull();
    expect(s.units[2]!.home.y).toBeLessThan(12.5 - 1);
    const y = s.units[2]!.y;
    for (let i = 0; i < 10; i++) step(s, []);
    expect(s.units[2]!.y).toBeCloseTo(y, 9); // 元の持ち場へは戻らない
  });
  it('入れ替わりでも後始末をする（守備の部隊の持ち場が変わる）', () => {
    const s = army();
    step(s, [{ side: 0, target: 'right', kind: 'charge' }]);
    for (let i = 0; i < 10; i++) step(s, []);
    step(s, [{ side: 0, target: 'right', kind: 'brace' }]);
    expect(s.units[2]!.home.y).toBeCloseTo(s.units[2]!.y, 9);
  });
  it('迂回の部隊は、号令が終わっても進み具合を引き継ぐ', () => {
    const s = battle([p('cavalry', 3, 12, 'flank')], [p('infantry', 6, 2, 'hold')]);
    for (let i = 0; i < 30 && s.units[0]!.flankPhase === 1; i++) step(s, []);
    expect(s.units[0]!.flankPhase).toBe(2);
    step(s, [{ side: 0, target: 'all', kind: 'brace' }]);
    for (let i = 0; i < 100; i++) step(s, []);
    expect(s.units[0]!.order).toBeNull();
    expect(s.units[0]!.flankPhase).toBe(2);
    place(s, 0, s.units[0]!.x, s.units[0]!.y);
  });
});
