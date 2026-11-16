// 士気の表（design §3.6.3）
import { describe, expect, it } from 'vitest';
import { step } from '../src/index.ts';
import { DT, T } from '../src/tuning.ts';
import { battle, face, p, place } from './helpers.ts';

describe('損害による減り', () => {
  it('(失った兵数 ÷ 最大兵数) × 係数 × 向き × 支え。味方がいなければ支えは 1', () => {
    const s = battle([p('infantry', 5, 10, 'hold')], [p('infantry', 5, 9, 'hold')]);
    step(s, []);
    const u = s.units[0]!;
    expect(100 - u.morale).toBeCloseTo(((100 - u.men) / 100) * T.moraleLossScale, 9);
  });
  it('1.6 マス以内の味方1部隊ごとに軽くなる（上限あり）', () => {
    const lone = battle([p('infantry', 5, 10, 'hold')], [p('infantry', 5, 9, 'hold')]);
    const two = battle([p('infantry', 5, 10, 'hold'), p('infantry', 4, 10, 'hold'), p('infantry', 6, 10, 'hold'), p('infantry', 5, 11, 'hold')], [p('infantry', 5, 9, 'hold')]);
    step(lone, []);
    step(two, []);
    const f = (s: typeof lone): number => (100 - s.units[0]!.morale) / (100 - s.units[0]!.men);
    const allies = Math.min(T.supportMaxAllies, 3);
    expect(f(two) / f(lone)).toBeCloseTo(1 - T.supportPerAlly * allies, 9);
  });
  it('本陣が 3.5 マス以内なら、さらに 0.7 倍。堅守中はさらに 0.6 倍', () => {
    const base = battle([p('infantry', 5, 10, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold')]);
    const hq = battle([p('infantry', 5, 10, 'hold'), p('hq', 5, 13, 'hold')], [p('infantry', 5, 9, 'hold')]);
    const brace = battle([p('infantry', 5, 10, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold')]);
    brace.units[0]!.order = { kind: 'brace', untilTick: 999 };
    for (const s of [base, hq, brace]) step(s, []);
    const f = (s: typeof base): number => (100 - s.units[0]!.morale) / (100 - s.units[0]!.men);
    // 本陣の近くでは毎秒 +1 も入るので、その分を足し戻して比べる
    const hqLoss = (100 - hq.units[0]!.morale + T.hqNearPerSec * DT) / (100 - hq.units[0]!.men);
    expect(hqLoss / f(base)).toBeCloseTo(T.hqSupportMult, 9);
    expect(f(brace) / f(base)).toBeCloseTo(T.braceMoraleMult, 9);
  });
  it('弓は向きにかかわらず 0.6', () => {
    const s = battle([p('infantry', 5, 10, 'hold')], [p('archer', 5, 6, 'hold')]);
    step(s, []);
    const u = s.units[0]!;
    expect(100 - u.morale).toBeCloseTo(((100 - u.men) / 100) * T.moraleLossScale * T.moraleArrowMult, 9);
  });
  it('側面は 1.6、背面は 2.4', () => {
    const run = (fx: number, fy: number): number => {
      const s = battle([p('infantry', 5, 10, 'hold')], [p('infantry', 5, 9, 'hold')]);
      face(s, 0, fx, fy);
      s.units[0]!.target = 1;
      // 向きを固定するため、刻みの初めの向きで判定されることを使う（1刻みだけ）
      step(s, []);
      return (100 - s.units[0]!.morale) / (100 - s.units[0]!.men);
    };
    const front = run(0, -1);
    // 真横を向いていても、狙いは近接の距離にいるので変えず、損害の向きは刻みの初めの向きで決まる
    expect(run(1, 0) / front).toBeCloseTo(T.moraleFacing.side, 9);
    expect(run(0, 1) / front).toBeCloseTo(T.moraleFacing.rear, 9);
  });
});

describe('そのほかの増減', () => {
  it('囲まれている（近接で攻めてくる2部隊の方向が 100°以上開いている）と毎秒 −2', () => {
    const one = battle([p('infantry', 5, 10, 'hold')], [p('infantry', 5, 9, 'hold'), p('infantry', 0, 0, 'hold')]);
    const two = battle([p('infantry', 5, 10, 'hold')], [p('infantry', 5, 9, 'hold'), p('infantry', 5, 11, 'hold')]);
    step(one, []);
    step(two, []);
    // 後ろの敵の損害の分を除いて比べるため、損害による減りを式で引く
    const rest = (s: typeof one): number => {
      const u = s.units[0]!;
      return 100 - u.morale;
    };
    const u2 = two.units[0]!;
    expect(rest(two)).toBeGreaterThan(rest(one));
    // 囲まれている分だけ、損害の式からさらに −2 × DT
    const fromFront = two.units[1]!.stats.dealt;
    const fromRear = two.units[2]!.stats.dealt;
    const expected = (fromFront / 100) * T.moraleLossScale * T.moraleFacing.front + (fromRear / 100) * T.moraleLossScale * T.moraleFacing.rear + T.surroundPerSec * DT;
    expect(100 - u2.morale).toBeCloseTo(expected, 9);
  });
  it('敗走の影響は次の刻みに伝わる：2.0 マス以内の味方は −allyRoutedLoss、狙っていた敵は +targetBrokenGain', () => {
    // U(0) と、隣の N(1)。敵 E(2) は U だけに届く。U の士気をほぼ 0 にして、刻み1で敗走させる
    const s = battle([p('infantry', 5, 10, 'hold'), p('infantry', 6, 10, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold')]);
    place(s, 1, 6.6, 10.5);
    step(s, []); // 刻み0で組み合う（「狙っていた」は刻みの初めの狙いで見るため）
    s.units[0]!.morale = 0.001;
    const ev = step(s, []);
    expect(ev).toContainEqual({ type: 'rout', tick: 1, unit: 0 });
    const n0 = s.units[1]!.morale;
    s.units[3]!.morale = 50; // 100 で頭打ちにならないように
    const e0 = s.units[3]!.morale;
    step(s, []);
    // N は損害を受けておらず、敵が 2.0 マス以内にいるので回復もない
    expect(s.units[1]!.morale - n0).toBeCloseTo(-T.allyRoutedLoss, 9);
    expect(s.units[3]!.stats.routsCaused).toBe(1);
    // E は、狙っていた敵が崩れた +8。N を新しく攻め始めていなければ、ほかの増減はない
    expect(s.units[3]!.morale - e0).toBeCloseTo(T.targetBrokenGain, 9);
  });
  it('2.0 マス以内に敵がおらず、2秒のあいだ損害を受けていなければ、毎秒 +1.5', () => {
    const s = battle([p('infantry', 5, 15, 'hold')], [p('infantry', 5, 0, 'hold')]);
    s.units[0]!.morale = 50;
    step(s, []);
    expect(s.units[0]!.morale).toBeCloseTo(50 + T.recoverPerSec * DT, 9);
    s.units[0]!.lastHitTick = s.tick - 5;
    step(s, []);
    expect(s.units[0]!.morale).toBeCloseTo(50 + T.recoverPerSec * DT, 9);
  });
  it('本陣が 3.5 マス以内にいれば毎秒 +1（本陣自身にはかからない）', () => {
    const s = battle([p('infantry', 5, 15, 'hold'), p('hq', 5, 13, 'hold')], [p('infantry', 5, 0, 'hold')]);
    s.units[0]!.morale = 50;
    s.units[1]!.morale = 50;
    s.units[0]!.lastHitTick = 0;
    s.units[1]!.lastHitTick = 0;
    step(s, []);
    expect(s.units[0]!.morale).toBeCloseTo(50 + T.hqNearPerSec * DT, 9);
    expect(s.units[1]!.morale).toBe(50);
  });
  it('号令がかかった刻みに、突撃 +5、堅守 +10', () => {
    const s = battle([p('infantry', 2, 15, 'hold'), p('infantry', 9, 15, 'hold')], [p('infantry', 5, 0, 'hold')]);
    for (const u of s.units) {
      u.morale = 50;
      u.lastHitTick = 0;
    }
    step(s, [
      { side: 0, target: 'left', kind: 'charge' },
      { side: 0, target: 'right', kind: 'brace' },
    ]);
    expect(s.units[0]!.morale).toBeCloseTo(50 + T.chargeMoraleBonus, 9);
    expect(s.units[1]!.morale).toBeCloseTo(50 + T.braceMoraleBonus, 9);
  });
  it('士気は 0〜100 に収める', () => {
    const s = battle([p('infantry', 5, 15, 'hold')], [p('infantry', 5, 0, 'hold')]);
    step(s, [{ side: 0, target: 'all', kind: 'brace' }]);
    expect(s.units[0]!.morale).toBe(100);
  });
});
