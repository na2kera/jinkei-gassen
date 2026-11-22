// 守備の味方の並びを回り込む（design §3.6.6 の D1〜D8。D8 の総当たりの分は a06-a07-a09-a12-matrix.test.ts で数える）
import { describe, expect, it } from 'vitest';
import { createBattle, plainField, STAGES, step, viewFor, type BattleEvent, type BattleState, type Field, type Placement } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { SEEDS_40 } from '../sim/lib.ts';
import { runStage, stageTemplateArmy, STAGE_SEEDS } from '../sim/stagelib.ts';
import { battle, blockedCounter, DIFFICULTY_LATER, openField, p, place } from './helpers.ts';

const row = (kind: Placement['kind'], stance: Placement['stance'], cols: number[], r: number): Placement[] => cols.map((col) => ({ kind, stance, col, row: r }));

/** D1：盾兵3（守備、列 3・4・5、行 10）の後ろに歩兵2（前進、列 4・5、行 11）。敵は歩兵2（守備、行 3） */
function d1Armies(enemyCols = [4, 5]): [Placement[], Placement[]] {
  return [[...row('shield', 'hold', [3, 4, 5], 10), ...row('infantry', 'advance', [4, 5], 11)], row('infantry', 'hold', enemyCols, 3)];
}

/** D5：D1 の歩兵を列 3・4 に置き、敵を右（配置エリアの右端の2列）に置く */
function d5Armies(): [Placement[], Placement[]] {
  const z = plainField().zones[1];
  const right = [z.col + z.width - 2, z.col + z.width - 1];
  return [[...row('shield', 'hold', [3, 4, 5], 10), ...row('infantry', 'advance', [3, 4], 11)], row('infantry', 'hold', right, 3)];
}

/** 180° 回して陣営を入れ替える（配置の配列の中の順は保つ） */
function rotated([a, b]: [Placement[], Placement[]]): [Placement[], Placement[]] {
  const { width, height } = plainField();
  const rot = (ps: Placement[]): Placement[] => ps.map((p) => ({ ...p, col: width - 1 - p.col, row: height - 1 - p.row }));
  return [rot(b), rot(a)];
}

function make(armies: [Placement[], Placement[]], seed: number, field: Field = plainField()): BattleState {
  const r = createBattle({ field, armies, seed, maxTicks: 1800, timeout: 'compare', requireHq: false });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** A12 の決まり（戦場の内側、active な2部隊が 0.6 より近づかない）を破っていれば、その中身を返す */
function a12Problem(s: BattleState): string | null {
  const act = s.units.filter((u) => u.status === 'active');
  for (const u of act) {
    if (!(u.x >= T.edgeMargin - 1e-9 && u.x <= s.field.width - T.edgeMargin + 1e-9 && u.y >= T.edgeMargin - 1e-9 && u.y <= s.field.height - T.edgeMargin + 1e-9)) return `端の外 ${u.id} @${s.tick}`;
  }
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) if (!(Math.hypot(act[i]!.x - act[j]!.x, act[i]!.y - act[j]!.y) >= 0.6)) return `近すぎる ${act[i]!.id}-${act[j]!.id} @${s.tick}`;
  return null;
}

interface Crossing {
  /** 歩兵ごとの、盾兵の行を越えた刻み（越えなければ -1） */
  cross: number[];
  /** 歩兵ごとの、最初に攻撃した刻み（しなければ -1） */
  attack: number[];
  /** 歩兵ごとの、最初に入った detourX（入らなければ null） */
  exit: (number | null)[];
  blockedMax: number;
}

/** 陣営 side の歩兵（ids）が、盾兵の行（陣営0なら y < 9、陣営1なら、それを 180° 回した y > 高さ − 9）を越えた刻みと、攻撃した刻みを見る */
function watch(s: BattleState, ids: number[], side: 0 | 1, until = 1800): Crossing {
  const out: Crossing = { cross: ids.map(() => -1), attack: ids.map(() => -1), exit: ids.map(() => null), blockedMax: 0 };
  const bc = blockedCounter();
  while (!s.outcome && s.tick < until) {
    step(s, []);
    bc.onTick(s);
    ids.forEach((id, i) => {
      const u = s.units[id]!;
      if (out.cross[i] === -1 && (side === 0 ? u.y < 9 : u.y > s.field.height - 9)) out.cross[i] = s.tick;
      if (out.attack[i] === -1 && u.attacking !== null) out.attack[i] = s.tick;
      if (out.exit[i] === null && u.detourX !== null) out.exit[i] = u.detourX;
    });
  }
  out.blockedMax = bc.maxTicks();
  return out;
}

describe('守備の味方の並びを回り込む（design §3.6.6）', () => {
  it('D1 抜け出す：種40個すべてで、25 秒以内に歩兵2部隊が盾兵の行より前に出て、60 秒以内に敵を攻撃する', () => {
    const bad: string[] = [];
    for (const seed of SEEDS_40) {
      const w = watch(make(d1Armies(), seed), [3, 4], 0, 600);
      if (!w.cross.every((t) => t >= 0 && t <= 250) || !w.attack.every((t) => t >= 0 && t <= 600)) bad.push(`種${seed} 越えた ${w.cross} 攻撃 ${w.attack}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('D2 陣営を替えても同じ：180° 回して陣営を入れ替えても D1 を満たし、盾兵の行を越える刻みが種ごとに一致する', () => {
    const bad: string[] = [];
    for (const seed of SEEDS_40) {
      const a = watch(make(d1Armies(), seed), [3, 4], 0, 600);
      // 回したあとは、陣営0が敵の歩兵2（id 0・1）、陣営1が盾兵3（id 2〜4）と歩兵2（id 5・6）
      const b = watch(make(rotated(d1Armies()), seed), [5, 6], 1, 600);
      if (!b.cross.every((t) => t >= 0 && t <= 250) || !b.attack.every((t) => t >= 0 && t <= 600)) bad.push(`種${seed} 越えた ${b.cross} 攻撃 ${b.attack}`);
      if (JSON.stringify(a.cross) !== JSON.stringify(b.cross)) bad.push(`種${seed} 越えた刻みが違う ${a.cross} / ${b.cross}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('D2 距離の境界：守り手がちょうど spacing + detourReach の距離にいる場面と、それを 180° 回して陣営を入れ替えた場面で、回り込みを始めるかが一致する', () => {
    // 前進の歩兵 (0.5, 2) と守り手の盾兵 (1.1, 1.2) の距離は、元の配置で 1、回した配置では丸めで 1.0000000000000004 になる
    const scene = (rot: boolean): BattleState => {
      const P = (x: number, y: number): [number, number] => (rot ? [12 - x, 16 - y] : [x, y]);
      const mine = [p('shield', 0, 0, 'hold'), p('infantry', 1, 1)];
      const foe = [p('infantry', 5, 5, 'hold')];
      const s = battle(rot ? foe : mine, rot ? mine : foe);
      const [sh, inf, en] = rot ? [1, 2, 0] : [0, 1, 2];
      place(s, sh, ...P(1.1, 1.2));
      place(s, inf, ...P(0.5, 2));
      place(s, en, ...P(5.5, 0.5));
      s.units[inf]!.advMoves = Array.from({ length: T.detourStuckTicks }, () => [0, 0] as [number, number]);
      return s;
    };
    const a = scene(false);
    const b = scene(true);
    step(a, []);
    step(b, []);
    expect(a.units[1]!.detourX).not.toBeNull();
    expect(b.units[2]!.detourX === null).toBe(a.units[1]!.detourX === null);
    expect(12 - b.units[2]!.detourX!).toBeCloseTo(a.units[1]!.detourX!, 9);
  }, 120_000);

  it('回り込み中に敗走した部隊は、次の刻みに回り込みの項目が消える', () => {
    const s = make(d1Armies(), SEEDS_40[0]!);
    while (!s.outcome && !(typeof s.units[3]!.detourX === 'number' && s.units[3]!.detourTicks > 2)) step(s, []);
    const u = s.units[3]!;
    u.status = 'routing';
    u.routTick = s.tick;
    step(s, []);
    expect(u.detourX).toBeNull();
    expect(u.detourTicks).toBe(0);
    expect(u.advMoves).toEqual([]);
  }, 120_000);

  it('D3 弓は盾の陰から出ない：1-3 の見本で、開戦から 20 秒の間、弓兵の x は最初の位置から 0.5 より動かない', () => {
    const s13 = STAGES.find((s) => s.id === '1-3')!;
    const bad: string[] = [];
    for (const seed of STAGE_SEEDS) {
      let start: Map<number, number> | null = null;
      runStage(s13, s13.solution, seed, (s) => {
        if (!start) start = new Map(s.units.filter((u) => u.side === 0 && u.kind === 'archer').map((u) => [u.id, u.home.x]));
        if (s.tick <= 200) for (const [id, x0] of start) if (Math.abs(s.units[id]!.x - x0) > 0.5) bad.push(`種${seed} 弓兵${id} @${s.tick}`);
      }, s13.solutionOrders ?? []);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  }, 120_000);

  // 置き直した 1-3 の見本（decisions §25）では、弓兵の後ろの歩兵（列 5、行 10）が、止まった弓兵を回り込む（detourX が入る）。
  // 回り込み自体は D1 の決まりどおりで、見本の並びに頼る条件なので、見本を作り直すまで止める
  it('D3 1-3 の見本では、detourX はどの部隊にも入らない', (ctx) => {
    ctx.skip(DIFFICULTY_LATER);
    const s13 = STAGES.find((s) => s.id === '1-3')!;
    const bad: string[] = [];
    for (const seed of STAGE_SEEDS) {
      runStage(s13, s13.solution, seed, (s) => {
        for (const u of s.units) if (u.detourX !== null) bad.push(`種${seed} ${u.id} の detourX @${s.tick}`);
      }, s13.solutionOrders ?? []);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  }, 120_000);

  // (a) は通り道の列にも盾兵を置くので、戦場全体を配置エリアにした標準の大きさの戦場で作る
  const full = openField(plainField().width, plainField().height);
  const d4 = {
    '(a) 戦場の端から端まで盾兵が並ぶ': [[[...row('shield', 'hold', Array.from({ length: full.width }, (_, c) => c), 10), ...row('infantry', 'advance', [5], 11)], row('infantry', 'hold', [4, 5], 3)], full],
    '(b) 盾兵の囲みの真ん中': [
      [[...row('shield', 'hold', [3, 4, 5], 9), ...row('shield', 'hold', [3, 5], 10), ...row('shield', 'hold', [3, 4, 5], 11), ...row('infantry', 'advance', [4], 10)], row('infantry', 'hold', [4, 5], 3)],
      plainField(),
    ],
  } as Record<string, [[Placement[], Placement[]], Field]>;
  for (const [name, [armies, field]] of Object.entries(d4)) {
    it(`D4 出口がなければ始めない ${name}：60 秒の間、歩兵の detourX は入らず、5 秒の位置から 1.0 より離れず、A12 を破らない`, () => {
      const inf = armies[0].findIndex((p) => p.kind === 'infantry');
      const s = make(armies, 1, field);
      let at5: { x: number; y: number } | null = null;
      const bad: string[] = [];
      while (!s.outcome && s.tick < 600) {
        step(s, []);
        const u = s.units[inf]!;
        if (s.tick === 50) at5 = { x: u.x, y: u.y };
        if (u.detourX !== null) bad.push(`detourX @${s.tick}`);
        if (at5 && Math.hypot(u.x - at5.x, u.y - at5.y) > 1.0) bad.push(`離れた @${s.tick}`);
        const p = a12Problem(s);
        if (p) bad.push(p);
      }
      expect(s.tick).toBe(600);
      expect(bad.slice(0, 10)).toEqual([]);
    }, 120_000);
  }

  // 歩兵を列 4・5 に置くと、列 5 の歩兵は右隣が空いているので ④-2 だけで出てしまうため、列 3・4 に置く（design §3.6.6 の D5）
  it('D5 同じ出口へ続く：敵が右にいると、種40個すべてで、歩兵2部隊とも回り込みを始めて右の出口を選び、40 秒以内に2部隊とも盾兵の行より前に出る', () => {
    const bad: string[] = [];
    for (const seed of SEEDS_40) {
      const s = make(d5Armies(), seed);
      const x0 = [s.units[3]!.x, s.units[4]!.x];
      const w = watch(s, [3, 4], 0, 400);
      w.exit.forEach((e, i) => {
        if (e === null || !(e > x0[i]!) || Math.abs(e - (5.5 + T.spacing + T.detourGap)) > 1e-9) bad.push(`種${seed} 歩兵${i} の出口 ${e}`);
      });
      if (!w.cross.every((t) => t >= 0 && t <= 400)) bad.push(`種${seed} 越えた ${w.cross}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  describe('D6 途中で保存しても同じ', () => {
    it('(a) 歩兵の detourX が入っている刻みに JSON にして戻しても、以後の毎刻みの出来事と最後の状態が変わらない', () => {
      for (const seed of SEEDS_40.slice(0, 5)) {
        const ref = make(d1Armies(), seed);
        const log: BattleEvent[][] = [];
        let at = -1;
        while (!ref.outcome) {
          if (at < 0 && ref.units[3]!.detourX !== null && ref.units[3]!.detourTicks >= 3) at = ref.tick;
          log.push(step(ref, []));
        }
        expect(at, `種${seed}`).toBeGreaterThan(0);
        const s = make(d1Armies(), seed);
        while (s.tick < at) step(s, []);
        const restored = JSON.parse(JSON.stringify(s)) as BattleState;
        const got: BattleEvent[][] = [];
        while (!restored.outcome) got.push(step(restored, []));
        expect(got).toEqual(log.slice(at));
        expect(restored).toEqual(ref);
      }
    }, 120_000);

    it('(b) 開戦直後・待っている途中・回り込みの途中で、足した3つの項目を消して続けても落ちず、A12 を破らず、60 秒以内に敵を攻撃する', () => {
      for (const seed of SEEDS_40.slice(0, 5)) {
        // 回り込みの途中の刻みを、ふつうに流して探す
        const probe = make(d1Armies(), seed);
        let mid = -1;
        while (!probe.outcome && mid < 0) {
          step(probe, []);
          if (probe.units[3]!.detourX !== null && probe.units[3]!.detourTicks >= 3) mid = probe.tick;
        }
        expect(mid, `種${seed}`).toBeGreaterThan(30);
        for (const at of [0, 30, mid]) {
          const s = make(d1Armies(), seed);
          while (s.tick < at) step(s, []);
          const old = JSON.parse(JSON.stringify(s)) as BattleState;
          for (const u of old.units as unknown as Record<string, unknown>[]) {
            delete u['advMoves'];
            delete u['detourX'];
            delete u['detourTicks'];
          }
          const attacked = [-1, -1];
          const bad: string[] = [];
          while (!old.outcome && old.tick < 600) {
            step(old, []);
            [3, 4].forEach((id, i) => {
              if (attacked[i] === -1 && old.units[id]!.attacking !== null) attacked[i] = old.tick;
            });
            const p = a12Problem(old);
            if (p) bad.push(p);
          }
          expect(bad.slice(0, 5), `種${seed} 刻み${at}`).toEqual([]);
          expect(attacked.every((t) => t >= 0), `種${seed} 刻み${at} ${attacked}`).toBe(true);
        }
      }
    }, 120_000);
  });

  it('D7 隠す情報が増えない：回り込み中の刻みで、viewFor のどの部隊にも足した項目の鍵がなく、出来事にも出ない', () => {
    const s = make(d1Armies(), SEEDS_40[0]!);
    let seen = 0;
    const keys = ['advMoves', 'detourX', 'detourTicks'];
    while (!s.outcome && s.tick < 600) {
      const ev = step(s, []);
      for (const e of ev) for (const k of keys) expect(Object.keys(e)).not.toContain(k);
      if (s.units.some((u) => typeof u.detourX === 'number' && u.detourTicks > 0)) {
        seen++;
        for (const viewer of [0, 1, 'both'] as const) {
          const v = viewFor(s, viewer);
          for (const u of v.units) for (const k of keys) expect(Object.keys(u)).not.toContain(k);
          expect(JSON.stringify(v)).not.toMatch(/advMoves|detourX|detourTicks/);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 120_000);

  describe('D8 長く止まらない：ふさがれ状態の刻みの合計が、どの部隊も 20 秒を超えない', () => {
    it('D1・D5 の場面（種40個ずつ）', () => {
      const bad: string[] = [];
      for (const [name, armies] of [['D1', d1Armies()], ['D5', d5Armies()]] as const) {
        for (const seed of SEEDS_40) {
          const w = watch(make(armies, seed), [3, 4], 0);
          if (w.blockedMax > 200) bad.push(`${name} 種${seed} ${w.blockedMax / 10}秒`);
        }
      }
      expect(bad).toEqual([]);
    }, 120_000);
    // ひな形のままの鶴翼は弓兵が守備で、数える対象から外れるので、直す前のひな形の並び（盾兵の後ろの弓兵が前進）にする
    it('3-2 に、盾兵の後ろの弓兵を前進にした鶴翼を置いた20戦', () => {
      const s32 = STAGES.find((s) => s.id === '3-2')!;
      const army = stageTemplateArmy(s32, 'crane').map((p) => (p.kind === 'archer' ? { ...p, stance: 'advance' as const } : p));
      expect(army.filter((p) => p.kind === 'archer').length).toBeGreaterThan(0);
      const bad: string[] = [];
      for (const seed of STAGE_SEEDS) {
        const bc = blockedCounter();
        runStage(s32, army, seed, bc.onTick);
        if (bc.maxTicks() > 200) bad.push(`種${seed} ${bc.maxTicks() / 10}秒`);
      }
      expect(bad).toEqual([]);
    }, 120_000);
  });
});
