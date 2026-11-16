// ステージ（design §3.10）
import { describe, expect, it } from 'vitest';
import {
  defaultStance,
  STAGES,
  stageEnemyVisible,
  stageLineArmy,
  stageSetup,
  starsFor,
  validateArmy,
  validateStageArmy,
  MAX_UNITS,
  type BattleSummary,
  type Stage,
} from '../src/index.ts';
import { lineStats, solutionStats } from '../sim/stagelib.ts';

describe('第1章の5面', () => {
  it('id は 1-1〜1-5、手持ちは 8〜15 部隊で、面が進むにつれて増える', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5']);
    const sizes = STAGES.map((s) => Object.values(s.roster).reduce((a, b) => a + (b ?? 0), 0));
    for (const n of sizes) {
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(15);
    }
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]!);
    for (const s of STAGES) expect(s.roster.hq).toBe(1);
  });
  it('1-1〜1-3 は、ひな形・方針の切り替え・号令を出さない。1-4 は号令だけ出さない。1-5 は全部使える', () => {
    for (const id of ['1-1', '1-2', '1-3']) expect(STAGES.find((s) => s.id === id)!.allow).toEqual({ stances: [], orders: false, templates: false });
    expect(STAGES.find((s) => s.id === '1-4')!.allow).toEqual({ orders: false });
    expect(STAGES.find((s) => s.id === '1-5')!.allow).toBeUndefined();
  });
  it('各面の敵・見本・手持ちが、配置の検査を通る', () => {
    for (const s of STAGES) {
      expect(validateArmy(s.enemy, s.field.zones[1], { maxUnits: MAX_UNITS }), `${s.id} の敵`).toEqual([]);
      expect(validateStageArmy(s, s.solution), `${s.id} の見本`).toEqual([]);
      expect(validateStageArmy(s, stageLineArmy(s)), `${s.id} の横陣`).toEqual([]);
      expect(s.hint.length).toBeGreaterThan(5);
      expect(s.hint.length).toBeLessThanOrEqual(24);
    }
  });
  for (const s of STAGES) {
    it(`${s.id} ${s.name}：見本が種20個のうち18個以上で勝ち、星の平均が2以上`, () => {
      const r = solutionStats(s);
      expect(r.wins).toBeGreaterThanOrEqual(18);
      expect(r.starsMean).toBeGreaterThanOrEqual(2);
    }, 120_000);
    if (s.id === '1-1') {
      it('1-1：横陣のひな形どおりで、種20個のうち16個以上で勝つ（遊び方を覚える面）', () => {
        expect(lineStats(s).wins).toBeGreaterThanOrEqual(16);
      }, 120_000);
    } else {
      it(`${s.id}：横陣のひな形をそのまま置いただけ（方針を出さない面では初期設定の方針）では、10個以下しか勝てない`, () => {
        expect(lineStats(s).wins).toBeLessThanOrEqual(10);
      }, 120_000);
    }
  }
});

describe('stageSetup', () => {
  it('defeat は時間切れで負け、survive は時間切れで勝ち。敵の号令は陣営1の予定された号令', () => {
    const s = STAGES.find((x) => x.id === '1-5')!;
    const setup = stageSetup(s, s.solution, 7);
    expect(setup.timeout).toBe('side0_loses');
    expect(setup.armies).toEqual([s.solution, s.enemy]);
    expect(setup.seed).toBe(7);
    expect(setup.maxTicks).toBe(1800);
    expect(setup.scriptedOrders).toEqual([{ tick: 100, side: 1, target: 'all', kind: 'charge' }]);
    const surv: Stage = { ...s, win: { type: 'survive' } };
    expect(stageSetup(surv, s.solution, 1).timeout).toBe('side0_wins');
  });
});

describe('validateStageArmy', () => {
  const s = STAGES.find((x) => x.id === '1-3')!;
  it('兵種ごとの数が手持ちを超えるとエラー。全部隊を置いていなくてもよい', () => {
    expect(validateStageArmy(s, [{ kind: 'hq', col: 5, row: 14, stance: 'hold' }, { kind: 'shield', col: 5, row: 10, stance: 'hold' }])).toEqual([]);
    const tooMany = [{ kind: 'hq' as const, col: 5, row: 14, stance: 'hold' as const }, ...[0, 1, 2, 3, 4].map((c) => ({ kind: 'shield' as const, col: c, row: 10, stance: 'hold' as const }))];
    expect(validateStageArmy(s, tooMany).map((e) => e.code)).toContain('over_roster');
    expect(validateStageArmy(s, [{ kind: 'hq', col: 5, row: 14, stance: 'hold' }, { kind: 'cavalry', col: 5, row: 10, stance: 'flank' }]).map((e) => e.code)).toContain('over_roster');
  });
  it('方針を出さない面では、兵種の初期設定の方針しか選べない', () => {
    expect(validateStageArmy(s, [{ kind: 'hq', col: 5, row: 14, stance: 'hold' }, { kind: 'infantry', col: 5, row: 10, stance: 'hold' }]).map((e) => e.code)).toContain('invalid_stance');
    expect(validateStageArmy(s, [{ kind: 'hq', col: 5, row: 14, stance: 'hold' }, { kind: 'infantry', col: 5, row: 10, stance: defaultStance('infantry') }])).toEqual([]);
    const s4 = STAGES.find((x) => x.id === '1-4')!;
    expect(validateStageArmy(s4, [{ kind: 'hq', col: 5, row: 14, stance: 'hold' }, { kind: 'infantry', col: 5, row: 10, stance: 'hold' }])).toEqual([]);
  });
  it('エリアの外・本陣なしはエラー。壊れた値で例外を投げない', () => {
    expect(validateStageArmy(s, [{ kind: 'hq', col: 5, row: 4, stance: 'hold' }]).map((e) => e.code)).toContain('out_of_zone');
    expect(validateStageArmy(s, [{ kind: 'shield', col: 5, row: 10, stance: 'hold' }]).map((e) => e.code)).toContain('hq_count');
    for (const v of [null, undefined, 1, {}, [null]]) {
      expect(() => validateStageArmy(s, v as never)).not.toThrow();
      expect(() => validateStageArmy(v as never, [])).not.toThrow();
    }
  });
});

describe('starsFor', () => {
  const sum = (winner: 0 | 1 | 'draw', r0: number): BattleSummary => ({ winner, reason: 'wipeout', seconds: 10, remaining: [r0, 0.2], units: [], firstBroken: [null, null] });
  it('勝ったときだけ星が付く。残った兵の割合 0.8 以上で3、0.5 以上で2、それ未満で1（境目）', () => {
    expect(starsFor(sum(0, 0.8), 0)).toBe(3);
    expect(starsFor(sum(0, 0.7999), 0)).toBe(2);
    expect(starsFor(sum(0, 0.5), 0)).toBe(2);
    expect(starsFor(sum(0, 0.4999), 0)).toBe(1);
    expect(starsFor(sum(0, 0), 0)).toBe(1);
    expect(starsFor(sum(1, 0.9), 0)).toBe(0);
    expect(starsFor(sum('draw', 0.9), 0)).toBe(0);
    expect(starsFor(sum(1, 0.9), 1)).toBe(1); // 陣営1から見れば勝ちで、残りは 0.2
  });
});

describe('stageEnemyVisible', () => {
  it('霧のマスを除き、方針を含めない', () => {
    for (const s of STAGES) {
      const v = stageEnemyVisible(s);
      expect(v.length).toBe(s.enemy.length);
      for (const e of v) expect(Object.keys(e).sort()).toEqual(['col', 'kind', 'row']);
    }
    const s = STAGES[0]!;
    const fogged: Stage = { ...s, fog: [{ col: s.enemy[1]!.col, row: s.enemy[1]!.row }] };
    const v = stageEnemyVisible(fogged);
    expect(v.length).toBe(s.enemy.length - 1);
    expect(v.some((e) => e.col === s.enemy[1]!.col && e.row === s.enemy[1]!.row)).toBe(false);
  });
});
