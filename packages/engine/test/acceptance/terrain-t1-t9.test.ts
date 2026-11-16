// 地形の条件 T1〜T9（design §3.8）。場面は sim/terrain-scenes.ts（座標・地形の置き方はそこのコメント）。T10 は t10-plain-unchanged.test.ts。
import { describe, expect, it } from 'vitest';
import { createBattle, step, type BattleEvent, type BattleState, type Stance } from '../../src/index.ts';
import { T } from '../../src/tuning.ts';
import { clearOfWalls, sideOfWall, wallsOf } from '../../src/walls.ts';
import { castleSetup, t1, t2, t3, t4, t4Cav, withTerrain, at, CASTLE_WALL_ROW } from '../../sim/terrain-scenes.ts';
import { place } from '../helpers.ts';

function make(setup: Parameters<typeof createBattle>[0]): BattleState {
  const r = createBattle(setup);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe('T1〜T4：地形が戦いに効く（種40個）', () => {
  it('T1 丘：丘の上の側の得点率が、平地より 0.2 以上高い', () => {
    expect(t1(true) - t1(false)).toBeGreaterThanOrEqual(0.2);
  }, 120_000);
  it('T2 森：森の中では、背面から騎兵に当たられた歩兵が消えるまでの時間の中央値が、平地の 1.3 倍以上', () => {
    expect(t2(true) / t2(false)).toBeGreaterThanOrEqual(1.3);
  }, 120_000);
  it('T3 川：川岸で守る側の得点率が 0.8 以上。同じ配置を平地に置くと 0.35〜0.65', () => {
    expect(t3(true)).toBeGreaterThanOrEqual(0.8);
    const plain = t3(false);
    expect(plain).toBeGreaterThanOrEqual(0.35);
    expect(plain).toBeLessThanOrEqual(0.65);
  }, 120_000);
  it('T4 柵（前半・幅 3）：柵の側の得点率が 0.6 以上、柵がなければ 0.2 以下', () => {
    expect(t4(true, 'none')).toBeGreaterThanOrEqual(0.6);
    expect(t4(false, 'none')).toBeLessThanOrEqual(0.2);
  }, 120_000);
  it('T4 柵（後半・幅 8）：騎兵2を、迂回させて背面から当てると、正面から当てた場合より柵の側の得点率が 0.3 以上低い', () => {
    const front = t4Cav('front');
    const rear = t4Cav('rear');
    // 場面の条件：正面の場合は柵の正面から当たって突入が起きない。背面の場合は、正面の歩兵と組み合っている守る側に突入が起き、
    // 騎兵の損害の大半が側面・背面から
    expect(front.impacts).toBe(0);
    expect(front.sideRearShare).toBeLessThan(0.1);
    expect(rear.impacts).toBeGreaterThanOrEqual(1);
    expect(rear.pinnedImpacts).toBe(rear.impacts);
    expect(rear.sideRearShare).toBeGreaterThan(0.8);
    expect(front.score - rear.score).toBeGreaterThanOrEqual(0.3);
  }, 120_000);
});

/** 城壁と門の戦場を最後まで流し、刻みごとに check を呼ぶ */
function runCastle(stance: Stance, seed: number, check: (s: BattleState, ev: BattleEvent[]) => void): BattleState {
  const s = make(castleSetup(stance, seed));
  while (!s.outcome) check(s, step(s, []));
  return s;
}

describe('T5 城壁と門', () => {
  it('前進の部隊が門を破り、そのあと切れ目を通って中の敵と戦う。城壁に入らず、門が立っている間は反対側へ出ず、城壁ごしの近接はない', () => {
    const w = wallsOf(castleSetup('advance', 1).field)!;
    const problems: string[] = [];
    let gateDown = -1;
    let insideFight = -1;
    const s = runCastle('advance', 1, (st, ev) => {
      for (const e of ev) if (e.type === 'destroyed' && e.unit === st.gate!.id) gateDown = e.tick;
      const gateUp = st.units[st.gate!.id]!.status === 'active';
      for (const u of st.units) {
        if (u.kind === 'gate' || u.status !== 'active') continue;
        if (!clearOfWalls(w, st.field, u.x, u.y)) problems.push(`城壁に入った ${u.id} @${st.tick}`);
        // 門が立っている間：陣営0（城壁の下）も陣営1（上）も、城壁の行の反対側へ出ない
        if (gateUp && sideOfWall(w, u.y) !== (u.side === 0 ? 1 : -1)) problems.push(`反対側へ出た ${u.id} @${st.tick}`);
        // 城壁ごしの近接：近接の距離の相手が、城壁の行をはさんで反対側にいる
        if (u.attacking !== null) {
          const v = st.units[u.attacking]!;
          const d = Math.hypot(u.x - v.x, u.y - v.y);
          const a = sideOfWall(w, u.y);
          const b = sideOfWall(w, v.y);
          if (v.kind !== 'gate' && d <= T.meleeRange && a !== 0 && b !== 0 && a !== b) problems.push(`城壁ごしの近接 ${u.id}→${v.id} @${st.tick}`);
          if (u.side === 0 && v.side === 1 && v.kind !== 'gate' && sideOfWall(w, u.y) <= 0 && insideFight < 0) insideFight = st.tick;
        }
      }
    });
    expect(problems.slice(0, 10)).toEqual([]);
    expect(gateDown).toBeGreaterThan(0);
    expect(insideFight).toBeGreaterThan(gateDown);
    expect(s.outcome).not.toBeNull();
  }, 60_000);
});

describe('T6 門の決着', () => {
  /** 門の正面に陣営0の歩兵を置き、門の耐久を 0.01 にして、刻み 0 で破れるようにする（決まりの確認のための仕込み） */
  function brink(win: boolean): BattleState {
    const s = make(castleSetup('advance', 1, win));
    place(s, 1, 5.5, 6.45);
    s.units[1]!.target = s.gate!.id;
    s.units[s.gate!.id]!.men = 0.01;
    return s;
  }
  it('win が true で、ほかの負けの条件がないとき、門が全滅した刻みに門の側の負けで決着する（理由は gate）', () => {
    const s = brink(true);
    const ev = step(s, []);
    expect(s.outcome).toEqual({ winner: 0, reason: 'gate', tick: 0 });
    expect(ev.at(-1)).toEqual({ type: 'end', tick: 0, winner: 0, reason: 'gate' });
  });
  it('同じ刻みに攻める側も負けの条件を満たすと引き分け（理由は gate を優先）', () => {
    const s = brink(true);
    // 陣営0の本陣を、陣営1の歩兵が近接の距離で攻めていて、士気がほぼ 0（同じ刻みに敗走する）
    const hq = s.units[0]!;
    place(s, 9, hq.x, hq.y - 1);
    s.units[9]!.target = 0;
    hq.morale = 0.001;
    step(s, []);
    expect(s.outcome).toEqual({ winner: 'draw', reason: 'gate', tick: 0 });
  });
  it('win が false なら、門が破れても決着しない', () => {
    const s = brink(false);
    step(s, []);
    expect(s.units[s.gate!.id]!.status).toBe('gone');
    expect(s.outcome).toBeNull();
  });
  it('win は BattleState に持ち、JSON にして戻しても変わらない', () => {
    const s = brink(true);
    const back = JSON.parse(JSON.stringify(s)) as BattleState;
    expect(back.gate).toEqual(s.gate);
    step(back, []);
    expect(back.outcome?.reason).toBe('gate');
  });
});

describe('T7 弓は城壁を越える', () => {
  it('城壁の内側で守備の弓兵と、外側で守備の歩兵。門は立ったまま。歩兵が損害を受ける', () => {
    // 弓兵（陣営1）は (5,3)、歩兵（陣営0）は (3,7)。距離は約 4.5 で、弓の届く距離の内側。門 (5,5) には誰も近づかない
    const setup = castleSetup('hold', 1);
    setup.armies = [[{ kind: 'hq', stance: 'hold', col: 5, row: 14 }, { kind: 'infantry', stance: 'hold', col: 3, row: 7 }], [{ kind: 'hq', stance: 'hold', col: 5, row: 0 }, { kind: 'archer', stance: 'hold', col: 5, row: 3 }]];
    setup.skipZoneCheck = 0;
    const s = make(setup);
    for (let i = 0; i < 50; i++) step(s, []);
    expect(s.units[1]!.men).toBeLessThan(100);
    expect(s.units[s.gate!.id]!.status).toBe('active');
    expect(s.units[s.gate!.id]!.men).toBe(T.gateMen);
  });
});

describe('T8 止まったままにならない', () => {
  for (const stance of ['advance', 'flank', 'hunt'] as const) {
    it(`攻める側の全部隊を ${stance} にして最後まで流しても、30 秒以上ほとんど動かない部隊がいない（攻撃している部隊・持ち場にいる守備の部隊・門が立っている間に門の前で待つ部隊を除く）。門が破れる`, () => {
      const w = wallsOf(castleSetup(stance, 1).field)!;
      const gx = 5.5;
      const gy = CASTLE_WALL_ROW + 0.5;
      const history: { x: number; y: number }[][] = [];
      let gateDown = -1;
      const stuck: string[] = [];
      let checked = 0;
      let checkedAfterGate = 0;
      runCastle(stance, 1, (st, ev) => {
        for (const e of ev) if (e.type === 'destroyed' && e.unit === st.gate!.id) gateDown = e.tick;
        history.push(st.units.map((u) => ({ x: u.x, y: u.y })));
        if (history.length <= 300) return;
        const then = history[history.length - 301]!;
        for (const u of st.units) {
          if (u.side !== 0 || u.kind === 'hq' || u.status !== 'active') continue;
          // 攻撃している部隊と、守備で持ち場にいる部隊は、動かなくてよい
          if (u.attacking !== null) continue;
          if (u.stance === 'hold' && Math.hypot(u.x - u.home.x, u.y - u.home.y) <= T.homeTolerance) continue;
          checked++;
          if (gateDown >= 0) checkedAfterGate++;
          // 門の前で攻撃に加われない部隊は除く：狙いが門か、城壁の反対側にあって（門を通りたい）、門のマスの中心から 3.0 以内で順番を待っている部隊。
          // 切れ目は1マスなので、門を攻められるのは1部隊だけで、残りは門の前に固まって待つ
          const tgt = u.target === null ? null : st.units[u.target]!;
          const wantsThrough = tgt !== null && (tgt.kind === 'gate' || sideOfWall(w, tgt.y) !== sideOfWall(w, u.y));
          if (gateDown < 0 && wantsThrough && Math.hypot(u.x - gx, u.y - gy) <= 3.0) continue;
          const p = then[u.id]!;
          if (Math.hypot(u.x - p.x, u.y - p.y) < 0.3) stuck.push(`${u.id} @${st.tick}`);
        }
      });
      expect(stuck.slice(0, 5)).toEqual([]);
      expect(gateDown).toBeGreaterThan(0);
      // 検査が実際に走っていること（門が破れたあとも含めて）
      expect(checked).toBeGreaterThan(100);
      expect(checkedAfterGate).toBeGreaterThan(0);
      expect(w.gapCol).toBe(5);
    }, 60_000);
  }
});

describe('T9 再現できる（地形のある戦場）', () => {
  /** 途中の刻み at で状態を JSON にして戻してから続けても、以後の毎刻みの出来事と最後の状態が変わらない */
  function check(setup: Parameters<typeof createBattle>[0], at: number): void {
    const ref = make(setup);
    const log: BattleEvent[][] = [];
    while (!ref.outcome) log.push(step(ref, []));
    const s = make(setup);
    while (s.tick < at) step(s, []);
    const back = JSON.parse(JSON.stringify(s)) as BattleState;
    const log2: BattleEvent[][] = [];
    while (!back.outcome) log2.push(step(back, []));
    expect(log2).toEqual(log.slice(at));
    expect(back).toEqual(ref);
  }
  it('門に向かっている途中（3秒）', () => {
    check(castleSetup('advance', 1), 30);
  }, 60_000);
  it('門が破れた直後', () => {
    const s = make(castleSetup('advance', 1));
    let down = -1;
    while (!s.outcome && down < 0) for (const e of step(s, [])) if (e.type === 'destroyed' && e.unit === s.gate!.id) down = e.tick;
    expect(down).toBeGreaterThan(0);
    check(castleSetup('advance', 1), down + 1);
  }, 60_000);
  it('川を渡っている途中（T3 の場面で、攻める側が川の中にいる刻み）', () => {
    const cells: [number, number, 'river'][] = [];
    for (const row of [8, 9]) for (let c = 0; c < 12; c++) cells.push([c, row, 'river']);
    const setup = { field: withTerrain(cells), armies: [at('infantry', 'hold', [4, 5, 6, 7], 10), at('infantry', 'advance', [4, 5, 6, 7], 5)] as [never, never], seed: 1000, maxTicks: 1800, timeout: 'compare' as const, requireHq: false };
    const s = make(setup);
    while (!s.outcome && !s.units.some((u) => u.side === 1 && Math.floor(u.y) === 8)) step(s, []);
    expect(s.outcome).toBeNull();
    check(setup, s.tick);
  }, 60_000);
});
