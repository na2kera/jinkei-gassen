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
  STAR_THRESHOLDS,
  summarize,
  type BattleSummary,
  type Placement,
  type Stage,
} from '../src/index.ts';
import { lineStats, ORDER_PERMS, runStage, solutionStats, STAGE_SEEDS, stageTemplateArmy, templateWins } from '../sim/stagelib.ts';

/** 第1章の5面（第2章・第3章は stages-ch23.test.ts） */
const CH1 = STAGES.filter((s) => s.chapter === 1);

describe('第1章の5面', () => {
  it('id は 1-1〜1-5、手持ちは 8〜11 部隊で、面が進むにつれて増える', () => {
    expect(CH1.map((s) => s.id)).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5']);
    expect(STAGES.slice(0, 5)).toEqual(CH1);
    const sizes = CH1.map((s) => Object.values(s.roster).reduce((a, b) => a + (b ?? 0), 0));
    for (const n of sizes) {
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(11);
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
    for (const s of CH1) {
      expect(validateArmy(s.enemy, s.field.zones[1], { maxUnits: MAX_UNITS }), `${s.id} の敵`).toEqual([]);
      expect(validateStageArmy(s, s.solution), `${s.id} の見本`).toEqual([]);
      expect(validateStageArmy(s, stageLineArmy(s)), `${s.id} の横陣`).toEqual([]);
      expect(s.hint.length).toBeGreaterThan(5);
      expect(s.hint.length).toBeLessThanOrEqual(24);
    }
  });
  for (const s of CH1) {
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

describe('ひな形を選ぶだけでは勝ちきれない（1-4・1-5）', () => {
  for (const id of ['1-4', '1-5']) {
    it(`${id}：7つのひな形をそのまま置いたとき、種20個のうち10個より多く勝つひな形は2つ以下`, () => {
      const rows = templateWins(STAGES.find((s) => s.id === id)!);
      expect(rows.filter((r) => r.wins > 10).map((r) => r.id).length, JSON.stringify(rows)).toBeLessThanOrEqual(2);
    }, 300_000);
  }
});

describe('1-5 は膠着しない', () => {
  // 敵の鶴翼の弓兵が守備だと、盾兵3と弓兵2が動かず、こちらの攻め手が尽きたあと時間切れまで何も起きなかった（2026-11-17）
  it('横陣と鶴翼をそのまま置いた40戦（種20個ずつ）に、時間切れか膠着で終わる戦いがない', () => {
    const s5 = STAGES.find((x) => x.id === '1-5')!;
    const bad: string[] = [];
    for (const id of ['line', 'crane'] as const) {
      const army = stageTemplateArmy(s5, id);
      for (const seed of STAGE_SEEDS) {
        const reason = runStage(s5, army, seed).outcome?.reason;
        if (reason === 'timeout' || reason === 'stalemate') bad.push(`${id} 種${seed} ${reason}`);
      }
    }
    expect(bad).toEqual([]);
  }, 300_000);
});

describe('stageSetup', () => {
  it('defeat は時間切れで負け、survive は時間切れで勝ち。敵の号令は陣営1の予定された号令', () => {
    const s = STAGES.find((x) => x.id === '1-5')!;
    const setup = stageSetup(s, s.solution, 7);
    expect(setup.timeout).toBe('side0_loses');
    expect(setup.armies).toEqual([s.solution, s.enemy]);
    expect(setup.seed).toBe(7);
    expect(setup.maxTicks).toBe(1800);
    expect(setup.scriptedOrders).toEqual([
      { tick: 100, side: 1, target: 'all', kind: 'charge' },
      { tick: 300, side: 1, target: 'all', kind: 'charge' },
    ]);
    const surv: Stage = { ...s, win: { type: 'survive' } };
    expect(stageSetup(surv, s.solution, 1).timeout).toBe('side0_wins');
  });
});

describe('validateStageArmy', () => {
  const s = STAGES.find((x) => x.id === '1-3')!;
  // 座標は面の配置エリアから読む（いちばん後ろの行に本陣、いちばん前の行に部隊）
  const z = s.field.zones[0];
  const back = z.row + z.height - 1;
  const front = z.row;
  const mid = z.col + Math.floor(z.width / 2);
  it('兵種ごとの数が手持ちを超えるとエラー。全部隊を置いていなくてもよい', () => {
    expect(validateStageArmy(s, [{ kind: 'hq', col: mid, row: back, stance: 'hold' }, { kind: 'shield', col: mid - 1, row: front, stance: 'hold' }])).toEqual([]);
    const tooMany = [{ kind: 'hq' as const, col: mid, row: back, stance: 'hold' as const }, ...[0, 1, 2, 3, 4].map((c) => ({ kind: 'shield' as const, col: z.col + c, row: front, stance: 'hold' as const }))];
    expect(validateStageArmy(s, tooMany).map((e) => e.code)).toContain('over_roster');
    expect(validateStageArmy(s, [{ kind: 'hq', col: mid, row: back, stance: 'hold' }, { kind: 'cavalry', col: mid - 1, row: front, stance: 'flank' }]).map((e) => e.code)).toContain('over_roster');
  });
  it('方針を出さない面では、兵種の初期設定の方針しか選べない', () => {
    expect(validateStageArmy(s, [{ kind: 'hq', col: mid, row: back, stance: 'hold' }, { kind: 'infantry', col: mid - 1, row: front, stance: 'hold' }]).map((e) => e.code)).toContain('invalid_stance');
    expect(validateStageArmy(s, [{ kind: 'hq', col: mid, row: back, stance: 'hold' }, { kind: 'infantry', col: mid - 1, row: front, stance: defaultStance('infantry') }])).toEqual([]);
    const s4 = STAGES.find((x) => x.id === '1-4')!;
    expect(validateStageArmy(s4, [{ kind: 'hq', col: mid, row: back, stance: 'hold' }, { kind: 'infantry', col: mid - 1, row: front, stance: 'hold' }])).toEqual([]);
  });
  it('エリアの外・本陣なしはエラー。壊れた値で例外を投げない', () => {
    expect(validateStageArmy(s, [{ kind: 'hq', col: mid, row: z.row - 2, stance: 'hold' }]).map((e) => e.code)).toContain('out_of_zone');
    expect(validateStageArmy(s, [{ kind: 'shield', col: mid - 1, row: front, stance: 'hold' }]).map((e) => e.code)).toContain('hq_count');
    for (const v of [null, undefined, 1, {}, [null]]) {
      expect(() => validateStageArmy(s, v as never)).not.toThrow();
      expect(() => validateStageArmy(v as never, [])).not.toThrow();
    }
  });
});

describe('starsFor', () => {
  const sum = (winner: 0 | 1 | 'draw', r0: number): BattleSummary => ({ winner, reason: 'wipeout', seconds: 10, remaining: [r0, 0.2], units: [], firstBroken: [null, null], unusedReserve: [null, null], remainingForStars: [r0, 0.2] });
  it('勝ったときだけ星が付く。残った兵の割合 0.7 以上で3、0.5 以上で2、それ未満で1（境目）', () => {
    expect(STAR_THRESHOLDS).toEqual([0.5, 0.7]);
    expect(starsFor(sum(0, 0.7), 0)).toBe(3);
    expect(starsFor(sum(0, 0.6999), 0)).toBe(2);
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
    for (const s of STAGES.filter((x) => !x.fog)) {
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

describe('星3つは取れる（1-2〜1-5）', () => {
  // 見本を出発点に、部隊の位置・方針（選べる面だけ）・号令（出せる面だけ）を少しずつ変えて探した配置。Stage には入れない。
  // [兵種, 列, 行, 方針]。号令は秒・相手・種類
  type Row = [Placement['kind'], number, number, Placement['stance']];
  const FOUND: Record<string, { ps: Row[]; orders: { atSec: number; target: 'all' | 'left' | 'center' | 'right'; kind: 'charge' | 'brace' | 'retreat' }[] }> = {
    // 10×12 の盤で探し直した（sim star 1-2 --rand 2。見本から。2026-11-22）。盾兵3で騎兵の3列を受け、歩兵は両端と後ろ。置く順の4通りすべてで 20/20
    '1-2': { ps: [['hq', 7, 9, 'hold'], ['shield', 4, 8, 'hold'], ['shield', 5, 8, 'hold'], ['shield', 6, 8, 'hold'], ['infantry', 1, 9, 'advance'], ['infantry', 2, 11, 'advance'], ['infantry', 8, 8, 'advance'], ['infantry', 8, 9, 'advance'], ['infantry', 3, 10, 'advance']], orders: [] },
    // 10×12 の盤で探し直した（sim star 1-3 --rand 1。2026-11-22）。盾兵3の後ろに弓兵4を2行に重ね、本陣は盾兵の左の後ろ、歩兵2は左の端の後ろ。
    // 置く順の4通りすべてで 20/20
    '1-3': { ps: [['hq', 3, 9, 'hold'], ['shield', 3, 8, 'hold'], ['shield', 4, 8, 'hold'], ['shield', 5, 8, 'hold'], ['archer', 4, 10, 'advance'], ['archer', 4, 9, 'advance'], ['archer', 5, 9, 'advance'], ['archer', 5, 10, 'advance'], ['infantry', 1, 11, 'advance'], ['infantry', 1, 10, 'advance']], orders: [] },
    // 10×12 の盤で探し直した（sim star 1-4 --rand 3。見本から。2026-11-22）。正面は守備、騎兵3は右の端から回り込み、歩兵1つも迂回。
    // 置く順の4通りすべてで 20/20
    '1-4': { ps: [['hq', 4, 11, 'advance'], ['shield', 2, 9, 'hold'], ['shield', 3, 9, 'hold'], ['infantry', 1, 9, 'hold'], ['infantry', 5, 9, 'flank'], ['infantry', 4, 9, 'hold'], ['archer', 6, 11, 'advance'], ['archer', 5, 10, 'hold'], ['cavalry', 7, 8, 'flank'], ['cavalry', 8, 8, 'flank'], ['cavalry', 7, 9, 'flank']], orders: [] },
    // 10×12 の盤で探し直した（見本を山登りで探した中の1つ。2026-11-22）。歩兵3を横に並べて中央へ、8秒に全軍堅守、27秒に左翼突撃、35秒に全軍後退
    '1-5': { ps: [['hq', 8, 11, 'hold'], ['infantry', 2, 11, 'flank'], ['infantry', 3, 9, 'advance'], ['infantry', 4, 9, 'advance'], ['infantry', 5, 9, 'advance'], ['shield', 2, 9, 'advance'], ['shield', 5, 8, 'advance'], ['archer', 5, 10, 'hold'], ['archer', 4, 10, 'advance'], ['cavalry', 2, 10, 'advance'], ['cavalry', 4, 8, 'flank']], orders: [{ atSec: 8, target: 'all', kind: 'brace' }, { atSec: 27, target: 'left', kind: 'charge' }, { atSec: 35, target: 'all', kind: 'retreat' }] },
  };
  for (const [id, f] of Object.entries(FOUND)) {
    it(`${id}：見つけた配置で、種20個のうち10個以上で星3つ`, () => {
      const s = STAGES.find((x) => x.id === id)!;
      const ps: Placement[] = f.ps.map(([kind, col, row, stance]) => ({ kind, col, row, stance }));
      expect(validateStageArmy(s, ps)).toEqual([]);
      // 置く順だけを変えても、10個以上で星3つ
      for (const order of [{ name: 'そのまま', apply: <T,>(a: T[]): T[] => a }, ...ORDER_PERMS]) {
        let three = 0;
        for (const seed of STAGE_SEEDS) if (starsFor(summarize(runStage(s, order.apply(ps), seed, undefined, f.orders)), 0) === 3) three++;
        expect(three, order.name).toBeGreaterThanOrEqual(10);
      }
    }, 600_000);
  }
});
