// 状態ごとの扱いの表（design §3.6）
import { describe, expect, it } from 'vitest';
import { canOrder, KIND_STATS, step } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { battle, p, place } from './helpers.ts';

function rout(s: ReturnType<typeof battle>, id: number): void {
  const u = s.units[id]!;
  u.status = 'routing';
  u.routTick = s.tick - 1;
  u.morale = 0;
}

describe('敗走中（routing）', () => {
  it('自陣の奥へまっすぐ、速さ 1.3 倍で逃げる', () => {
    const s = battle([p('infantry', 5, 10)], [p('infantry', 5, 0, 'hold')]);
    rout(s, 0);
    step(s, []);
    expect(s.units[0]!.x).toBeCloseTo(5.5, 9);
    expect(s.units[0]!.y).toBeCloseTo(10.5 + KIND_STATS.infantry.speed * T.routSpeedMult * 0.1, 9);
  });
  it('敗走した刻みには動かず、次の刻みから動く', () => {
    // 決着させないため、遠くに守備の味方を1部隊置く
    const s = battle([p('infantry', 5, 10, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9)]);
    s.units[0]!.morale = 0.001; // 次の損害で敗走させる（決まりの確認のための仕込み）
    const y0 = s.units[0]!.y;
    const ev = step(s, []);
    expect(ev).toContainEqual({ type: 'rout', tick: 0, unit: 0 });
    expect(s.units[0]!.status).toBe('routing');
    expect(s.units[0]!.y).toBe(y0);
    step(s, []);
    expect(s.units[0]!.y).toBeGreaterThan(y0);
  });
  it('ほかの部隊とぶつからない（すり抜ける）・戦場の端に収めない', () => {
    const s = battle([p('infantry', 5, 15), p('infantry', 5, 14, 'hold')], [p('infantry', 5, 0, 'hold')]);
    rout(s, 1);
    for (let i = 0; i < 5; i++) step(s, []);
    // 後ろにいた味方を通り抜け、端（16 - 0.45）を越えていく
    expect(s.units[1]!.y).toBeGreaterThan(15.0);
  });
  it('戦場の端を越えるか、敗走から50刻みで gone（routed）になる', () => {
    const s = battle([p('infantry', 5, 2), p('infantry', 0, 15, 'hold')], [p('infantry', 11, 15, 'hold')]);
    // 陣営0は y が増える向きへ逃げる。端まで遠いので、50刻みで消える
    s.units[0]!.status = 'routing';
    s.units[0]!.routTick = -1; // 前の刻みに敗走した
    for (let i = 0; i < 49; i++) step(s, []);
    expect(s.units[0]!.status).toBe('routing');
    step(s, []);
    expect(s.units[0]!.status).toBe('gone');
    expect(s.units[0]!.goneReason).toBe('routed');
  });
  it('攻撃しない。狙っていない敵からは攻撃されない', () => {
    const s = battle([p('infantry', 5, 10)], [p('infantry', 5, 9, 'hold')]);
    rout(s, 0);
    s.units[1]!.target = null;
    const m1 = s.units[1]!.men;
    const m0 = s.units[0]!.men;
    step(s, []);
    expect(s.units[1]!.men).toBe(m1);
    expect(s.units[0]!.men).toBe(m0); // 新しく狙う相手に敗走中の部隊は選ばない
    expect(s.units[1]!.target).toBeNull();
  });
  it('いま狙っている敵からは、近接の距離にいる間は攻撃される', () => {
    const s = battle([p('infantry', 5, 10), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold')]);
    step(s, []); // 組み合う
    expect(s.units[2]!.target).toBe(0);
    rout(s, 0);
    const m0 = s.units[0]!.men;
    step(s, []);
    expect(s.units[0]!.men).toBeLessThan(m0);
    expect(s.units[2]!.target).toBe(0);
    // 離れたら攻撃をやめ、狙いを選び直す（ほかに敵はいない）
    for (let i = 0; i < 5; i++) step(s, []);
    expect(s.units[2]!.target).toBeNull();
  });
  it('号令がかからない', () => {
    const s = battle([p('infantry', 5, 10)], [p('infantry', 5, 0, 'hold')]);
    rout(s, 0);
    const r = canOrder(s, 0, 'all', 'brace');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no_target_units');
  });
});

describe('全滅・消えた部隊（gone）', () => {
  it('動かず、攻撃されず、ぶつからない', () => {
    const s = battle([p('infantry', 5, 10), p('infantry', 5, 12)], [p('infantry', 5, 0, 'hold')]);
    s.units[0]!.status = 'gone';
    s.units[0]!.goneReason = 'destroyed';
    place(s, 0, 5.5, 11.6);
    for (let i = 0; i < 10; i++) step(s, []);
    expect(s.units[0]!.y).toBe(11.6);
    // 後ろの部隊は gone の部隊を通り抜けて前進する
    expect(s.units[1]!.y).toBeLessThan(11.6);
  });
});

describe('敗走中は、味方の支え・囲みに数えない', () => {
  it('隣の味方が敗走中なら、支えにならない', () => {
    const lone = battle([p('infantry', 5, 10, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold')]);
    const withRouting = battle([p('infantry', 5, 10, 'hold'), p('infantry', 6, 10, 'hold')], [p('infantry', 5, 9, 'hold')]);
    rout(withRouting, 1);
    step(lone, []);
    step(withRouting, []);
    const f = (s: ReturnType<typeof battle>): number => (100 - s.units[0]!.morale) / (100 - s.units[0]!.men);
    expect(f(withRouting)).toBeCloseTo(f(lone), 9);
  });
  it('敗走中の部隊は攻撃しないので、囲みの2部隊に数えない', () => {
    const s = battle([p('infantry', 5, 10, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold'), p('infantry', 5, 11, 'hold')]);
    s.units[3]!.status = 'routing';
    s.units[3]!.routTick = -1;
    step(s, []);
    const u = s.units[0]!;
    // 正面からの損害の分だけ減り、囲みの −2 × DT は入らない
    expect(100 - u.morale).toBeCloseTo(((100 - u.men) / 100) * T.moraleLossScale, 9);
  });
});
