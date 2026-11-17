// A11 守りが成り立つ・A13 包囲が生まれる・A14 突破が生まれる（design §3.9）
import { describe, expect, it } from 'vitest';
import { a11, a13, a14 } from '../../sim/scenes.ts';

describe('A11 守りが成り立つ', () => {
  it('同じ予算の守り向きの編成（全部守備）対 攻め向きの編成：陣営を入れ替えた両方で、守る側の得点率が 0.3〜0.8。守備どうしは必ず膠着の引き分け', () => {
    const r = a11();
    expect(r.defenderScore).toBeGreaterThanOrEqual(0.3);
    expect(r.defenderScore).toBeLessThanOrEqual(0.8);
    expect(r.holdVsHoldAllDraw).toBe(true);
  }, 300_000);
});

describe('A13 包囲が生まれる', () => {
  it('歩兵6対4で、多いほうの与えた損害のうち側面・背面の分が 25% 以上。4対4では 10% 以下', () => {
    const r = a13();
    expect(r.sixVsFour).toBeGreaterThanOrEqual(0.25);
    expect(r.fourVsFour).toBeLessThanOrEqual(0.1);
  }, 120_000);
});

describe('A14 突破が生まれる', () => {
  it('鋒矢 対 横陣（全部守備）で、陣営0が勝った戦いのうち、本陣を討ったものが半分以上', () => {
    const r = a14();
    expect(r.side0Wins).toBeGreaterThan(0);
    expect(r.hqShare).toBeGreaterThanOrEqual(0.5);
  }, 300_000);
});
