// 損害の表（design §3.6.2）。同じ種で場面の1か所だけを変え、1刻めの損害の比を見る（ばらつきの乱数は同じ値になる）。
import { describe, expect, it } from 'vitest';
import { KIND_STATS, step, type Kind, type OrderKind } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { battle, face, p, place } from './helpers.ts';

/** 陣営0の攻め手（id 0）が、陣営1の受け手（id 2）を1刻み攻めたときの損害。受け手は (5.5, 8.5) で、陣営1の前 (0, 1) を向く */
function hit(opts: {
  attacker?: Kind;
  defender?: Kind;
  angle?: number; // 受け手の向きから見た、攻め手の方向（度）
  attackerOrder?: OrderKind;
  defenderOrder?: OrderKind;
}): number {
  const a = opts.attacker ?? 'infantry';
  const dk = opts.defender ?? 'infantry';
  // 本陣だけの軍は作れないので、遠くに守備の部隊を1つずつ足す（id 2・3、戦いに関わらない）
  const s = battle([p(a, 0, 15, 'hold'), p('infantry', 0, 14, 'hold')], [p(dk, 11, 0, 'hold'), p('infantry', 11, 1, 'hold')]);
  // 受け手を id 1 にするため、陣営1の部隊を前に並べ直す
  place(s, 2, 5.5, 8.5);
  face(s, 2, 0, 1);
  const ang = ((opts.angle ?? 0) * Math.PI) / 180;
  // 受け手の向き (0, 1) を ang だけ回した方向、距離 1.0 に攻め手を置く
  place(s, 0, 5.5 + Math.sin(ang), 8.5 + Math.cos(ang));
  face(s, 0, -Math.sin(ang), -Math.cos(ang));
  s.units[0]!.target = 2;
  s.units[2]!.target = 0;
  if (opts.attackerOrder) s.units[0]!.order = { kind: opts.attackerOrder, untilTick: 999 };
  if (opts.defenderOrder) s.units[2]!.order = { kind: opts.defenderOrder, untilTick: 999 };
  const before = s.units[2]!.men;
  step(s, []);
  return before - s.units[2]!.men;
}

describe('近接の損害', () => {
  it('もとの値は兵種の攻撃 × DT、ばらつきは 0.9〜1.1', () => {
    const v = hit({});
    expect(v / (KIND_STATS.infantry.melee * 0.1)).toBeGreaterThanOrEqual(0.9);
    expect(v / (KIND_STATS.infantry.melee * 0.1)).toBeLessThanOrEqual(1.1);
  });
  it('向き：正面 1.0、側面 1.5、背面 2.0（境目は 50° と 120°）', () => {
    const front = hit({ angle: 0 });
    expect(hit({ angle: 49 }) / front).toBeCloseTo(T.facingMult.front, 9);
    expect(hit({ angle: 51 }) / front).toBeCloseTo(T.facingMult.side, 9);
    expect(hit({ angle: 90 }) / front).toBeCloseTo(T.facingMult.side, 9);
    expect(hit({ angle: 121 }) / front).toBeCloseTo(T.facingMult.rear, 9);
    expect(hit({ angle: 180 }) / front).toBeCloseTo(T.facingMult.rear, 9);
    expect(T.frontAngle).toBe(50);
  });
  it('盾兵の正面は向きの代わりに shieldFrontMelee 倍、側面からは側面の倍率', () => {
    const inf = hit({ defender: 'infantry' });
    expect(hit({ defender: 'shield' }) / inf).toBeCloseTo(T.shieldFrontMelee, 9);
    expect(hit({ defender: 'shield', angle: 90 }) / inf).toBeCloseTo(T.facingMult.side, 9);
  });
  it('受ける側：本陣 0.7、弓兵 1.3。相性：騎兵→弓兵 1.5、歩兵→弓兵 1.2', () => {
    const base = hit({});
    expect(hit({ defender: 'hq' }) / base).toBeCloseTo(T.hqTakenMult, 9);
    expect(hit({ defender: 'archer' }) / base).toBeCloseTo(T.archerMeleeTakenMult * T.infantryVsArcher, 9);
    const cav = hit({ attacker: 'cavalry' });
    expect(hit({ attacker: 'cavalry', defender: 'archer' }) / cav).toBeCloseTo(T.archerMeleeTakenMult * T.cavalryVsArcher, 9);
  });
  it('号令：突撃中の攻撃 1.3・受ける損害 1.2、堅守中の受ける損害 0.7', () => {
    const base = hit({});
    expect(hit({ attackerOrder: 'charge' }) / base).toBeCloseTo(T.chargeAttackMult, 9);
    expect(hit({ defenderOrder: 'charge' }) / base).toBeCloseTo(T.chargeTakenMult, 9);
    expect(hit({ defenderOrder: 'brace' }) / base).toBeCloseTo(T.braceTakenMult, 9);
  });
  it('攻める側の兵数の √ をかける', () => {
    const s1 = hit({});
    const s = battle([p('infantry', 0, 15, 'hold')], [p('infantry', 11, 0, 'hold')]);
    place(s, 1, 5.5, 8.5);
    face(s, 1, 0, 1);
    place(s, 0, 5.5, 9.5);
    s.units[0]!.men = 25;
    s.units[0]!.target = 1;
    step(s, []);
    expect((100 - s.units[1]!.men) / s1).toBeCloseTo(0.5, 9);
  });
  it('損害は残っている兵数までしか入らない。dealt と taken には実際に入った分を足す', () => {
    const s = battle([p('infantry', 0, 15, 'hold'), p('infantry', 1, 15, 'hold')], [p('infantry', 11, 0, 'hold'), p('infantry', 10, 0, 'hold')]);
    place(s, 2, 5.5, 8.5);
    place(s, 0, 5.5, 9.5);
    place(s, 1, 6.5, 8.5);
    s.units[2]!.men = 0.05;
    step(s, []);
    expect(s.units[2]!.men).toBe(0);
    expect(s.units[2]!.status).toBe('gone');
    expect(s.units[2]!.stats.taken).toBeCloseTo(0.05, 12);
    expect(s.units[0]!.stats.dealt + s.units[1]!.stats.dealt).toBeCloseTo(0.05, 12);
  });
  it('側面・背面からの近接は flankDealt にも足す', () => {
    const s = battle([p('infantry', 0, 15, 'hold')], [p('infantry', 11, 0, 'hold')]);
    place(s, 1, 5.5, 8.5);
    face(s, 1, 0, 1);
    place(s, 0, 4.5, 8.5); // 真横
    s.units[0]!.target = 1;
    step(s, []);
    expect(s.units[0]!.stats.flankDealt).toBeGreaterThan(0);
    expect(s.units[0]!.stats.flankDealt).toBeCloseTo(s.units[0]!.stats.dealt, 12);
  });
});

describe('弓の損害', () => {
  it('もとの値 × DT、向きはかけない。盾兵の正面 0.4、本陣 0.7', () => {
    const shoot = (dk: Kind, fy: number): number => {
      const s = battle([p('archer', 5, 13, 'hold')], [p(dk, 5, 10, 'hold'), p('infantry', 0, 0, 'hold')]);
      face(s, 1, 0, fy);
      step(s, []);
      return KIND_STATS[dk].men - s.units[1]!.men;
    };
    const inf = shoot('infantry', 1);
    expect(inf / (T.arrowDamage * 0.1)).toBeGreaterThanOrEqual(0.9);
    expect(inf / (T.arrowDamage * 0.1)).toBeLessThanOrEqual(1.1);
    expect(shoot('infantry', -1) / inf).toBeCloseTo(1, 9);
    expect(shoot('shield', 1) / inf).toBeCloseTo(T.shieldFrontArrow, 9);
    expect(shoot('shield', -1) / inf).toBeCloseTo(1, 9);
    expect(shoot('hq', 1) / inf).toBeCloseTo(T.hqTakenMult, 9);
    expect(shoot('archer', 1) / inf).toBeCloseTo(1, 9);
  });
});

describe('騎兵の突入', () => {
  function charge(dk: Kind, fromRear: boolean): ReturnType<typeof battle> {
    // 受け手は守備で、陣営1の前（y が増える向き）を向く。騎兵は 4 マス離れたところから前進で当たる。
    // 背面の場合は、守備の受け手が騎兵のほうへ向き直らないよう、正面に組み合う歩兵（id 1）を置く
    const s = fromRear
      ? battle([p('cavalry', 5, 4, 'advance'), p('infantry', 5, 9, 'hold')], [p(dk, 5, 8, 'hold')])
      : battle([p('cavalry', 5, 12, 'advance')], [p(dk, 5, 8, 'hold')]);
    if (fromRear) face(s, 0, 0, 1);
    return s;
  }
  const def = (s: ReturnType<typeof battle>): number => s.units.length - 1;
  it('近接の敵がいない状態で 2.0 マス以上動いたあと、狙いが近接の距離に入った刻みに1回だけ起きる', () => {
    const s = charge('infantry', false);
    const impacts: unknown[] = [];
    for (let i = 0; i < 40; i++) for (const e of step(s, [])) if (e.type === 'impact') impacts.push(e);
    expect(impacts).toEqual([{ type: 'impact', tick: expect.any(Number), attacker: 0, defender: 1, facing: 'front' }]);
    expect(s.units[0]!.runup).toBe(0);
  });
  it('助走が 2.0 マスに足りなければ起きない', () => {
    const s = battle([p('cavalry', 5, 10, 'advance')], [p(dk(), 5, 8, 'hold')]);
    let n = 0;
    for (let i = 0; i < 20; i++) for (const e of step(s, [])) if (e.type === 'impact') n++;
    expect(n).toBe(0);
    function dk(): Kind {
      return 'infantry';
    }
  });
  it('正面の突入は impactDamage × 正面の倍率の損害（ばらつきなし）と士気の衝撃。背面は背面の倍率と背面の衝撃', () => {
    const run = (fromRear: boolean): { loss: number; morale: number } => {
      const s = charge('infantry', fromRear);
      const d = def(s);
      for (let i = 0; i < 60; i++) {
        const m0 = s.units[d]!.men;
        const mo0 = s.units[d]!.morale;
        const ev = step(s, []);
        if (ev.some((e) => e.type === 'impact')) return { loss: m0 - s.units[d]!.men, morale: mo0 - s.units[d]!.morale };
      }
      throw new Error('突入が起きない');
    };
    const f = run(false);
    const r = run(true);
    // 同じ刻みに近接の損害も入るので、突入の分は下限で確かめる
    expect(f.loss).toBeGreaterThan(T.impactDamage * T.facingMult.front);
    expect(f.loss).toBeLessThan(T.impactDamage * T.facingMult.front + KIND_STATS.cavalry.melee * 0.11 + 1e-9);
    expect(r.loss).toBeGreaterThan(T.impactDamage * T.facingMult.rear);
    expect(f.morale).toBeGreaterThan(T.impactShock.front);
    expect(r.morale).toBeGreaterThan(T.impactShock.rear);
  });
  it('盾兵の正面に当たると、士気の衝撃はなく、騎兵が impactBouncedMen の兵数と impactBouncedMorale の士気を失う', () => {
    const s = charge('shield', false);
    for (let i = 0; i < 60; i++) {
      const cav0 = s.units[0]!.men;
      const cm0 = s.units[0]!.morale;
      const ev = step(s, []);
      if (ev.some((e) => e.type === 'impact')) {
        // 騎兵の損害は、跳ね返りの分と、盾兵からの近接1刻み分
        expect(cav0 - s.units[0]!.men).toBeGreaterThanOrEqual(T.impactBouncedMen);
        expect(cav0 - s.units[0]!.men).toBeLessThanOrEqual(T.impactBouncedMen + KIND_STATS.shield.melee * 0.11);
        expect(cm0 - s.units[0]!.morale).toBeGreaterThanOrEqual(T.impactBouncedMorale - 1e-9);
        // 盾兵の士気の減りは、損害による分だけ（正面の衝撃は入らない）
        const lost = 100 - s.units[1]!.men;
        expect(100 - s.units[1]!.morale).toBeCloseTo((lost / 100) * T.moraleLossScale, 6);
        return;
      }
    }
    throw new Error('突入が起きない');
  });
});

describe('助走は「続けて動いた距離」', () => {
  it('助走のあと堅守して止まって待つと、助走は 0 に戻り、敵が来ても突入しない（レビューの指摘 4 の再現）', () => {
    // 騎兵 (5,12)、敵の歩兵 (5,4) が前進してくる。10刻み動いたあと（助走 2.2）、騎兵に堅守をかけて待つ
    const s = battle([p('cavalry', 5, 12, 'advance')], [p('infantry', 5, 4, 'advance')]);
    for (let i = 0; i < 10; i++) step(s, []);
    expect(s.units[0]!.runup).toBeGreaterThanOrEqual(T.impactRunup);
    step(s, [{ side: 0, target: 'all', kind: 'brace' }]);
    expect(s.units[0]!.runup).toBe(0);
    let impacts = 0;
    for (let i = 0; i < 80; i++) for (const e of step(s, [])) if (e.type === 'impact') impacts++;
    expect(impacts).toBe(0);
  });
});
