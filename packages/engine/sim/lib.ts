// 調整用の道具と、合格条件のテストで共有する場面の組み立て。
// 公開の API ではない（client から使わない）。

import {
  applyTemplate,
  createBattle,
  listTemplates,
  plainField,
  STANDARD_ROSTER,
  step,
  summarize,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type OrderInput,
  type Placement,
  type Side,
  type TemplateId,
} from '../src/index.ts';

export const TEMPLATE_IDS: TemplateId[] = listTemplates().map((t) => t.id);

/** 場面ごとの種（40個）と、総当たりの種（1組につき10個）。固定の一覧 */
export const SEEDS_40: number[] = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);
export const SEEDS_100: number[] = Array.from({ length: 100 }, (_, i) => 1000 + i * 7919);
export const SEEDS_10: number[] = Array.from({ length: 10 }, (_, i) => 1 + i * 104729);

export function templateArmy(id: TemplateId, side: Side): Placement[] {
  const field = plainField();
  return applyTemplate(id, STANDARD_ROSTER, field.zones[side], side);
}

export function matchupSetup(a: TemplateId, b: TemplateId, seed: number): BattleSetup {
  return {
    field: plainField(),
    armies: [templateArmy(a, 0), templateArmy(b, 1)],
    seed,
    maxTicks: 1800,
    timeout: 'compare',
  };
}

export interface RunResult {
  state: BattleState;
  events: BattleEvent[];
}

export interface RunOptions {
  /** 刻みごとに出す号令 */
  orders?: (state: BattleState) => OrderInput[];
  /** step のあとに呼ぶ（不変条件の確かめなど） */
  onTick?: (state: BattleState, events: BattleEvent[]) => void;
  /** これを返したら止める */
  stopWhen?: (state: BattleState) => boolean;
}

export function runSetup(setup: BattleSetup, opts: RunOptions = {}): RunResult {
  const created = createBattle(setup);
  if (!created.ok) throw new Error(`createBattle に失敗: ${created.error.message} ${JSON.stringify(created.error.armyErrors ?? [])}`);
  return runState(created.value, opts);
}

export function runState(state: BattleState, opts: RunOptions = {}): RunResult {
  const events: BattleEvent[] = [];
  while (!state.outcome) {
    if (opts.stopWhen?.(state)) break;
    const ev = step(state, opts.orders ? opts.orders(state) : []);
    for (const e of ev) events.push(e);
    opts.onTick?.(state, ev);
  }
  return { state, events };
}

/** 陣営0から見た点（勝ち 1、引き分け 0.5、負け 0） */
export function scoreFor(state: BattleState, side: Side): number {
  const w = state.outcome?.winner;
  if (w === undefined) return 0.5;
  if (w === 'draw') return 0.5;
  return w === side ? 1 : 0;
}

export interface MatrixGame {
  a: TemplateId;
  b: TemplateId;
  seed: number;
  winner: Side | 'draw';
  reason: string;
  seconds: number;
}

export function runMatrix(seeds: number[] = SEEDS_10, onTick?: (state: BattleState, events: BattleEvent[]) => void): MatrixGame[] {
  const games: MatrixGame[] = [];
  for (const a of TEMPLATE_IDS) {
    for (const b of TEMPLATE_IDS) {
      if (a === b) continue;
      for (const seed of seeds) {
        const { state } = runSetup(matchupSetup(a, b, seed), onTick ? { onTick } : {});
        const s = summarize(state);
        games.push({ a, b, seed, winner: s.winner, reason: s.reason, seconds: s.seconds });
      }
    }
  }
  return games;
}

export interface MatrixStats {
  /** pair[x][y] = ひな形 x の、ひな形 y に対する得点率（陣営の入れ替えと種をならした値） */
  pair: Record<string, Record<string, number>>;
  overall: Record<string, number>;
  /** 決着（本陣・壊滅・門）した戦いの長さの中央値。時間切れと膠着は含めない */
  medianDecided: number;
  /** 決着（本陣・壊滅・門）の割合 */
  decidedRate: number;
  timeoutRate: number;
  /** 方円を含まない組の時間切れの割合 */
  timeoutRateNoRing: number;
  /** 膠着（§3.6.4）の割合 */
  stalemateRate: number;
  /** 方円を含まない組の膠着の割合 */
  stalemateRateNoRing: number;
  drawRate: number;
  hqRate: number;
  total: number;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export function matrixStats(games: MatrixGame[]): MatrixStats {
  const pts: Record<string, Record<string, number[]>> = {};
  for (const x of TEMPLATE_IDS) {
    pts[x] = {};
    for (const y of TEMPLATE_IDS) (pts[x] as Record<string, number[]>)[y] = [];
  }
  for (const g of games) {
    const p0 = g.winner === 'draw' ? 0.5 : g.winner === 0 ? 1 : 0;
    (pts[g.a] as Record<string, number[]>)[g.b]?.push(p0);
    (pts[g.b] as Record<string, number[]>)[g.a]?.push(1 - p0);
  }
  const pair: Record<string, Record<string, number>> = {};
  const overall: Record<string, number> = {};
  for (const x of TEMPLATE_IDS) {
    pair[x] = {};
    const all: number[] = [];
    for (const y of TEMPLATE_IDS) {
      if (x === y) continue;
      const arr = (pts[x] as Record<string, number[]>)[y] as number[];
      (pair[x] as Record<string, number>)[y] = arr.reduce((s, v) => s + v, 0) / arr.length;
      all.push(...arr);
    }
    overall[x] = all.reduce((s, v) => s + v, 0) / all.length;
  }
  // 「決着」は本陣・壊滅・門。時間切れと膠着は分けて数え、長さの中央値に含めない
  const decided = games.filter((g) => g.reason !== 'timeout' && g.reason !== 'stalemate');
  const nr = games.filter((g) => g.a !== 'ring' && g.b !== 'ring');
  const rate = (gs: MatrixGame[], reason: string): number => gs.filter((g) => g.reason === reason).length / gs.length;
  return {
    pair,
    overall,
    medianDecided: median(decided.map((g) => g.seconds)),
    decidedRate: decided.length / games.length,
    timeoutRate: rate(games, 'timeout'),
    timeoutRateNoRing: rate(nr, 'timeout'),
    stalemateRate: rate(games, 'stalemate'),
    stalemateRateNoRing: rate(nr, 'stalemate'),
    drawRate: games.filter((g) => g.winner === 'draw').length / games.length,
    hqRate: games.filter((g) => g.reason === 'hq').length / games.length,
    total: games.length,
  };
}

export function formatMatrix(st: MatrixStats): string {
  const names: Record<string, string> = Object.fromEntries(listTemplates().map((t) => [t.id, t.name]));
  const lines: string[] = [];
  const head = ['        ', ...TEMPLATE_IDS.map((y) => y.padStart(9)), '   全体'].join('');
  lines.push('行のひな形の、列のひな形に対する得点率（陣営の入れ替えと種をならした値）');
  lines.push(head);
  for (const x of TEMPLATE_IDS) {
    const row = [x.padEnd(8)];
    for (const y of TEMPLATE_IDS) row.push(x === y ? '        -' : ((st.pair[x] as Record<string, number>)[y] as number).toFixed(2).padStart(9));
    row.push((st.overall[x] as number).toFixed(2).padStart(7));
    row.push(`  ${names[x] ?? ''}`);
    lines.push(row.join(''));
  }
  lines.push('');
  lines.push(`戦数 ${st.total}`);
  lines.push(`決着した戦いの長さの中央値 ${st.medianDecided.toFixed(1)} 秒`);
  lines.push(`決着 ${(st.decidedRate * 100).toFixed(1)}%  時間切れ ${(st.timeoutRate * 100).toFixed(1)}%（方円を含まない組 ${(st.timeoutRateNoRing * 100).toFixed(1)}%）  膠着 ${(st.stalemateRate * 100).toFixed(1)}%（方円を含まない組 ${(st.stalemateRateNoRing * 100).toFixed(1)}%）  引き分け ${(st.drawRate * 100).toFixed(1)}%  本陣での決着 ${(st.hqRate * 100).toFixed(1)}%`);
  return lines.join('\n');
}

const GLYPH: Record<string, string> = { infantry: 'i', shield: 's', cavalry: 'c', archer: 'a', hq: 'h', gate: 'g' };
/** 地形の文字：丘 ^、森 #、川 ~、柵 +、城壁 =（平地は .） */
const TERRAIN_GLYPH: Record<string, string> = { plain: '.', hill: '^', forest: '#', river: '~', fence: '+', wall: '=' };

/**
 * 盤面を文字で描く。1マスを横2文字で描く。陣営0は大文字、陣営1は小文字（門は G / g）。敗走中は '!'、同じ場所に2部隊以上は '*'。
 * 部隊のいないマスには地形の文字（平地 .、丘 ^、森 #、川 ~、柵 +、城壁 =）を描く。
 */
export function renderBoard(state: BattleState): string {
  const { width, height } = state.field;
  const W = width * 2;
  const grid: string[][] = Array.from({ length: height }, () => new Array<string>(W).fill('.'));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < W; x += 2) {
      const t = state.field.terrain[y * width + x / 2] ?? 'plain';
      const ch = TERRAIN_GLYPH[t] ?? '.';
      (grid[y] as string[])[x] = ch;
      (grid[y] as string[])[x + 1] = t === 'plain' ? ' ' : ch;
    }
  }
  for (const u of state.units) {
    if (u.status === 'gone') continue;
    const gx = Math.floor(u.x * 2);
    const gy = Math.floor(u.y);
    if (gx < 0 || gx >= W || gy < 0 || gy >= height) continue;
    const row = grid[gy] as string[];
    let ch = GLYPH[u.kind] ?? '?';
    if (u.side === 0) ch = ch.toUpperCase();
    if (u.status === 'routing') ch = '!';
    const cur = row[gx] as string;
    row[gx] = Object.values(TERRAIN_GLYPH).includes(cur) || cur === ' ' ? ch : '*';
  }
  return grid.map((r) => r.join('')).join('\n');
}

export function unitLine(state: BattleState, side: Side): string {
  const parts: string[] = [];
  for (const u of state.units) {
    if (u.side !== side) continue;
    const g = (GLYPH[u.kind] ?? '?')[side === 0 ? 'toUpperCase' : 'toLowerCase']();
    const st = u.status === 'active' ? '' : u.status === 'routing' ? '!' : 'x';
    parts.push(`${g}${u.id}:${Math.ceil(u.men)}/${Math.round(u.morale)}${st}`);
  }
  return parts.join(' ');
}
