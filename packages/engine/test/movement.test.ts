// 動き方と重なりのほどき方（design §3.6 ④）、迂回と本陣狙いの動き（§3.6.1）
import { describe, expect, it } from 'vitest';
import { step } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { battle, openField, p, place } from './helpers.ts';

const d = (s: ReturnType<typeof battle>, a: number, b: number): number =>
  Math.hypot(s.units[a]!.x - s.units[b]!.x, s.units[a]!.y - s.units[b]!.y);

describe('ぶつかる前に止まり、接線に回る', () => {
  it('動きたい先が 0.9 以内に入るなら手前で止まり、残りの半分を接線に進む（真正面は狙いのない側＝左）', () => {
    // 陣営0の歩兵（前進）の真上に、守備の味方。狙いは真上の遠くの敵
    const s = battle([p('infantry', 5, 12), p('infantry', 5, 11, 'hold')], [p('infantry', 5, 0, 'hold')]);
    place(s, 1, 5.5, 11.55); // 距離 0.95。1刻みに 0.1 進むと 0.85 になる
    step(s, []);
    const u = s.units[0]!;
    // 0.05 進んで 0.9 で止まり、残り 0.05 の半分 0.025 を左（陣営0の左は x の小さいほう）へ
    expect(u.y).toBeCloseTo(12.45, 6);
    expect(u.x).toBeCloseTo(5.5 - 0.025, 6);
    expect(d(s, 0, 1)).toBeGreaterThanOrEqual(T.spacing - 1e-6);
  });
  it('真正面で、狙いが右にあれば右へ回る', () => {
    const s = battle([p('infantry', 5, 12), p('infantry', 5, 11, 'hold')], [p('infantry', 6, 0, 'hold')]);
    place(s, 1, 5.5, 11.55);
    // 狙いは右上の敵なので、動く向きは真上から少し右にずれる。接線の向きは動く向きに近い右回り
    step(s, []);
    expect(s.units[0]!.x).toBeGreaterThan(5.5);
  });
  it('戦っている味方の後ろの部隊は、通り抜けずに脇へ回り込む', () => {
    const s = battle(
      [p('infantry', 5, 9, 'hold'), p('infantry', 5, 11)],
      [p('infantry', 5, 8, 'hold')],
    );
    for (let i = 0; i < 60; i++) {
      step(s, []);
      expect(d(s, 0, 1)).toBeGreaterThan(T.spacing - 0.05);
    }
    // 後ろの部隊は横へずれて、敵に横から当たっている
    expect(Math.abs(s.units[1]!.x - 5.5)).toBeGreaterThan(0.5);
    expect(d(s, 1, 2)).toBeLessThanOrEqual(T.meleeRange);
  });
});

describe('重なりをほどく', () => {
  it('どちらも錨でなければ半分ずつ離れる', () => {
    // 敵が遠く、どちらも前進で動かない（狙いの敵がいない＝敵は1部隊で、両方ともすでに錨ではない）
    const s = battle([p('infantry', 2, 12, 'advance'), p('infantry', 3, 12, 'advance')], [p('infantry', 11, 0, 'hold')]);
    s.units[2]!.status = 'gone'; // 敵がいないので動かない
    s.units[2]!.goneReason = 'destroyed';
    place(s, 0, 5.0, 12.5);
    place(s, 1, 5.5, 12.5);
    step(s, []);
    expect(s.units[0]!.x).toBeCloseTo(5.25 - 0.45, 6);
    expect(s.units[1]!.x).toBeCloseTo(5.25 + 0.45, 6);
  });
  it('片方が錨（守備で持ち場にいる）なら、もう片方だけを重なりの分ぜんぶ動かす', () => {
    const s = battle([p('infantry', 2, 12, 'hold'), p('infantry', 3, 12, 'advance')], [p('infantry', 11, 0, 'hold')]);
    s.units[2]!.status = 'gone';
    place(s, 0, 5.0, 12.5);
    place(s, 1, 5.5, 12.5);
    step(s, []);
    expect(s.units[0]!.x).toBe(5.0);
    expect(s.units[1]!.x).toBeCloseTo(5.9, 6);
  });
  it('両方が錨なら動かさない', () => {
    const s = battle([p('infantry', 2, 12, 'hold'), p('infantry', 3, 12, 'hold')], [p('infantry', 11, 0, 'hold')]);
    s.units[2]!.status = 'gone';
    place(s, 0, 5.0, 12.5);
    place(s, 1, 5.5, 12.5);
    step(s, []);
    expect(s.units[0]!.x).toBe(5.0);
    expect(s.units[1]!.x).toBe(5.5);
  });
  it('位置がまったく同じなら、id の小さいほうを左（x の小さいほう）、大きいほうを右へ', () => {
    const s = battle([p('infantry', 2, 12, 'advance'), p('infantry', 3, 12, 'advance')], [p('infantry', 11, 0, 'hold')]);
    s.units[2]!.status = 'gone';
    place(s, 0, 5.5, 12.5);
    place(s, 1, 5.5, 12.5);
    step(s, []);
    expect(s.units[0]!.x).toBeCloseTo(5.05, 6);
    expect(s.units[1]!.x).toBeCloseTo(5.95, 6);
  });
  it('戦場の内側（端から 0.45）に収める', () => {
    const s = battle([p('infantry', 0, 15, 'advance')], [p('infantry', 11, 0, 'hold')]);
    s.units[1]!.status = 'gone';
    place(s, 0, 0.1, 15.99);
    s.units[1]!.status = 'active';
    place(s, 1, 11.5, 0.5);
    step(s, []);
    expect(s.units[0]!.x).toBeGreaterThanOrEqual(0.45);
    expect(s.units[0]!.y).toBeLessThanOrEqual(16 - 0.45);
  });
});

describe('錨', () => {
  it('戦っている部隊は動かない', () => {
    const s = battle([p('infantry', 5, 10)], [p('infantry', 5, 9)]);
    step(s, []);
    const x = s.units[0]!.x;
    const y = s.units[0]!.y;
    for (let i = 0; i < 5; i++) step(s, []);
    expect(s.units[0]!.x).toBe(x);
    expect(s.units[0]!.y).toBe(y);
  });
  it('守備は持ち場から 0.1 より離れていたら戻る', () => {
    const s = battle([p('infantry', 5, 12, 'hold')], [p('infantry', 5, 0, 'hold')]);
    s.units[0]!.home = { x: 5.5, y: 13.5 };
    for (let i = 0; i < 20; i++) step(s, []);
    expect(s.units[0]!.y).toBeCloseTo(13.5, 6);
  });
});

describe('迂回', () => {
  it('①近いほうの端の列へ横に出る ②端に沿って、敵の重心の行より 1.5 マス奥まで ③いちばん近い敵（本陣以外）を狙う', () => {
    const s = battle([p('cavalry', 3, 12, 'flank')], [p('hq', 6, 1, 'hold'), p('infantry', 6, 4, 'hold'), p('infantry', 7, 4, 'hold')]);
    expect(s.units[0]!.flankEdgeX).toBe(0.5);
    // 敵の重心の y は (1.5 + 4.5 + 4.5) / 3 = 3.5。陣営0は y が減る向きが奥なので、行き先は 3.5 - flankDepth
    expect(s.flankY[0]).toBeCloseTo(3.5 - T.flankDepth, 9);
    step(s, []);
    expect(s.units[0]!.y).toBe(12.5);
    expect(s.units[0]!.x).toBeLessThan(3.5);
    expect(s.units[0]!.target).toBeNull();
    let sawPhase2 = false;
    for (let i = 0; i < 80 && s.units[0]!.flankPhase !== 3; i++) {
      step(s, []);
      if (s.units[0]!.flankPhase === 2) {
        sawPhase2 = true;
        expect(s.units[0]!.x).toBeLessThan(0.7);
        expect(s.units[0]!.target).toBeNull();
      }
    }
    expect(sawPhase2).toBe(true);
    expect(s.units[0]!.flankPhase).toBe(3);
    step(s, []);
    // 本陣より歩兵が遠くても、本陣以外を狙う
    expect([2, 3]).toContain(s.units[0]!.target);
  });
  it('左右どちらの端も同じ近さなら、開戦時にその側にいる敵が少ないほうへ。それも同じなら左', () => {
    // 12列の幅で、x = 6.0 ちょうどにはマスの中心が来ないので、幅 11 の戦場で確かめる
    const s = battle([p('cavalry', 5, 12, 'flank')], [p('infantry', 1, 2, 'hold'), p('infantry', 2, 2, 'hold'), p('infantry', 9, 2, 'hold')], {
      field: { width: 11, height: 16, terrain: new Array(176).fill('plain'), zones: [{ col: 0, row: 0, width: 11, height: 16 }, { col: 0, row: 0, width: 11, height: 16 }] },
    });
    expect(s.units[0]!.flankEdgeX).toBe(11 - 0.5);
    const t = battle([p('cavalry', 5, 12, 'flank')], [p('infantry', 1, 2, 'hold'), p('infantry', 9, 2, 'hold')], {
      field: { width: 11, height: 16, terrain: new Array(176).fill('plain'), zones: [{ col: 0, row: 0, width: 11, height: 16 }, { col: 0, row: 0, width: 11, height: 16 }] },
    });
    expect(t.units[0]!.flankEdgeX).toBe(0.5);
  });
});

describe('本陣狙い', () => {
  // 陣営0の騎兵（本陣狙い）を (5,12) に、陣営1の本陣を (5,1) に、そのあいだの行 6 に守備の歩兵の列を置く
  // width を渡すと、その幅の戦場で作る（幅いっぱいの列は、部隊数の上限 MAX_UNITS に収まる幅 11 で作る）
  const huntScene = (wallCols: number[], width = 12) =>
    battle([p('cavalry', 5, 12, 'hunt'), p('infantry', 0, 15, 'hold')], [p('hq', 5, 1, 'hold'), ...wallCols.map((c) => p('infantry', c, 6, 'hold'))], { field: openField(width) });
  const run = (s: ReturnType<typeof battle>, n: number, each?: () => void): void => {
    for (let i = 0; i < n && !s.outcome; i++) {
      step(s, []);
      each?.();
    }
  };

  it('敵の列にぶつかると、戦わずに列に沿って滑る', () => {
    const s = huntScene([2, 3, 4, 5, 6, 7, 8, 9]);
    run(s, 25); // 列に着く
    const x0 = s.units[0]!.x;
    run(s, 15);
    expect(Math.abs(s.units[0]!.x - x0)).toBeGreaterThan(0.8); // 横へ滑っている
    expect(s.units[0]!.y).toBeGreaterThan(6.5); // まだ列の手前
    expect(s.units[0]!.stats.dealt).toBe(0); // 列の部隊とは戦っていない
    expect(s.units[0]!.target).toBe(2);
  });
  it('列の端から抜けて本陣へ向かい、本陣とだけ戦う（すれ違う敵からは打たれる）', () => {
    const s = huntScene([2, 3, 4, 5, 6, 7, 8, 9]);
    let passed = false;
    run(s, 200, () => {
      if (s.units[0]!.y < 6) passed = true;
    });
    expect(passed).toBe(true);
    expect(s.units[2]!.stats.taken).toBeGreaterThan(0);
    expect(s.units[0]!.stats.dealt).toBeCloseTo(s.units[2]!.stats.taken, 9);
    expect(s.units[0]!.stats.taken).toBeGreaterThan(0);
  });
  it('列の穴から抜ける', () => {
    const s = huntScene([2, 3, 4, 7, 8, 9]);
    let passedAt = -1;
    run(s, 80, () => {
      if (passedAt < 0 && s.units[0]!.y < 6) passedAt = s.tick;
    });
    expect(passedAt).toBeGreaterThan(0);
    expect(Math.abs(s.units[0]!.x - 6.0)).toBeLessThan(1.5);
    expect(s.units[0]!.stats.dealt).toBeCloseTo(s.units[2]!.stats.taken, 9);
  });
  it('正面に本陣以外の敵がいても戦わない。狙い（本陣）が近接の距離に入れば戦う', () => {
    const s = battle([p('cavalry', 5, 10, 'hunt')], [p('hq', 5, 0, 'hold'), p('infantry', 5, 9, 'hold')]);
    step(s, []);
    expect(s.units[0]!.target).toBe(1);
    expect(s.units[2]!.men).toBe(100);
    const t = battle([p('cavalry', 5, 10, 'hunt')], [p('hq', 5, 9, 'hold'), p('infantry', 0, 0, 'hold')]);
    step(t, []);
    expect(t.units[0]!.target).toBe(1);
    expect(t.units[1]!.men).toBeLessThan(80);
  });
  it('続けて2秒のあいだ 0.3 マスも進めなければ「詰まった」として、近接の距離のいちばん近い敵と戦う', () => {
    // 列が戦場の幅いっぱい（幅 11）で抜けられない。端まで滑って詰まる
    const s = huntScene([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 11);
    let stuckAt = -1;
    run(s, 200, () => {
      if (stuckAt < 0 && s.units[0]!.huntStuckOn !== null) stuckAt = s.tick;
    });
    expect(stuckAt).toBeGreaterThan(0);
    expect(s.units[0]!.stats.dealt).toBeGreaterThan(0);
    expect(s.units[2]!.stats.taken).toBe(0);
  });
  it('詰まって戦っていた相手が消えたら、また本陣へ向かう', () => {
    const s = huntScene([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 11);
    const u = s.units[0]!;
    for (let i = 0; i < 200 && u.huntStuckOn === null; i++) step(s, []);
    expect(u.status).toBe('active');
    const foe = u.huntStuckOn;
    expect(foe).not.toBeNull();
    if (foe === null) return;
    s.units[foe]!.status = 'gone';
    s.units[foe]!.goneReason = 'destroyed';
    step(s, []);
    expect(u.huntStuckOn).toBeNull();
    expect(u.target).toBe(2);
  });
  it('敵の本陣がなければ、前進と同じ', () => {
    const s = battle([p('cavalry', 5, 12, 'hunt')], [p('infantry', 8, 2, 'hold')]);
    step(s, []);
    expect(s.units[0]!.target).toBe(1);
  });
});
