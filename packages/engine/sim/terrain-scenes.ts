// 地形の場面（design §3.8 の T1〜T9）。テスト（test/acceptance/terrain.test.ts）と sim castle で共有する。
// 場面の作り方を自分で決めた箇所は、ここのコメントに書く。

import { plainField, type BattleSetup, type Field, type Placement, type Stance, type Terrain } from '../src/index.ts';

export function withTerrain(cells: [number, number, Terrain][], base: Field = plainField()): Field {
  const f: Field = { ...base, terrain: base.terrain.slice(), zones: [{ ...base.zones[0] }, { ...base.zones[1] }] };
  for (const [col, row, t] of cells) f.terrain[row * f.width + col] = t;
  return f;
}

/** 戦場全体を両陣営の配置エリアにした戦場（小さな場面で、近い位置から始めるため） */
export function openTerrainField(cells: [number, number, Terrain][]): Field {
  const f = withTerrain(cells);
  f.zones = [
    { col: 0, row: 0, width: f.width, height: f.height },
    { col: 0, row: 0, width: f.width, height: f.height },
  ];
  return f;
}

export const at = (kind: Placement['kind'], stance: Stance, cols: number[], row: number): Placement[] => cols.map((col) => ({ kind, stance, col, row }));

// ------------------------------------------------------------ T5・T8：城壁と門
// 12 × 16 の戦場。城壁は行 5（端から端まで）、切れ目は列 5 で、そこに陣営1の門。
// 陣営1（守る側）は城壁の内側（上）：本陣 (5,1)、歩兵2（守備）(4,3)・(6,3)。陣営1の配置エリアは行 0〜5（城壁の行を含む。城壁のマスには置けない）。
// 陣営0（攻める側）は標準の配置エリア（行 10〜15）：本陣 (5,14) 守備、歩兵4 (3..6, 10)、盾兵2 (4,11)・(6,11)。方針は場面ごとに変える。

export const CASTLE_WALL_ROW = 5;
export const CASTLE_GAP_COL = 5;

export function castleField(): Field {
  const cells: [number, number, Terrain][] = [];
  for (let c = 0; c < 12; c++) if (c !== CASTLE_GAP_COL) cells.push([c, CASTLE_WALL_ROW, 'wall']);
  return withTerrain(cells);
}

export function castleSetup(stance: Stance, seed: number, win = false): BattleSetup {
  return {
    field: castleField(),
    armies: [
      [{ kind: 'hq', stance: 'hold', col: 5, row: 14 }, ...at('infantry', stance, [3, 4, 5, 6], 10), ...at('shield', stance, [4, 6], 11)],
      [{ kind: 'hq', stance: 'hold', col: 5, row: 1 }, ...at('infantry', 'hold', [4, 6], 3)],
    ],
    seed,
    maxTicks: 1800,
    timeout: 'compare',
    gate: { side: 1, col: CASTLE_GAP_COL, row: CASTLE_WALL_ROW, win },
  };
}

// ------------------------------------------------------------ T1〜T4
// 共通：標準の 12 × 16 の戦場（配置エリアは標準）。requireHq: false。比べる2つの場面は、地形のほかを同じにする。
import { runSetup, scoreFor, SEEDS_40 } from './lib.ts';
import { createBattle, step, summarize, type BattleState } from '../src/index.ts';
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
function small(field: Field, a: Placement[], b: Placement[], seed: number): BattleSetup {
  return { field, armies: [a, b], seed, maxTicks: 1800, timeout: 'compare', requireHq: false };
}

/** T1：陣営1の歩兵3（守備）を行 5 の 4〜6 列に、陣営0の歩兵3（前進）を行 10 の 4〜6 列に置く。丘は守る側の3マスだけ（行 5）。
 *  攻める側は行 6（丘の外）で近接の距離に入るので、近接は攻める側が丘に上がる前に始まる。値は守る側（陣営1）の得点率 */
export function t1(hill: boolean, seeds = SEEDS_40): number {
  const field = hill ? withTerrain([[4, 5, 'hill'], [5, 5, 'hill'], [6, 5, 'hill']]) : plainField();
  return mean(seeds.map((s) => scoreFor(runSetup(small(field, at('infantry', 'advance', [4, 5, 6], 10), at('infantry', 'hold', [4, 5, 6], 5), s)).state, 1)));
}

/** T2：戦場全体を配置エリアにした戦場。陣営0の歩兵1（守備）を (5,8)（森のマス）に、それを正面から押さえる陣営1の歩兵1（守備）を (5,7) に、
 *  陣営1の騎兵2（前進）を盾の後ろ (4,13)・(6,13) に置く。値は、陣営0の歩兵が消える（敗走・全滅）までの刻みの中央値 */
export function t2(forest: boolean, seeds = SEEDS_40): number {
  const field = forest ? openTerrainField([[5, 8, 'forest']]) : openTerrainField([]);
  const ticks = seeds.map((s) => {
    const r = createBattle(small(field, [{ kind: 'infantry', stance: 'hold', col: 5, row: 8 }, { kind: 'infantry', stance: 'hold', col: 0, row: 15 }], [{ kind: 'infantry', stance: 'hold', col: 5, row: 7 }, ...at('cavalry', 'advance', [4, 6], 13)], s));
    if (!r.ok) throw new Error(r.error.message);
    const st = r.value;
    while (st.units[0]!.status === 'active' && st.tick < 1800 && !st.outcome) step(st, []);
    return st.tick;
  });
  return median(ticks);
}

/** T3：川は行 8・9（端から端まで）。陣営0の歩兵4（守備）を行 10 の 4〜7 列（川岸のすぐ手前）に、陣営1の歩兵4（前進）を行 5 の 4〜7 列に置く。
 *  攻める側は行 9（川の中）で近接の距離に入る。値は守る側（陣営0）の得点率 */
export function t3(river: boolean, seeds = SEEDS_40): number {
  const cells: [number, number, Terrain][] = [];
  if (river) for (const row of [8, 9]) for (let c = 0; c < 12; c++) cells.push([c, row, 'river']);
  const field = withTerrain(cells);
  return mean(seeds.map((s) => scoreFor(runSetup(small(field, at('infantry', 'hold', [4, 5, 6, 7], 10), at('infantry', 'advance', [4, 5, 6, 7], 5), s)).state, 0)));
}

/**
 * T4 の前半：幅 3 の戦場（谷のような狭い場所。§3.8 のとおり、戦場の幅そのものを狭くして表す）。両陣営とも戦場全体を配置エリアにする。
 * 柵は行 10 の3マス（幅いっぱい）。陣営0の歩兵3（守備）をその柵のマスに、陣営1の歩兵5（前進）を行 5 に3つ・行 4 に2つ置く。
 * 幅 12 の戦場では、5部隊のうち2部隊が列の端から回り込み、守る側の端の部隊に 52°ほど（側面）から当たる。柵の効果は正面（50°以内）
 * からだけなので、「正面から攻める歩兵5」を作るために、回り込めない幅にした。値は柵の側（陣営0）の得点率。
 * 騎兵を足す後半は、回り込める幅の戦場で比べる（t4Cav）。cav に front・rear を渡すと t4Cav の得点率を返す
 */
export function t4(fence: boolean, cav: 'none' | 'front' | 'rear', seeds = SEEDS_40): number {
  if (cav !== 'none') return t4Cav(cav, seeds).score;
  const W = 3;
  const field = plainField(W);
  field.zones = [
    { col: 0, row: 0, width: W, height: 16 },
    { col: 0, row: 0, width: W, height: 16 },
  ];
  if (fence) for (let c = 0; c < W; c++) field.terrain[10 * W + c] = 'fence';
  const atk = [...at('infantry', 'advance', [0, 1, 2], 5), ...at('infantry', 'advance', [0, 2], 4)];
  return mean(seeds.map((sd) => scoreFor(runSetup(small(field, at('infantry', 'hold', [0, 1, 2], 10), atk, sd)).state, 0)));
}

/** T4 の後半の戦場の幅 */
export const T4_CAV_WIDTH = 8;

/**
 * T4 の後半：幅 8 の戦場（両陣営とも戦場全体を配置エリアにする）。柵は行 10 の列 2〜5。陣営0の歩兵4（守備）をその柵のマスに、
 * 陣営1の歩兵3（前進）を行 5 の列 2・3・5 に置く（正面から当たって、守る側と組み合う）。そこへ騎兵2を足す：
 * - front：騎兵2（前進）を行 7 の列 2・5（守る側の正面の先）に置く。歩兵より先に、柵の正面から当たる
 * - rear：騎兵2（迂回）を行 2 の両端（列 0・7）に置く。端の列を下りて守る側の後ろへ回り込み、正面の歩兵と組み合っている守る側に、背面から当たる
 * 返す値：柵の側（陣営0）の得点率、1戦あたりの突入の出来事の数、そのうち「当てられた側が正面の歩兵と戦っている」ものの数、
 * 騎兵の与えた損害のうち、側面・背面から（当てられた側の向きから 50° より外）の割合。向きは刻みの終わりの位置と向きで見る
 */
export function t4Cav(cav: 'front' | 'rear', seeds = SEEDS_40): { score: number; impacts: number; pinnedImpacts: number; sideRearShare: number } {
  const W = T4_CAV_WIDTH;
  const field = plainField(W);
  field.zones = [
    { col: 0, row: 0, width: W, height: 16 },
    { col: 0, row: 0, width: W, height: 16 },
  ];
  const def = [2, 3, 4, 5];
  for (const c of def) field.terrain[10 * W + c] = 'fence';
  const cavs = cav === 'front' ? at('cavalry', 'advance', [2, 5], 7) : at('cavalry', 'flank', [0, 7], 2);
  let score = 0;
  let impacts = 0;
  let pinned = 0;
  let sideRear = 0;
  let all = 0;
  for (const sd of seeds) {
    const r = createBattle(small(field, at('infantry', 'hold', def, 10), [...at('infantry', 'advance', [2, 3, 5], 5), ...cavs], sd));
    if (!r.ok) throw new Error(r.error.message);
    const s = r.value;
    const cavIds = s.units.filter((u) => u.kind === 'cavalry').map((u) => u.id);
    while (!s.outcome) {
      const before = cavIds.map((id) => s.units[id]!.stats.dealt);
      const ev = step(s, []);
      for (const e of ev) {
        if (e.type !== 'impact') continue;
        impacts++;
        const d = s.units[e.defender]!;
        const t = d.attacking === null ? null : s.units[d.attacking];
        if (t && t.kind === 'infantry') pinned++;
      }
      cavIds.forEach((id, k) => {
        const u = s.units[id]!;
        const dealt = u.stats.dealt - (before[k] as number);
        if (dealt <= 0 || u.attacking === null) return;
        const t = s.units[u.attacking]!;
        const vx = u.x - t.x;
        const vy = u.y - t.y;
        const L = Math.hypot(vx, vy) || 1;
        const ang = (Math.acos(Math.max(-1, Math.min(1, (vx * t.fx + vy * t.fy) / L))) * 180) / Math.PI;
        all += dealt;
        if (ang > 50) sideRear += dealt;
      });
    }
    score += scoreFor(s, 0);
  }
  const n = seeds.length;
  return { score: score / n, impacts: impacts / n, pinnedImpacts: pinned / n, sideRearShare: all > 0 ? sideRear / all : 0 };
}

export { summarize };
export type { BattleState };
