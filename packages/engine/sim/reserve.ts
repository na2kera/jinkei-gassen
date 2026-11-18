// 遊軍の強さの測定（design §7.9 の R13）。
//   pnpm sim reserve a [--jobs 8]      1人用：15 面の見本の配置から、本陣以外の1部隊を遊軍に回す（面の方針の制限を外した表も出す）
//   pnpm sim reserve b [--jobs 8]      対戦：ふるい（種 2・陣営0だけ）→ 上位を別の種 20 で測り直す → 両軍が同じ使い方・(c) 号令との組み合わせ（種 5）
//   pnpm sim reserve all               a と b の両方。--quick は道具を確かめるための小さな測定
// 結果は --out のディレクトリ（既定は .reserve-out）に JSON で書き、表を画面に出す。
//
// 比べる相手（対照）は、いつも「同じ配置で、その部隊を遊軍に回さず、そのまま置いたとき」。
// 速くするための工夫：遊軍を呼ぶまでの戦いは、方針・呼ぶ時刻・左右にかかわらず同じなので、
// 「予定された遊軍がまだ残っている」状態（膠着の時計が進まない。§7.5）で1回だけ流し、呼ぶ時刻ごとに状態を写して、そこから続ける。
// 写した状態に、予定（auto）と方針を書き入れて続けたものは、初めから scriptedReserves を書いて流したものと同じ（ふるいの初めに確かめる）。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  applyTemplate,
  createBattle,
  PVP_MAPS,
  PVP_RULES,
  pvpField,
  STAGES,
  stageSetupWith,
  stanceAllowedInStage,
  starsFor,
  step,
  summarize,
  defaultStance,
  type BattleSetup,
  type BattleState,
  type Field,
  type Kind,
  type OrderInput,
  type Placement,
  type PvpMapId,
  type ReserveFrom,
  type Side,
  type Stage,
  type Stance,
  type TemplateId,
} from '../src/index.ts';
import { TEMPLATE_IDS } from './lib.ts';
import { STAGE_SEEDS } from './stagelib.ts';

/** --quick：道具そのものを確かめるための小さな測定（ひな形2つ・地図1つ・種を減らす・面2つ）。数字には使わない */
const QUICK = process.argv.includes('--quick');
const TEMPLATES: TemplateId[] = QUICK ? ['line', 'crane'] : TEMPLATE_IDS;
const MAPS = QUICK ? PVP_MAPS.slice(0, 1) : PVP_MAPS;
const STAGE_LIST = QUICK ? STAGES.slice(4, 6) : STAGES;
const A_SEEDS = QUICK ? STAGE_SEEDS.slice(0, 2) : STAGE_SEEDS;
const KINDS: Kind[] = ['infantry', 'shield', 'cavalry', 'archer'];
const STANCES: Stance[] = ['advance', 'hold', 'flank', 'hunt'];
const FROMS: ReserveFrom[] = ['left', 'right'];
/** 呼ぶ時刻（秒）。呼ばない（null）は別に数える */
const TIMES_SEC = [5, 6, 8, 10, 15, 30, 60];
const TIMES = TIMES_SEC.map((s) => s * 10);
/** 予定された遊軍を「ずっと先」に置く刻み（呼ぶまでの共通の部分を流すため。戦いはそれより前に必ず終わる） */
const FAR = 1_000_000_000;
/**
 * ふるいの種と、測り直しの種（20 個。ふるいとは別）。設計（§7.9 の R13）は、ふるいを種 5・両方の陣営としていたが、
 * 1戦 0.05 秒ほどかかり、そのままでは 5 時間を超えるので、ふるいは種 2・遊軍を持つのは陣営0だけに絞る（戦場は上下・左右に対称）。
 * 測り直しは、設計どおり種 20・両方の陣営で測る
 */
const SCREEN_SEEDS = Array.from({ length: QUICK ? 1 : 2 }, (_, i) => 31 + i * 7919);
const SCREEN_SIDES: Side[] = [0];
const RECHECK_SEEDS = Array.from({ length: QUICK ? 2 : 20 }, (_, i) => 900_001 + i * 104_729);
const TOP = QUICK ? 3 : 30;
/** (c) と「両軍が同じ使い方」の種。時間を抑えるため、測り直しの種の初めの 5 個だけを使う（balance.md に書く） */
const ORDER_SEEDS = RECHECK_SEEDS.slice(0, QUICK ? 2 : 5);

type Pos = 'front' | 'back' | 'edge';
const POSES: Pos[] = ['front', 'back', 'edge'];

function make(setup: BattleSetup): BattleState {
  const r = createBattle(setup);
  if (!r.ok) throw new Error(`createBattle: ${r.error.message} ${JSON.stringify(r.error.armyErrors ?? [])}`);
  return r.value;
}

function runToEnd(s: BattleState, first?: OrderInput[]): BattleState {
  if (first && !s.outcome) step(s, first);
  while (!s.outcome) step(s, []);
  return s;
}

/** その陣営から見た点（勝ち 1、引き分け 0.5、負け 0） */
function score(s: BattleState, side: Side): number {
  const w = s.outcome?.winner;
  if (w === undefined || w === 'draw') return 0.5;
  return w === side ? 1 : 0;
}

const copy = <T>(v: T): T => structuredClone(v);

/**
 * 呼ぶまでの共通の部分を1回流し、呼ぶ時刻ごとに続けた結果を返す（遊軍を持つのは陣営 side）。
 * variants は、(方針, 左右, 呼ぶ時刻) の組。呼ぶ時刻より前に決着した戦いは、その決着をそのまま使う。
 * firstOrders があれば、呼ぶ刻みに、その陣営の号令として出す（(c) 用）。
 */
function branch<R>(
  setup: BattleSetup,
  side: Side,
  variants: { stance: Stance; from: ReserveFrom; tick: number }[],
  read: (s: BattleState) => R,
  firstOrders?: (from: ReserveFrom) => OrderInput[],
): R[] {
  const base = make({ ...setup, scriptedReserves: [{ tick: FAR, side, from: 'left' }] });
  const ticks = [...new Set(variants.map((v) => v.tick))].sort((a, b) => a - b);
  const snaps = new Map<number, BattleState>();
  for (const t of ticks) {
    while (!base.outcome && base.tick < t) step(base, []);
    snaps.set(t, copy(base));
  }
  return variants.map((v) => {
    const s = copy(snaps.get(v.tick) as BattleState);
    if (s.outcome) return read(s);
    const r = s.reserves[side];
    if (!r) throw new Error('遊軍がない');
    r.stance = v.stance;
    r.auto = { tick: v.tick, from: v.from };
    return read(runToEnd(s, firstOrders?.(v.from)));
  });
}

// ---------------------------------------------------------------- (a) 1人用

interface StageRow {
  stage: string;
  /** 抜いた部隊（見本の添字・兵種・マス） */
  unit: string;
  kind: Kind;
  stance: Stance | null;
  at: number | null;
  from: ReserveFrom | null;
  wins: number;
  stars: number;
  remaining: number;
  remainingForStars: number;
}

interface StageControl {
  stage: string;
  wins: number;
  stars: number;
  remaining: number;
}

function stageRows(st: Stage, free: boolean): { control: StageControl; rows: StageRow[] } {
  const seeds = A_SEEDS;
  const orders = st.solutionOrders ?? [];
  let cw = 0;
  let cs = 0;
  let cr = 0;
  for (const seed of seeds) {
    const sm = summarize(runToEnd(make(stageSetupWith(st, st.solution, seed, orders))));
    if (sm.winner === 0) cw++;
    cs += starsFor(sm, 0);
    cr += sm.remaining[0];
  }
  const control: StageControl = { stage: st.id, wins: cw, stars: cs / seeds.length, remaining: cr / seeds.length };
  const rows: StageRow[] = [];
  st.solution.forEach((u, idx) => {
    if (u.kind === 'hq') return;
    const rest = st.solution.filter((_, j) => j !== idx);
    const stances = STANCES.filter((x) => free || stanceAllowedInStage(st, u.kind, x));
    // 制限を外した表には、面で選べない方針だけを出す（選べるものは、ふつうの表と同じ数字になる）
    const list = free ? stances.filter((x) => !stanceAllowedInStage(st, u.kind, x)) : stances;
    if (list.length === 0) return;
    const label = `${idx}:${u.kind}(${u.col},${u.row})`;
    type Acc = { wins: number; stars: number; rem: number; remS: number };
    const acc = new Map<string, Acc>();
    const add = (key: string, s: BattleState): void => {
      const sm = summarize(s);
      const a = acc.get(key) ?? { wins: 0, stars: 0, rem: 0, remS: 0 };
      if (sm.winner === 0) a.wins++;
      a.stars += starsFor(sm, 0);
      a.rem += sm.remaining[0];
      a.remS += sm.remainingForStars[0];
      acc.set(key, a);
    };
    const variants = list.flatMap((stance) => FROMS.flatMap((from) => TIMES.map((tick) => ({ stance, from, tick }))));
    for (const seed of seeds) {
      // 呼ばない（方針は結果に効かないので、1つだけ）
      if (!free) add('none', runToEnd(make(stageSetupWith(st, rest, seed, orders, { kind: u.kind, stance: defaultStance(u.kind) }))));
      const setup = stageSetupWith(st, rest, seed, orders, { kind: u.kind, stance: list[0] as Stance });
      const res = branch(setup, 0, variants, (s) => s);
      res.forEach((s, i) => {
        const v = variants[i] as { stance: Stance; from: ReserveFrom; tick: number };
        add(`${v.stance}|${v.from}|${v.tick}`, s);
      });
    }
    for (const [key, a] of acc) {
      const n = seeds.length;
      const [stance, from, tick] = key === 'none' ? [null, null, null] : (key.split('|') as [Stance, ReserveFrom, string]);
      rows.push({ stage: st.id, unit: label, kind: u.kind, stance, at: tick === null ? null : Number(tick) / 10, from, wins: a.wins, stars: a.stars / n, remaining: a.rem / n, remainingForStars: a.remS / n });
    }
  });
  return { control, rows };
}

// ---------------------------------------------------------------- (b) 対戦

/** 対戦の予算（36）に収まる配置。標準の手持ちから騎兵を1つ減らした PVP_RULES.standardRoster（値段 36 ちょうど）をひな形で並べる */
export function pvpArmy(t: TemplateId, field: Field, side: Side): Placement[] {
  return applyTemplate(t, PVP_RULES.standardRoster, field.zones[side], side);
}

/**
 * 抜く部隊を選ぶ。前の列は敵にいちばん近い行、後ろの列はいちばん遠い行、端は中央の列からいちばん離れた列。
 * 同じなら、前と後ろは中央の列に近いほう、端は前の行。それも同じなら、その陣営から見て左
 */
export function pickUnit(army: Placement[], kind: Kind, pos: Pos, side: Side, width: number): number {
  const fwd = (p: Placement): number => (side === 0 ? -p.row : p.row); // 大きいほど前
  const off = (p: Placement): number => Math.abs(p.col + 0.5 - width / 2);
  const left = (p: Placement): number => (side === 0 ? -p.col : p.col); // 大きいほど左
  let best = -1;
  for (let i = 0; i < army.length; i++) {
    const p = army[i] as Placement;
    if (p.kind !== kind) continue;
    if (best < 0) {
      best = i;
      continue;
    }
    const b = army[best] as Placement;
    const key = (q: Placement): number[] => (pos === 'front' ? [fwd(q), -off(q), left(q)] : pos === 'back' ? [-fwd(q), -off(q), left(q)] : [off(q), fwd(q), left(q)]);
    const kp = key(p);
    const kb = key(b);
    for (let j = 0; j < kp.length; j++) {
      if ((kp[j] as number) > (kb[j] as number)) {
        best = i;
        break;
      }
      if ((kp[j] as number) < (kb[j] as number)) break;
    }
  }
  return best;
}

/** 使い方：どの部隊を抜くか（兵種と位置）× 方針 × 呼ぶ時刻（null は呼ばない）× 左右 */
interface Usage {
  kind: Kind;
  pos: Pos;
  stance: Stance | null;
  at: number | null;
  from: ReserveFrom | null;
}

export const usageKey = (u: Usage): string => `${u.kind}|${u.pos}|${u.stance ?? '-'}|${u.at ?? 'none'}|${u.from ?? '-'}`;
function parseUsage(k: string): Usage {
  const [kind, pos, stance, at, from] = k.split('|') as [Kind, Pos, string, string, string];
  return { kind, pos, stance: stance === '-' ? null : (stance as Stance), at: at === 'none' ? null : Number(at), from: from === '-' ? null : (from as ReserveFrom) };
}

/** 1つの「組（遊軍を持つひな形 h、相手 o、地図、持つ陣営、抜く兵種と位置、種）」の単位 */
interface Group {
  h: TemplateId;
  o: TemplateId;
  map: PvpMapId;
  side: Side;
  kind: Kind;
  pos: Pos;
  seed: number;
}

function groupSetup(g: Group, withReserve: boolean): { setup: BattleSetup; picked: Placement } {
  const f = pvpField(g.map);
  const mine = pvpArmy(g.h, f, g.side);
  const theirs = pvpArmy(g.o, f, (1 - g.side) as Side);
  const idx = pickUnit(mine, g.kind, g.pos, g.side, f.width);
  const picked = mine[idx] as Placement;
  const rest = withReserve ? mine.filter((_, j) => j !== idx) : mine;
  const armies = (g.side === 0 ? [rest, theirs] : [theirs, rest]) as [Placement[], Placement[]];
  const reserve = { kind: picked.kind, stance: picked.stance };
  return {
    setup: {
      field: f,
      armies,
      seed: g.seed,
      maxTicks: 1800,
      timeout: 'compare',
      ...(withReserve ? { reserves: (g.side === 0 ? [reserve, null] : [null, reserve]) as NonNullable<BattleSetup['reserves']> } : {}),
    },
    picked,
  };
}

/** 対照（遊軍に回さず、そのまま置いた戦い）。抜く部隊によらないので、組ごとに1回 */
function controlKey(h: TemplateId, o: TemplateId, map: PvpMapId, side: Side, seed: number, order = ''): string {
  return `${h}|${o}|${map}|${side}|${seed}|${order}`;
}

function controlScore(h: TemplateId, o: TemplateId, map: PvpMapId, side: Side, seed: number, orderAt?: { tick: number; order: OrderInput }): number {
  const { setup } = groupSetup({ h, o, map, side, kind: 'infantry', pos: 'front', seed }, false);
  const s = make(setup);
  if (orderAt) {
    while (!s.outcome && s.tick < orderAt.tick) step(s, []);
    runToEnd(s, [orderAt.order]);
  } else runToEnd(s);
  return score(s, side);
}

/** 1つの組で、使い方ごとの点（遊軍を持つ側から見た値）を返す */
function runGroup(g: Group, usages: Usage[]): Map<string, number> {
  const out = new Map<string, number>();
  const { setup } = groupSetup(g, true);
  const none = usages.filter((u) => u.at === null);
  if (none.length > 0) {
    const sc = score(runToEnd(make(setup)), g.side);
    for (const u of none) out.set(usageKey(u), sc);
  }
  const called = usages.filter((u) => u.at !== null);
  if (called.length > 0) {
    const variants = called.map((u) => ({ stance: u.stance as Stance, from: u.from as ReserveFrom, tick: (u.at as number) * 10 }));
    const res = branch(setup, g.side, variants, (s) => score(s, g.side));
    called.forEach((u, i) => out.set(usageKey(u), res[i] as number));
  }
  return out;
}

export function allUsages(): Usage[] {
  const out: Usage[] = [];
  for (const kind of KINDS) {
    for (const pos of POSES) {
      out.push({ kind, pos, stance: null, at: null, from: null });
      for (const stance of STANCES) for (const at of TIMES_SEC) for (const from of FROMS) out.push({ kind, pos, stance, at, from });
    }
  }
  return out;
}

function groups(seeds: number[], sides: Side[] = [0, 1]): Group[] {
  const gs: Group[] = [];
  for (const h of TEMPLATES) for (const o of TEMPLATES) for (const { id: map } of MAPS) for (const side of sides) for (const kind of KINDS) for (const pos of POSES) for (const seed of seeds) gs.push({ h, o, map, side, kind, pos, seed });
  return gs;
}

// ---------------------------------------------------------------- 並べて走らせる

declare const structuredClone: <T>(v: T) => T;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

/** 同じ道具を jobs 本の子プロセスで走らせ、それぞれが書いた JSON を集める */
async function fanOut(task: string, extra: string[], outDir: string, jobs: number): Promise<unknown[]> {
  const entry = new URL('./sim.ts', import.meta.url).pathname;
  const files: string[] = [];
  await Promise.all(
    Array.from({ length: jobs }, (_, i) => {
      const file = `${outDir}/${task}-${i}.json`;
      files.push(file);
      return new Promise<void>((resolve, reject) => {
        const ch = spawn(process.execPath, [...process.execArgv, entry, 'reserve', '--worker', task, String(i), String(jobs), file, ...extra, ...(QUICK ? ['--quick'] : [])], { stdio: 'inherit' });
        ch.on('exit', (code: number | null) => (code === 0 ? resolve() : reject(new Error(`${task} ${i} が失敗: ${String(code)}`))));
      });
    }),
  );
  return files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as unknown);
}

/** 子プロセスの中身。担当は、仕事の一覧の i 番目から jobs おき */
function worker(task: string, i: number, jobs: number, file: string, extra: string[]): void {
  const t0 = performance.now();
  if (task === 'a' || task === 'a-free') {
    const free = task === 'a-free';
    const out = STAGE_LIST.filter((_, k) => k % jobs === i).map((st) => stageRows(st, free));
    writeFileSync(file, JSON.stringify(out));
  } else if (task === 'control') {
    const seeds = JSON.parse(extra[0] as string) as number[];
    const out: Record<string, number> = {};
    let k = 0;
    for (const h of TEMPLATES) for (const o of TEMPLATES) for (const { id: map } of MAPS) for (const side of [0, 1] as Side[]) for (const seed of seeds) {
      if (k++ % jobs !== i) continue;
      out[controlKey(h, o, map, side, seed)] = controlScore(h, o, map, side, seed);
    }
    writeFileSync(file, JSON.stringify(out));
  } else if (task === 'screen' || task === 'recheck') {
    const seeds = JSON.parse(extra[0] as string) as number[];
    const usages = (JSON.parse(extra[1] as string) as string[]).map(parseUsage);
    // 使い方ごとに、測るひな形の組を絞る（「h|o」の一覧。書いていない使い方は全部の組）
    const only = JSON.parse(extra[2] ?? '{}') as Record<string, string[]>;
    const out: Record<string, number> = {};
    groups(seeds, task === 'screen' ? SCREEN_SIDES : [0, 1]).forEach((g, k) => {
      if (k % jobs !== i) return;
      const us = usages.filter((u) => u.kind === g.kind && u.pos === g.pos && (only[usageKey(u)] ?? [`${g.h}|${g.o}`]).includes(`${g.h}|${g.o}`));
      if (us.length === 0) return;
      for (const [key, v] of runGroup(g, us)) out[`${g.h}|${g.o}|${g.map}|${g.side}|${g.seed}#${key}`] = v;
    });
    writeFileSync(file, JSON.stringify(out));
  } else if (task === 'both') {
    // 両軍が同じ使い方をする（陣営0から見た点）。抜く部隊は、それぞれのひな形から同じ決め方で選ぶ
    const seeds = JSON.parse(extra[0] as string) as number[];
    const usages = (JSON.parse(extra[1] as string) as string[]).map(parseUsage);
    const out: Record<string, number> = {};
    let k = 0;
    for (const u of usages) for (const h of TEMPLATES) for (const o of TEMPLATES) for (const { id: map } of MAPS) for (const seed of seeds) {
      if (k++ % jobs !== i) continue;
      const f = pvpField(map);
      const a0 = pvpArmy(h, f, 0);
      const a1 = pvpArmy(o, f, 1);
      const i0 = pickUnit(a0, u.kind, u.pos, 0, f.width);
      const i1 = pickUnit(a1, u.kind, u.pos, 1, f.width);
      const r0 = { kind: u.kind, stance: u.stance ?? (a0[i0] as Placement).stance };
      const r1 = { kind: u.kind, stance: u.stance ?? (a1[i1] as Placement).stance };
      const s = make({
        field: f,
        armies: [a0.filter((_, j) => j !== i0), a1.filter((_, j) => j !== i1)],
        seed,
        maxTicks: 1800,
        timeout: 'compare',
        reserves: [r0, r1],
        ...(u.at !== null ? { scriptedReserves: [{ tick: u.at * 10, side: 0, from: u.from as ReserveFrom }, { tick: u.at * 10, side: 1, from: u.from as ReserveFrom }] } : {}),
      });
      out[`${h}|${o}|${map}|0|${seed}#${usageKey(u)}`] = score(runToEnd(s), 0);
    }
    writeFileSync(file, JSON.stringify(out));
  } else if (task === 'orders') {
    // (c) 現れた刻みに号令を足す。対照は、同じ刻みに同じ号令を出した、遊軍に回さない戦い
    const seeds = JSON.parse(extra[0] as string) as number[];
    const usages = (JSON.parse(extra[1] as string) as string[]).map(parseUsage);
    const out: Record<string, number> = {};
    const kinds: { name: string; make: (side: Side, from: ReserveFrom) => OrderInput }[] = [
      { name: 'charge-all', make: (side) => ({ side, target: 'all', kind: 'charge' }) },
      { name: 'charge-wing', make: (side, from) => ({ side, target: from, kind: 'charge' }) },
      { name: 'brace-all', make: (side) => ({ side, target: 'all', kind: 'brace' }) },
    ];
    let k = 0;
    for (const g of groups(seeds)) {
      const us = usages.filter((u) => u.kind === g.kind && u.pos === g.pos && u.at !== null);
      if (us.length === 0) continue;
      if (k++ % jobs !== i) continue;
      const { setup } = groupSetup(g, true);
      for (const ok of kinds) {
        const variants = us.map((u) => ({ stance: u.stance as Stance, from: u.from as ReserveFrom, tick: (u.at as number) * 10 }));
        // 号令は左右で変わるので、左右ごとに分けて流す
        for (const from of FROMS) {
          const vs = variants.filter((v) => v.from === from);
          if (vs.length === 0) continue;
          const res = branch(setup, g.side, vs, (s) => score(s, g.side), (fr) => [ok.make(g.side, fr)]);
          vs.forEach((v, j) => {
            const u = us.find((x) => x.stance === v.stance && x.from === v.from && (x.at as number) * 10 === v.tick) as Usage;
            out[`${g.h}|${g.o}|${g.map}|${g.side}|${g.seed}#${usageKey(u)}#${ok.name}`] = res[j] as number;
          });
        }
        // 対照（同じ刻みに同じ号令）
        for (const u of us) {
          const ck = `${g.h}|${g.o}|${g.map}|${g.side}|${g.seed}#ctrl|${u.at}|${u.from}#${ok.name}`;
          if (out[ck] === undefined) out[ck] = controlScore(g.h, g.o, g.map, g.side, g.seed, { tick: (u.at as number) * 10, order: ok.make(g.side, u.from as ReserveFrom) });
        }
      }
    }
    writeFileSync(file, JSON.stringify(out));
  } else throw new Error(`知らない仕事: ${task}`);
  console.log(`  [${task} ${i}/${jobs}] ${((performance.now() - t0) / 1000).toFixed(0)} 秒`);
}

// ---------------------------------------------------------------- 集計

const f2 = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(3);
const usageLabel = (u: Usage): string =>
  u.at === null ? `${u.kind}・${u.pos}・呼ばない` : `${u.kind}・${u.pos}・${u.stance}・${u.at}秒・${u.from === 'left' ? '左' : '右'}`;

interface Gain {
  usage: string;
  mean: number;
  /** ひな形の組（持つ側 h 対 相手 o）ごとの上がり方のうち、いちばん大きいもの */
  bestPair: { pair: string; gain: number };
  n: number;
}

/** 使い方ごとの平均の上がり方と、組ごとの上がり方 */
function gains(results: Record<string, number>, control: Record<string, number>): Gain[] {
  const byUsage = new Map<string, { sum: number; n: number; pairs: Map<string, { sum: number; n: number }> }>();
  for (const [k, v] of Object.entries(results)) {
    const [ctx, usage] = k.split('#') as [string, string];
    const [h, o, map, side, seed] = ctx.split('|') as [string, string, string, string, string];
    const c = control[`${h}|${o}|${map}|${side}|${seed}|`];
    if (c === undefined) throw new Error(`対照がない: ${ctx}`);
    const d = v - c;
    const e = byUsage.get(usage) ?? { sum: 0, n: 0, pairs: new Map() };
    e.sum += d;
    e.n++;
    const pk = `${h} 対 ${o}`;
    const pe = e.pairs.get(pk) ?? { sum: 0, n: 0 };
    pe.sum += d;
    pe.n++;
    e.pairs.set(pk, pe);
    byUsage.set(usage, e);
  }
  return [...byUsage.entries()].map(([usage, e]) => {
    let best = { pair: '', gain: -Infinity };
    for (const [pair, pe] of e.pairs) if (pe.sum / pe.n > best.gain) best = { pair, gain: pe.sum / pe.n };
    return { usage, mean: e.sum / e.n, bestPair: best, n: e.n };
  });
}

async function runA(outDir: string, jobs: number): Promise<void> {
  const t0 = performance.now();
  for (const task of ['a', 'a-free'] as const) {
    const parts = (await fanOut(task, [], outDir, jobs)) as { control: StageControl; rows: StageRow[] }[][];
    const all = parts.flat().sort((x, y) => STAGES.findIndex((s) => s.id === x.control.stage) - STAGES.findIndex((s) => s.id === y.control.stage));
    writeFileSync(`${outDir}/${task}.json`, JSON.stringify(all));
    console.log(task === 'a' ? `\n(a) 1人用：面ごとの、いちばんよい使い方（見本の配置から1部隊を遊軍に回す。種 ${A_SEEDS.length}）` : '\n(a) 面の方針の制限を外した測定（面で選べない方針だけ）');
    console.log('面   | 見本：勝ち 星 判定の割合 | 呼ばない：勝ち 星 | いちばん星の多い使い方：勝ち 星 判定の割合 星の割合');
    let starUp = 0;
    for (const { control: c, rows } of all) {
      if (rows.length === 0) {
        console.log(`${c.stage}  | ${c.wins} ${c.stars.toFixed(2)} ${c.remaining.toFixed(2)} | （面で選べない方針がない）`);
        continue;
      }
      const none = rows.filter((r) => r.at === null);
      const bestNone = none.sort((x, y) => y.stars - x.stars)[0];
      const best = rows.slice().sort((x, y) => y.stars - x.stars || y.wins - x.wins)[0] as StageRow;
      if (best.stars - c.stars >= 1) starUp++;
      const nn = bestNone ? `${bestNone.wins} ${bestNone.stars.toFixed(2)}` : '-';
      console.log(`${c.stage}  | ${c.wins} ${c.stars.toFixed(2)} ${c.remaining.toFixed(2)} | ${nn} | ${best.unit} ${best.stance ?? ''} ${best.at ?? '呼ばない'}${best.at !== null ? '秒' : ''} ${best.from ?? ''}：${best.wins} ${best.stars.toFixed(2)} ${best.remaining.toFixed(2)} ${best.remainingForStars.toFixed(2)}（星 ${f2(best.stars - c.stars)}）`);
    }
    console.log(`平均の星が 1 以上増える面：${starUp} 面`);
  }
  console.log(`（${((performance.now() - t0) / 1000).toFixed(0)} 秒）`);
}

async function runB(outDir: string, jobs: number): Promise<void> {
  const t0 = performance.now();
  const usages = allUsages().map(usageKey);
  // ふるい
  const ctrlS = Object.assign({}, ...((await fanOut('control', [JSON.stringify(SCREEN_SEEDS)], outDir, jobs)) as Record<string, number>[])) as Record<string, number>;
  const screen = Object.assign({}, ...((await fanOut('screen', [JSON.stringify(SCREEN_SEEDS), JSON.stringify(usages)], outDir, jobs)) as Record<string, number>[])) as Record<string, number>;
  writeFileSync(`${outDir}/screen-all.json`, JSON.stringify({ control: ctrlS, screen }));
  const gs = gains(screen, ctrlS);
  console.log(`\n(b) ふるい（種 ${SCREEN_SEEDS.length}・遊軍を持つのは陣営0だけ）：${gs.length} 通り、${Object.keys(screen).length} 戦（${((performance.now() - t0) / 1000).toFixed(0)} 秒）`);
  const topMean = gs.slice().sort((x, y) => y.mean - x.mean).slice(0, TOP);
  const topPair = gs.slice().sort((x, y) => y.bestPair.gain - x.bestPair.gain).slice(0, TOP);
  // 平均の上位は全部の組で、組の最大の上位は、その組だけで測り直す（時間を抑えるため。§7.9 の R13 からの絞り方として balance.md に書く）
  const pick = topMean.map((g) => g.usage);
  const only: Record<string, string[]> = {};
  for (const g of topPair) {
    if (pick.includes(g.usage)) continue;
    pick.push(g.usage);
    only[g.usage] = [g.bestPair.pair.replace(' 対 ', '|')];
  }
  console.log('ふるいの上位（平均）');
  for (const g of topMean) console.log(`  ${usageLabel(parseUsage(g.usage))}  平均 ${f2(g.mean)}  組の最大 ${f2(g.bestPair.gain)}（${g.bestPair.pair}）`);
  console.log('ふるいの上位（組の最大）');
  for (const g of topPair) console.log(`  ${usageLabel(parseUsage(g.usage))}  平均 ${f2(g.mean)}  組の最大 ${f2(g.bestPair.gain)}（${g.bestPair.pair}）`);
  console.log('呼ばない（部隊を1つ抜いただけ）');
  for (const g of gs.filter((x) => parseUsage(x.usage).at === null).sort((x, y) => y.mean - x.mean)) console.log(`  ${usageLabel(parseUsage(g.usage))}  平均 ${f2(g.mean)}  組の最大 ${f2(g.bestPair.gain)}（${g.bestPair.pair}）`);
  // 測り直し（種 20。片側ずつ）
  const t1 = performance.now();
  const ctrlR = Object.assign({}, ...((await fanOut('control', [JSON.stringify(RECHECK_SEEDS)], outDir, jobs)) as Record<string, number>[])) as Record<string, number>;
  const recheck = Object.assign({}, ...((await fanOut('recheck', [JSON.stringify(RECHECK_SEEDS), JSON.stringify(pick), JSON.stringify(only)], outDir, jobs)) as Record<string, number>[])) as Record<string, number>;
  const gr = gains(recheck, ctrlR).sort((x, y) => y.mean - x.mean);
  console.log(`\n(b) 測り直し（別の種 ${RECHECK_SEEDS.length}）：平均の上位 ${TOP} 通りは全部の組、組の最大の上位は、その組だけ（${((performance.now() - t1) / 1000).toFixed(0)} 秒）`);
  console.log('使い方 | 平均の上がり方（全部の組を測ったものだけ） | 組の最大（その組）');
  const full = gr.filter((g) => only[g.usage] === undefined);
  for (const g of full) console.log(`  ${usageLabel(parseUsage(g.usage))} | ${f2(g.mean)} | ${f2(g.bestPair.gain)}（${g.bestPair.pair}）`);
  console.log('組の最大の上位（その組だけを測り直した値）');
  for (const g of gr.filter((x) => only[x.usage] !== undefined).sort((x, y) => y.bestPair.gain - x.bestPair.gain)) console.log(`  ${usageLabel(parseUsage(g.usage))} | ${f2(g.bestPair.gain)}（${g.bestPair.pair}）`);
  // 両方が同じ使い方と (c) は、平均の上位 30 通り（測り直した値で並べ直したもの）
  const top30 = full.filter((g) => parseUsage(g.usage).at !== null).slice(0, TOP).map((g) => g.usage);
  const t2 = performance.now();
  const both = Object.assign({}, ...((await fanOut('both', [JSON.stringify(ORDER_SEEDS), JSON.stringify(top30)], outDir, jobs)) as Record<string, number>[])) as Record<string, number>;
  const gb = gains(both, ctrlR).sort((x, y) => y.mean - x.mean);
  console.log(`\n(b) 両軍が同じ使い方をしたとき（陣営0から見た得点率の変化。種 ${ORDER_SEEDS.length}）（${((performance.now() - t2) / 1000).toFixed(0)} 秒）`);
  for (const g of gb) console.log(`  ${usageLabel(parseUsage(g.usage))} | ${f2(g.mean)} | 組の最大 ${f2(g.bestPair.gain)}（${g.bestPair.pair}）`);
  // (c) 号令との組み合わせ
  const t3 = performance.now();
  const ord = Object.assign({}, ...((await fanOut('orders', [JSON.stringify(ORDER_SEEDS), JSON.stringify(top30)], outDir, jobs)) as Record<string, number>[])) as Record<string, number>;
  writeFileSync(`${outDir}/recheck-all.json`, JSON.stringify({ control: ctrlR, recheck, both, orders: ord }));
  console.log(`\n(c) 現れた刻みに号令を足す（種 ${ORDER_SEEDS.length}）（${((performance.now() - t3) / 1000).toFixed(0)} 秒）`);
  console.log('使い方 | 号令 | 対照（号令なし・遊軍なし）との差 | 対照（同じ号令・遊軍なし）との差 | 組の最大（号令なしの対照と）');
  for (const okName of ['charge-all', 'charge-wing', 'brace-all']) {
    const vsPlain: Record<string, number> = {};
    for (const [k, v] of Object.entries(ord)) {
      const [ctx, usage, on] = k.split('#') as [string, string, string];
      if (on !== okName || usage.startsWith('ctrl|')) continue;
      vsPlain[`${ctx}#${usage}`] = v;
    }
    const g1 = gains(vsPlain, ctrlR);
    // 同じ号令を出した対照との差
    const sums = new Map<string, { s: number; n: number }>();
    for (const [k, v] of Object.entries(vsPlain)) {
      const [ctx, usage] = k.split('#') as [string, string];
      const u = parseUsage(usage);
      const c = ord[`${ctx}#ctrl|${u.at}|${u.from}#${okName}`] as number;
      const e = sums.get(usage) ?? { s: 0, n: 0 };
      e.s += v - c;
      e.n++;
      sums.set(usage, e);
    }
    for (const g of g1.sort((x, y) => y.mean - x.mean).slice(0, 10)) {
      const e = sums.get(g.usage) as { s: number; n: number };
      console.log(`  ${usageLabel(parseUsage(g.usage))} | ${okName} | ${f2(g.mean)} | ${f2(e.s / e.n)} | ${f2(g.bestPair.gain)}（${g.bestPair.pair}）`);
    }
  }
  console.log(`（合わせて ${((performance.now() - t0) / 1000).toFixed(0)} 秒）`);
}

/** 写した状態から続けたものと、初めから予定を書いて流したものが同じか（測定の前に確かめる） */
function selfCheck(): void {
  const g: Group = { h: 'crane', o: 'arrow', map: 'river', side: 1, kind: 'cavalry', pos: 'edge', seed: 77 };
  const { setup } = groupSetup(g, true);
  const variants = [
    { stance: 'flank' as Stance, from: 'left' as ReserveFrom, tick: 60 },
    { stance: 'hunt' as Stance, from: 'right' as ReserveFrom, tick: 300 },
  ];
  const viaBranch = branch(setup, 1, variants, (s) => JSON.stringify(s));
  variants.forEach((v, i) => {
    const r = setup.reserves as NonNullable<BattleSetup['reserves']>;
    const direct = runToEnd(make({ ...setup, reserves: [r[0], { kind: g.kind, stance: v.stance }], scriptedReserves: [{ tick: v.tick, side: 1, from: v.from }] }));
    if (JSON.stringify(direct) !== viaBranch[i]) throw new Error('写した状態から続けた結果が、初めから流した結果と違う');
  });
}

export async function reserveMain(args: string[]): Promise<void> {
  if (args[0] === '--worker') {
    const [, task, i, jobs, file, ...extra] = args;
    worker(task as string, Number(i), Number(jobs), file as string, extra.filter((x) => x !== '--quick'));
    return;
  }
  const which = args[0] ?? 'all';
  const outDir = arg('--out', '.reserve-out');
  const jobs = Number(arg('--jobs', '8'));
  mkdirSync(outDir, { recursive: true });
  selfCheck();
  if (which === 'a' || which === 'all') await runA(outDir, jobs);
  if (which === 'b' || which === 'all') await runB(outDir, jobs);
}
