// A8 号令が効く（場面は sim/scenes.ts。突撃の場面は、偃月 対 鋒矢。突撃で何が変わって勝つかも、そこに書いた）。決まりの確認は test/orders.test.ts にもある
import { describe, expect, it } from 'vitest';
import { canOrder, step } from '../../src/index.ts';
import { a8 } from '../../sim/scenes.ts';
import { battle, clone, p } from '../helpers.ts';

describe('A8 号令が効く', () => {
  for (const k of ['charge', 'brace', 'retreat'] as const) {
    it(`${k}：同じ種で、出した場合の得点率が出さない場合より 0.1 以上高い（種40個）`, () => {
      const r = a8(k);
      expect(r.withOrder - r.without).toBeGreaterThanOrEqual(0.1);
    }, 300_000);
  }
  it('4回目は受け付けず、状態も変わらない', () => {
    const s = battle([p('infantry', 1, 12), p('infantry', 10, 12)], [p('infantry', 5, 0, 'hold')]);
    for (let i = 0; i < 3; i++) step(s, [{ side: 0, target: 'all', kind: 'brace' }]);
    const ref = clone(s);
    step(s, [{ side: 0, target: 'left', kind: 'charge' }]);
    step(ref, []);
    expect(s).toEqual(ref);
  });
  it('突撃は本陣にかからない', () => {
    const s = battle([p('hq', 5, 15, 'hold'), p('infantry', 1, 12)], [p('infantry', 5, 0, 'hold'), p('hq', 6, 0, 'hold')], { requireHq: true });
    expect(canOrder(s, 0, 'center', 'charge').ok).toBe(false);
    step(s, [{ side: 0, target: 'all', kind: 'charge' }]);
    expect(s.units[0]!.order).toBeNull();
    expect(s.units[1]!.order?.kind).toBe('charge');
  });
  it('対象のいない翼への号令は受け付けず、回数も減らない', () => {
    const s = battle([p('infantry', 1, 12)], [p('infantry', 5, 0, 'hold')]);
    step(s, [{ side: 0, target: 'right', kind: 'retreat' }]);
    expect(s.ordersUsed).toEqual([0, 0]);
  });
  it('入れ替わりと後始末：守備の部隊は、号令の終わりにその位置を持ち場にする', () => {
    const s = battle([p('infantry', 10, 12, 'hold')], [p('infantry', 5, 0, 'hold')]);
    step(s, [{ side: 0, target: 'all', kind: 'charge' }]);
    for (let i = 0; i < 20; i++) step(s, []);
    step(s, [{ side: 0, target: 'all', kind: 'brace' }]);
    expect(s.units[0]!.order?.kind).toBe('brace');
    expect(s.units[0]!.home).toEqual({ x: s.units[0]!.x, y: s.units[0]!.y });
  });
});
