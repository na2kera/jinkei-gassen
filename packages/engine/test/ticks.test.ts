// 刻みの数え方（design §3.1）
import { describe, expect, it } from 'vitest';
import { step } from '../src/index.ts';
import { battle, p } from './helpers.ts';

describe('刻みの数え方', () => {
  it('開戦時は tick 0。step ごとに 1 増える', () => {
    const s = battle([p('infantry', 5, 15, 'hold')], [p('infantry', 5, 0, 'hold')]);
    expect(s.tick).toBe(0);
    step(s, []);
    expect(s.tick).toBe(1);
    step(s, []);
    expect(s.tick).toBe(2);
  });

  it('刻み t にかけた10秒の号令は untilTick = t + 100 で、ちょうど100刻み効く', () => {
    const s = battle([p('infantry', 5, 15, 'hold')], [p('infantry', 5, 0, 'hold')]);
    for (let i = 0; i < 7; i++) step(s, []);
    step(s, [{ side: 0, target: 'all', kind: 'brace' }]);
    expect(s.units[0]!.order).toEqual({ kind: 'brace', untilTick: 107 });
    // 刻み 7〜106 の 100 回の step のあいだ効く
    for (let t = 8; t <= 106; t++) step(s, []);
    expect(s.tick).toBe(107);
    expect(s.units[0]!.order).not.toBeNull();
    step(s, []); // 刻み 107 の初めに外れる
    expect(s.units[0]!.order).toBeNull();
  });

  it('予定された号令は、state.tick === tick の step の初めに出る（tick 0 は最初の step）', () => {
    const s = battle([p('infantry', 5, 15, 'hold')], [p('infantry', 5, 0, 'hold')], {
      scriptedOrders: [
        { tick: 0, side: 1, target: 'all', kind: 'brace' },
        { tick: 3, side: 0, target: 'all', kind: 'brace' },
      ],
    });
    const e0 = step(s, []);
    expect(e0).toContainEqual({ type: 'order', tick: 0, side: 1, target: 'all', kind: 'brace' });
    expect(s.units[1]!.order?.untilTick).toBe(100);
    step(s, []);
    step(s, []);
    expect(s.units[0]!.order).toBeNull();
    const e3 = step(s, []);
    expect(e3).toContainEqual({ type: 'order', tick: 3, side: 0, target: 'all', kind: 'brace' });
  });

  it('ちょうど maxTicks 回の step で時間切れになり、そのあとは何もしない', () => {
    const s = battle([p('infantry', 5, 15, 'hold')], [p('infantry', 5, 0, 'hold')], { maxTicks: 30 });
    let n = 0;
    while (!s.outcome) {
      step(s, []);
      n++;
    }
    expect(n).toBe(30);
    expect(s.tick).toBe(30);
    expect(s.outcome).toEqual({ winner: 'draw', reason: 'timeout', tick: 29 });
    const before = JSON.stringify(s);
    expect(step(s, [])).toEqual([]);
    expect(JSON.stringify(s)).toBe(before);
  });
});
