// A2〜A5 の小さな場面（design §3.9）。場面の作り方は sim/scenes.ts のコメントに書いた
import { describe, expect, it } from 'vitest';
import { a2, a3, a4, a5 } from '../../sim/scenes.ts';

describe('A2 側面は正面より効く', () => {
  it('側面（迂回）のほうが、残った兵の割合の平均が 0.1 以上高く、決着までの時間の平均も短い。得点率は下がらない', () => {
    const front = a2('front');
    const flank = a2('flank');
    expect(front.score).toBe(1); // どちらも陣営0が勝つ場面
    expect(flank.remaining - front.remaining).toBeGreaterThanOrEqual(0.1);
    expect(flank.seconds).toBeLessThan(front.seconds);
    expect(flank.score).toBeGreaterThanOrEqual(front.score);
  }, 120_000);
});

describe('A3 盾は騎兵を正面で止め、背面には弱い', () => {
  it('(a) 正面から当たると、9割以上の種で騎兵の失った割合が盾兵より大きい。(b) 背面から当たると、9割以上の種で盾兵が消えている', () => {
    const r = a3();
    expect(r.frontCavWorse).toBeGreaterThanOrEqual(0.9);
    expect(r.rearShieldGone).toBeGreaterThanOrEqual(0.9);
  }, 120_000);
});

describe('A4 弓は遠くから削れ、近づかれると脆い', () => {
  it('(a) 最初の近接までに、歩兵は合計で 6% 以上を失い、弓兵は損害を受けていない（全種）。(b) 9割以上の種で歩兵が弓兵に勝つ', () => {
    const r = a4();
    expect(r.infLossMin).toBeGreaterThanOrEqual(0.06);
    expect(r.archerTaken).toBe(0);
    expect(r.infWins).toBeGreaterThanOrEqual(0.9);
  }, 120_000);
});

describe('A5 総崩れが起きる', () => {
  it('最初の敗走から5秒以内に陣営1の2部隊目が敗走する種が8割以上。2部隊目までの中央値は、騎兵なしより 30% 以上短い', () => {
    const r = a5();
    expect(r.withCav).toBeGreaterThanOrEqual(0.8);
    expect(r.medianWithCav).toBeLessThanOrEqual(r.medianWithoutCav * 0.7);
  }, 120_000);
});
