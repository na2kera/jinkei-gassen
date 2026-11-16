// 狙いの決め方（design §3.6.1）
import { describe, expect, it } from 'vitest';
import { step } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { battle, face, p, place } from './helpers.ts';

describe('近接の距離に敵がいるとき', () => {
  it('いまの狙いが近接の距離にいれば、後ろから別の敵が当たっても狙いも向きも変えない', () => {
    const s = battle([p('infantry', 5, 10, 'hold')], [p('infantry', 5, 9, 'hold'), p('infantry', 5, 11, 'hold')]);
    s.units[0]!.target = 1;
    for (let i = 0; i < 10; i++) step(s, []);
    expect(s.units[0]!.target).toBe(1);
    expect(s.units[0]!.fy).toBeCloseTo(-1, 9);
  });
  it('いまの狙いが届かなければ、いまの向きにいちばん近い方向の敵を狙う', () => {
    const s = battle([p('infantry', 5, 10, 'hold')], [p('infantry', 6, 10, 'hold'), p('infantry', 5, 11, 'hold')]);
    face(s, 0, 0.2, 1); // ほぼ後ろ（y が増える向き）を向いている
    step(s, []);
    expect(s.units[0]!.target).toBe(2);
  });
  it('向きの近さが同じなら近いほう', () => {
    const s = battle([p('infantry', 5, 10, 'hold')], [p('infantry', 6, 10, 'hold'), p('infantry', 4, 10, 'hold')]);
    place(s, 2, 4.55, 10.5); // 左の敵のほうが近い（どちらも向きから 90°）
    step(s, []);
    expect(s.units[0]!.target).toBe(2);
  });
});

describe('近接の距離に敵がいないとき', () => {
  it('前進：距離 + 横のずれ がいちばん小さい敵を狙う', () => {
    // 右前の敵は近いが横にずれている。正面の敵は遠いが横のずれがない
    const s = battle([p('infantry', 5, 12)], [p('infantry', 8, 9, 'hold'), p('infantry', 5, 7, 'hold')]);
    step(s, []);
    // 右前：距離 √(9+9)=4.24 + 3 = 7.24、正面：5 + 0 = 5
    expect(s.units[0]!.target).toBe(2);
  });
  it('前進：いまの狙いは、ほかの敵の値が 1.0 以上小さくならない限り変えない', () => {
    const s = battle([p('infantry', 5, 12, 'hold')], [p('infantry', 5, 4, 'hold'), p('infantry', 5, 5, 'hold')]);
    // いまの狙いを、少し遠いほう（値 8）にしておく。近いほうは値 7（差 1.0 ちょうどは変えない）
    s.units[0]!.stance = 'advance';
    s.units[0]!.target = 1;
    step(s, []);
    expect(s.units[0]!.target).toBe(1);
    place(s, 2, 5.5, 6.0); // 差が 1.0 を超える
    step(s, []);
    expect(s.units[0]!.target).toBe(2);
  });
  it('守備：4マス以内のいちばん近い敵を狙い（向くだけで近づかない）、遠ければ狙わない', () => {
    const s = battle([p('infantry', 5, 12, 'hold')], [p('infantry', 7, 9, 'hold')]);
    step(s, []);
    expect(s.units[0]!.target).toBe(1);
    expect(s.units[0]!.y).toBe(12.5);
    expect(s.units[0]!.fx).toBeGreaterThan(0);
    const t = battle([p('infantry', 5, 12, 'hold')], [p('infantry', 5, 7, 'hold')]);
    step(t, []);
    expect(t.units[0]!.target).toBeNull();
  });
});

describe('弓兵', () => {
  it('撃てる距離にいる敵のうち、いちばん近い敵を狙い、止まって撃つ', () => {
    const s = battle([p('archer', 5, 12)], [p('infantry', 5, 8, 'hold'), p('infantry', 6, 8, 'hold')]);
    step(s, []);
    expect(s.units[0]!.target).toBe(1);
    expect(s.units[0]!.y).toBe(12.5);
    expect(s.units[1]!.men).toBeLessThan(100);
  });
  it('撃てる相手がいなければ前進する', () => {
    const s = battle([p('archer', 5, 12)], [p('infantry', 5, 0, 'hold')]);
    step(s, []);
    expect(s.units[0]!.y).toBeLessThan(12.5);
    expect(T.archerRange).toBeLessThan(12);
  });
  it('近接の距離に敵がいる間は撃たず、近接で戦う', () => {
    const s = battle([p('archer', 5, 12)], [p('infantry', 5, 11, 'hold'), p('infantry', 5, 9, 'hold')]);
    step(s, []);
    expect(s.units[0]!.target).toBe(1);
    expect(s.units[2]!.men).toBe(100);
  });
  it('味方ごしに撃てる', () => {
    const s = battle([p('archer', 5, 12, 'hold'), p('shield', 5, 11, 'hold')], [p('infantry', 5, 8, 'hold')]);
    step(s, []);
    expect(s.units[2]!.men).toBeLessThan(100);
  });
});
