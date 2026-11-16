// 第2章・第3章の10面（design §3.8「第2章・第3章の面」、§3.10）
import { describe, expect, it } from 'vitest';
import { createBattle, KIND_STATS, MAX_UNITS, STAGES, stageEnemyVisible, stageLineArmy, stageSetup, starsFor, summarize, validateStageArmy, type Placement, type Stage } from '../src/index.ts';
import { lineStats, ORDER_PERMS, runStage, solutionStats, STAGE_SEEDS, stageStats, templateWins } from '../sim/stagelib.ts';

const LATER = STAGES.filter((s) => s.chapter !== 1);
const byId = (id: string): Stage => STAGES.find((s) => s.id === id)!;
const menOf = (ps: Placement[]): number => ps.reduce((a, p) => a + KIND_STATS[p.kind as keyof typeof KIND_STATS].men, 0);

describe('第2章・第3章の面の作り', () => {
  it('id は 2-1〜2-5・3-1〜3-5。方針・ひな形・号令は、すべて使える', () => {
    expect(LATER.map((s) => s.id)).toEqual(['2-1', '2-2', '2-3', '2-4', '2-5', '3-1', '3-2', '3-3', '3-4', '3-5']);
    for (const s of LATER) expect(s.allow, s.id).toBeUndefined();
  });
  it('敵・見本・横陣が、面の検査と createBattle を通る。部隊数は両軍とも本陣を含めて16まで。ヒントは1行（24字まで）', () => {
    for (const s of LATER) {
      expect(validateStageArmy(s, s.solution), `${s.id} の見本`).toEqual([]);
      expect(validateStageArmy(s, stageLineArmy(s)), `${s.id} の横陣`).toEqual([]);
      expect(createBattle(stageSetup(s, s.solution, 1)).ok, s.id).toBe(true);
      expect(s.enemy.length).toBeLessThanOrEqual(MAX_UNITS);
      expect(s.enemy.filter((p) => p.kind === 'hq').length).toBe(1);
      expect(s.hint.length).toBeGreaterThan(5);
      expect(s.hint.length).toBeLessThanOrEqual(24);
    }
  });
  it('戦場の幅は 6〜12。2-4 は幅 6（谷の狭い道）', () => {
    for (const s of LATER) {
      expect(s.field.width).toBeGreaterThanOrEqual(6);
      expect(s.field.width).toBeLessThanOrEqual(12);
      expect(s.field.height).toBe(16);
    }
    expect(byId('2-4').field.width).toBe(6);
  });
  it('地形：2-1 丘、2-2 森、2-3 川、2-5 丘・森・川、3-1 柵、3-2 城壁と門、3-4 丘と柵、3-5 丘・森・川・柵', () => {
    const has = (id: string, t: string): boolean => byId(id).field.terrain.includes(t as never);
    expect(has('2-1', 'hill')).toBe(true);
    expect(has('2-2', 'forest')).toBe(true);
    expect(has('2-3', 'river')).toBe(true);
    for (const t of ['hill', 'forest', 'river']) expect(has('2-5', t), t).toBe(true);
    expect(has('3-1', 'fence')).toBe(true);
    expect(has('3-2', 'wall')).toBe(true);
    for (const t of ['hill', 'fence']) expect(has('3-4', t), t).toBe(true);
    for (const t of ['hill', 'forest', 'river', 'fence']) expect(has('3-5', t), t).toBe(true);
  });
  it('兵数の比（本陣を含めた開戦時の兵数の合計）：2-1・2-3 は敵が多い、2-4 は倍、2-5 は 1.5 倍、3-4 は倍以上', () => {
    const ratio = (id: string): number => menOf(byId(id).enemy) / menOf(byId(id).solution);
    expect(ratio('2-1')).toBeGreaterThan(1.1);
    expect(ratio('2-3')).toBeGreaterThan(1.1);
    expect(ratio('2-4')).toBeGreaterThanOrEqual(2);
    expect(ratio('2-5')).toBeGreaterThanOrEqual(1.5);
    expect(ratio('3-4')).toBeGreaterThanOrEqual(2);
    // 見本は手持ちを使い切る（比が手持ち全体の比になるように）
    for (const id of ['2-1', '2-3', '2-4', '2-5', '3-4']) {
      const s = byId(id);
      expect(s.solution.length, id).toBe(Object.values(s.roster).reduce((a, b) => a + (b ?? 0), 0));
    }
    expect(byId('3-4').solution.length).toBe(8);
  });
  it('3-1・3-4 は survive（120 秒・90 秒）、3-2 は gate、ほかは defeat', () => {
    expect(byId('3-1').win).toEqual({ type: 'survive' });
    expect(byId('3-1').seconds).toBe(120);
    expect(byId('3-4').win).toEqual({ type: 'survive' });
    expect(byId('3-4').seconds).toBe(90);
    expect(byId('3-2').win).toEqual({ type: 'gate' });
    expect(byId('3-2').gate).toBeDefined();
    for (const id of ['2-1', '2-2', '2-3', '2-4', '2-5', '3-3', '3-5']) expect(byId(id).win.type, id).toBe('defeat');
  });
  it('2-2・3-5 は霧を使う。霧の中にいるのは騎兵だけで、見えている敵に騎兵はいない（霧の中に何がいそうかを推し量れる）', () => {
    for (const id of ['2-2', '3-5']) {
      const s = byId(id);
      expect(s.fog?.length, id).toBeGreaterThan(0);
      const visible = stageEnemyVisible(s);
      expect(visible.length).toBeLessThan(s.enemy.length);
      expect(visible.some((e) => e.kind === 'cavalry'), id).toBe(false);
      const fog = new Set(s.fog!.map((c) => `${c.col},${c.row}`));
      for (const e of s.enemy.filter((p) => fog.has(`${p.col},${p.row}`))) expect(e.kind).toBe('cavalry');
    }
  });
  it('2-5 と 3-5 は敵が号令を出す（3-5 は3回）', () => {
    expect(byId('2-5').enemyOrders?.length).toBeGreaterThan(0);
    expect(byId('3-5').enemyOrders?.length).toBe(3);
  });
});

describe('第2章・第3章の面の手ごたえ', () => {
  for (const s of LATER) {
    it(`${s.id} ${s.name}：見本が種20個のうち18個以上で勝ち、星の平均が2以上`, () => {
      const r = solutionStats(s);
      expect(r.wins).toBeGreaterThanOrEqual(18);
      expect(r.starsMean).toBeGreaterThanOrEqual(2);
    }, 300_000);
    it(`${s.id}：横陣のひな形をそのまま置いただけでは、10個以下しか勝てない`, () => {
      expect(lineStats(s).wins).toBeLessThanOrEqual(10);
    }, 300_000);
    it(`${s.id}：7つのひな形をそのまま置いたとき、10個より多く勝つひな形は2つ以下`, () => {
      const rows = templateWins(s);
      expect(rows.filter((r) => r.wins > 10).length, JSON.stringify(rows)).toBeLessThanOrEqual(2);
    }, 600_000);
  }
  it('3-2：見本の勝ちのうち、門を破った勝ち（理由が gate）が半分以上', () => {
    const s = byId('3-2');
    let wins = 0;
    let gate = 0;
    for (const seed of STAGE_SEEDS) {
      const sm = summarize(runStage(s, s.solution, seed, undefined, s.solutionOrders ?? []));
      if (sm.winner !== 0) continue;
      wins++;
      if (sm.reason === 'gate') gate++;
    }
    expect(gate * 2).toBeGreaterThanOrEqual(wins);
  }, 300_000);
});

describe('置く順だけを変えても、勝ち負けが変わらない（全15面）', () => {
  // 画面は置いた順に id を振る。同点を id で割る決まりがあるので、見本が置く順に頼って勝っていないことを確かめる
  for (const s of STAGES) {
    it(`${s.id}：見本を並べ替えても（${ORDER_PERMS.map((p) => p.name).join('・')}）、種20個のうち18個以上で勝つ`, () => {
      for (const p of ORDER_PERMS) expect(stageStats(s, p.apply(s.solution), STAGE_SEEDS, s.solutionOrders ?? []).wins, p.name).toBeGreaterThanOrEqual(18);
    }, 300_000);
  }
});

describe('星3つは取れる（第2章・第3章）', () => {
  // 見本を出発点に、部隊の位置・方針・号令を少しずつ変えて探した配置。Stage には入れない。[兵種, 列, 行, 方針]
  type Row = [Placement['kind'], number, number, Placement['stance']];
  type Ord = { atSec: number; target: 'all' | 'left' | 'center' | 'right'; kind: 'charge' | 'brace' | 'retreat' };
  const FOUND: Record<string, { ps: Row[]; orders: Ord[] }> = {
    // 探索
    '2-1': { ps: [['hq', 6, 10, 'hold'], ['infantry', 7, 10, 'hold'], ['infantry', 1, 10, 'hold'], ['infantry', 2, 10, 'hold'], ['infantry', 4, 10, 'hold'], ['infantry', 2, 15, 'hunt'], ['infantry', 0, 10, 'hold'], ['shield', 3, 10, 'hold'], ['shield', 5, 10, 'hold'], ['archer', 1, 12, 'hold'], ['archer', 5, 11, 'hold']], orders: [{ atSec: 24, target: 'all', kind: 'brace' }, { atSec: 30, target: 'right', kind: 'charge' }, { atSec: 37, target: 'all', kind: 'brace' }] },
    // 探索
    '2-2': { ps: [['hq', 5, 15, 'hold'], ['infantry', 6, 10, 'hold'], ['infantry', 1, 11, 'hold'], ['infantry', 5, 10, 'hold'], ['infantry', 10, 10, 'hold'], ['infantry', 4, 10, 'hold'], ['infantry', 8, 10, 'hunt'], ['shield', 11, 13, 'hold'], ['shield', 0, 13, 'hold'], ['shield', 3, 10, 'hold'], ['archer', 4, 11, 'hold'], ['archer', 6, 11, 'advance'], ['archer', 5, 11, 'advance']], orders: [{ atSec: 10, target: 'left', kind: 'brace' }, { atSec: 23, target: 'all', kind: 'brace' }, { atSec: 26, target: 'right', kind: 'charge' }] },
    // 見本そのまま
    '2-3': { ps: [['hq', 5, 14, 'hold'], ['infantry', 2, 10, 'hold'], ['infantry', 3, 10, 'hold'], ['infantry', 4, 10, 'hold'], ['infantry', 7, 10, 'hold'], ['infantry', 8, 10, 'hold'], ['infantry', 9, 10, 'hold'], ['shield', 5, 10, 'hold'], ['shield', 6, 10, 'hold'], ['archer', 4, 11, 'hold'], ['archer', 5, 11, 'hold'], ['archer', 6, 11, 'hold']], orders: [] },
    // 探索
    '2-5': { ps: [['hq', 8, 10, 'hold'], ['infantry', 7, 10, 'hold'], ['infantry', 11, 10, 'hold'], ['infantry', 4, 11, 'flank'], ['infantry', 0, 10, 'hold'], ['shield', 5, 10, 'hold'], ['shield', 6, 10, 'hold'], ['archer', 3, 12, 'hunt'], ['archer', 4, 13, 'hold'], ['cavalry', 8, 13, 'flank'], ['cavalry', 4, 10, 'hold']], orders: [{ atSec: 10, target: 'all', kind: 'brace' }, { atSec: 16, target: 'center', kind: 'brace' }, { atSec: 23, target: 'all', kind: 'charge' }] },
    // 探索
    '3-1': { ps: [['hq', 3, 10, 'hold'], ['infantry', 9, 10, 'hold'], ['infantry', 9, 12, 'hold'], ['infantry', 5, 10, 'hold'], ['infantry', 7, 10, 'hold'], ['infantry', 8, 10, 'hold'], ['infantry', 2, 10, 'hold'], ['shield', 4, 10, 'hold'], ['shield', 1, 11, 'hold'], ['shield', 6, 10, 'hold'], ['shield', 10, 11, 'hold'], ['archer', 6, 11, 'hold'], ['archer', 5, 11, 'hunt']], orders: [{ atSec: 22, target: 'all', kind: 'brace' }, { atSec: 28, target: 'right', kind: 'charge' }, { atSec: 58, target: 'all', kind: 'brace' }] },
    // 探索（鶴翼のひな形から。置く順を変えても星3つ）
    '3-3': { ps: [['hq', 5, 15, 'hold'], ['shield', 5, 12, 'hold'], ['shield', 6, 12, 'hold'], ['shield', 4, 12, 'hold'], ['shield', 8, 11, 'hold'], ['archer', 3, 13, 'hunt'], ['archer', 6, 13, 'advance'], ['infantry', 3, 10, 'advance'], ['infantry', 9, 10, 'advance'], ['infantry', 10, 10, 'advance'], ['cavalry', 0, 10, 'flank'], ['infantry', 1, 10, 'advance'], ['infantry', 2, 11, 'advance'], ['infantry', 8, 12, 'advance'], ['cavalry', 11, 13, 'flank']], orders: [{ atSec: 5, target: 'left', kind: 'retreat' }, { atSec: 38, target: 'right', kind: 'charge' }] },
    // 探索（手持ちを直したあと。置く順を変えても12個以上で星3つ）
    '3-4': { ps: [['hq', 1, 10, 'hold'], ['shield', 6, 10, 'hold'], ['shield', 3, 10, 'hold'], ['shield', 4, 10, 'hold'], ['shield', 0, 10, 'hold'], ['shield', 5, 10, 'hold'], ['infantry', 2, 10, 'hold'], ['infantry', 5, 11, 'flank']], orders: [{ atSec: 5, target: 'all', kind: 'brace' }, { atSec: 27, target: 'all', kind: 'brace' }, { atSec: 51, target: 'all', kind: 'brace' }] },
    // 探索（置く順を変えても星3つ）
    '3-5': { ps: [['hq', 5, 10, 'hold'], ['shield', 9, 10, 'hold'], ['shield', 6, 10, 'hold'], ['infantry', 10, 12, 'hold'], ['infantry', 10, 10, 'hold'], ['infantry', 6, 11, 'hold'], ['infantry', 10, 13, 'flank'], ['archer', 7, 11, 'advance'], ['archer', 5, 11, 'hold'], ['archer', 4, 11, 'hold'], ['shield', 4, 10, 'hold'], ['infantry', 0, 12, 'flank'], ['cavalry', 0, 11, 'flank'], ['cavalry', 3, 10, 'flank'], ['cavalry', 1, 12, 'flank']], orders: [{ atSec: 8, target: 'right', kind: 'brace' }, { atSec: 22, target: 'right', kind: 'brace' }, { atSec: 41, target: 'all', kind: 'brace' }] },
  };
  for (const [id, f] of Object.entries(FOUND)) {
    it(`${id}：見つけた配置で、種20個のうち10個以上で星3つ`, () => {
      const s = byId(id);
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
