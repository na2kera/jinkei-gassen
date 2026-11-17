// 面 1-2 の条件（design §3.10「1-2 の作り直し」）を確かめるための、配置の標本と実測。テストと調整の両方で使う。
import { nextFloat, rngFromSeed } from '../src/rng.ts';
import { stageLineArmy, summarize, type BattleState, type Placement, type Stage } from '../src/index.ts';
import { runStage, STAGE_SEEDS } from './stagelib.ts';

/** 敵の騎兵のいる列（小さい順） */
export function cavalryCols(stage: Stage): number[] {
  return [...new Set(stage.enemy.filter((p) => p.kind === 'cavalry').map((p) => p.col))].sort((a, b) => a - b);
}

/** 列 col の、いちばん前（行がいちばん小さい）の部隊。いなければ undefined */
function frontOf(ps: Placement[], col: number): Placement | undefined {
  let best: Placement | undefined;
  for (const p of ps) if (p.col === col && (!best || p.row < best.row)) best = p;
  return best;
}

/** 受けている配置：騎兵のいる列のすべてで、いちばん前の部隊が盾兵 */
export function isGuarded(ps: Placement[], cols: number[]): boolean {
  return cols.every((c) => frontOf(ps, c)?.kind === 'shield');
}

/** 受けていない配置：騎兵のいる列のどれでも、いちばん前の部隊が盾兵でない（誰もいない列を含む） */
export function isUnguarded(ps: Placement[], cols: number[]): boolean {
  return cols.every((c) => frontOf(ps, c)?.kind !== 'shield');
}

/** 種 seed の乱数（engine の rng.ts の作り）で、配列 a から1つ選ぶ道具 */
function picker(seed: number): <T>(a: T[]) => T {
  let st = rngFromSeed(seed);
  return <T>(a: T[]): T => {
    const [v, next] = nextFloat(st);
    st = next;
    return a[Math.floor(v * a.length)] as T;
  };
}

/**
 * 標本の配置を作る（design §3.10 の「標本の作り方」）。手持ちの9部隊（本陣1・盾兵3・歩兵5）をすべて置き、方針は兵種の初期設定。
 * 種は 1 から順に使い、受けていない配置は、決まりを満たさなければ捨てて次の種で作り直す。配列の順は、本陣、盾兵（列の小さい順）、歩兵（引いた順）。
 * マスは、行の小さい順、同じ行では列の小さい順に並べてから選ぶ。
 */
export function stage12Samples(stage: Stage, kind: 'guarded' | 'unguarded', n = 40): Placement[][] {
  const z = stage.field.zones[0];
  const cols = cavalryCols(stage);
  const cells: { col: number; row: number }[] = [];
  for (let row = z.row; row < z.row + z.height; row++) for (let col = z.col; col < z.col + z.width; col++) cells.push({ col, row });
  const out: Placement[][] = [];
  for (let seed = 1; out.length < n; seed++) {
    const pick = picker(seed);
    const used = new Set<string>();
    const key = (c: { col: number; row: number }): string => `${c.col},${c.row}`;
    const free = (extra: (c: { col: number; row: number }) => boolean = () => true): { col: number; row: number }[] => cells.filter((c) => !used.has(key(c)) && extra(c));
    const take = (c: { col: number; row: number }): { col: number; row: number } => {
      used.add(key(c));
      return c;
    };
    let shields: { col: number; row: number }[];
    let hq: { col: number; row: number };
    const inf: { col: number; row: number }[] = [];
    if (kind === 'guarded') {
      // 盾兵3を騎兵の3列に1つずつ。行は 10 か 11。行 11 に置いた列の行 10 は空ける（盾兵の前には置かない）
      const front = new Set<string>();
      shields = cols.map((col) => {
        const row = pick([10, 11]);
        if (row === 11) front.add(`${col},10`);
        return take({ col, row });
      });
      hq = take(pick(free((c) => c.row >= 13 && c.row <= 15)));
      for (let i = 0; i < 5; i++) inf.push(take(pick(free((c) => !front.has(key(c))))));
    } else {
      hq = take(pick(free((c) => c.row >= 13 && c.row <= 15)));
      shields = [];
      for (let i = 0; i < 3; i++) shields.push(take(pick(free())));
      for (let i = 0; i < 5; i++) inf.push(take(pick(free())));
    }
    const ps: Placement[] = [
      { kind: 'hq', stance: 'hold', ...hq },
      ...shields.slice().sort((a, b) => a.col - b.col || a.row - b.row).map((c) => ({ kind: 'shield' as const, stance: 'hold' as const, ...c })),
      ...inf.map((c) => ({ kind: 'infantry' as const, stance: 'advance' as const, ...c })),
    ];
    if (kind === 'unguarded' && !isUnguarded(ps, cols)) continue;
    out.push(ps);
  }
  return out;
}

export interface Probe12 {
  win: boolean;
  /** 時間切れか膠着（§3.6.4）で終わった */
  timeout: boolean;
  /** 最後に誰かが攻撃した刻みから、決着までの秒数 */
  deadTail: number;
  stars: number;
}

/** 1戦を流して、勝ち・時間切れ（膠着を含む）・最後の攻撃から決着までの秒数を見る */
export function probe12(stage: Stage, ps: Placement[], seed: number): Probe12 {
  let last = 0;
  const s: BattleState = runStage(stage, ps, seed, (st) => {
    if (st.units.some((u) => u.attacking !== null)) last = st.tick;
  });
  const sm = summarize(s);
  const rem = sm.remaining[0];
  const stars = sm.winner !== 0 ? 0 : rem >= 0.7 ? 3 : rem >= 0.5 ? 2 : 1;
  return { win: sm.winner === 0, timeout: s.outcome?.reason === 'timeout' || s.outcome?.reason === 'stalemate', deadTail: (s.tick - last) / 10, stars };
}

export interface Stage12Report {
  /** 受けている配置のうち、20戦で18勝以上の数 */
  guardedGood: number;
  guardedRate: number;
  unguardedRate: number;
  /** 時間切れか膠着で終わった戦い */
  timeouts: number;
  /** 最後の攻撃から決着までが 20 秒を超えた戦い */
  longTails: number;
  maxTail: number;
  lineWins: number;
  solutionWins: number;
  solutionStars: number;
}

/** §3.10 の条件 1〜4（星3つの配置を除く）の実測 */
export function stage12Report(stage: Stage, seeds = STAGE_SEEDS, samples = 40): Stage12Report {
  let timeouts = 0;
  let longTails = 0;
  let maxTail = 0;
  const run = (ps: Placement[]): Probe12[] =>
    seeds.map((seed) => {
      const p = probe12(stage, ps, seed);
      if (p.timeout) timeouts++;
      if (p.deadTail > 20) longTails++;
      maxTail = Math.max(maxTail, p.deadTail);
      return p;
    });
  const g = stage12Samples(stage, 'guarded', samples).map(run);
  const u = stage12Samples(stage, 'unguarded', samples).map(run);
  const line = run(stageLineArmy(stage));
  const sol = run(stage.solution);
  const rate = (rs: Probe12[][]): number => rs.flat().filter((p) => p.win).length / rs.flat().length;
  return {
    guardedGood: g.filter((rs) => rs.filter((p) => p.win).length >= Math.ceil(seeds.length * 0.9)).length,
    guardedRate: rate(g),
    unguardedRate: rate(u),
    timeouts,
    longTails,
    maxTail,
    lineWins: line.filter((p) => p.win).length,
    solutionWins: sol.filter((p) => p.win).length,
    solutionStars: sol.reduce((a, p) => a + p.stars, 0) / sol.length,
  };
}
