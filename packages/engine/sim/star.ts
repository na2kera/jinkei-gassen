// 星3つの配置を探す道具（sim star）。実験の枝 exp/grid-tuning の sim/star.ts を持ち込んだ（design §13.5。テストには使わない）。面の field・roster・allow から読むので、盤の大きさに頼らない。
//   sim star <面の id> [--iters 400] [--screen 6] [--rand 1] [--keep 4] [--quiet]
// 1. 出発点：見本の配置（と見本の号令）、7つのひな形（そのまま・全部守備・全部前進。その面で選べる方針だけ）× 号令の型（なし・いくつか・見本の号令）。
// 2. 出発点を、種 --screen 個で測り、上位 --keep 個から山登り：1部隊を近くの空きマスへ動かす・2部隊の場所を入れ替える・1部隊の方針を変える・
//    号令を足す／消す／時刻と翼を変える。点が下がらなければ受け入れる。
// 3. いちばんよかった配置を、種 20 個（STAGE_SEEDS）と、置く順を変えた3通り（ORDER_PERMS）で測り直す。
// 点：星3つの種の数 ＋ 勝った種の割合 × 0.5 ＋ 星に使う残りの割合の平均（勝った戦いだけ。負けは 0 として平均する）。

import { STAGES, starsFor, stanceAllowedInStage, summarize, validateStageArmy, type Kind, type OrderKind, type OrderTarget, type Placement, type Stage, type StageEnemyOrder, type Stance } from '../src/index.ts';
import { STANCES } from '../src/types.ts';
import { ORDER_PERMS, runStage, STAGE_SEEDS, stageTemplateArmy } from './stagelib.ts';
import { TEMPLATE_IDS } from './lib.ts';

interface Cand {
  ps: Placement[];
  orders: StageEnemyOrder[];
  from: string;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function arg(args: string[], name: string, fb: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : fb;
}

function measure(stage: Stage, c: Cand, seeds: number[]): { three: number; wins: number; rem: number; score: number } {
  let three = 0;
  let wins = 0;
  let rem = 0;
  for (const seed of seeds) {
    const sm = summarize(runStage(stage, c.ps, seed, undefined, c.orders));
    const st = starsFor(sm, 0);
    if (st === 3) three++;
    if (sm.winner === 0) wins++;
    // 残りの割合は勝った戦いだけで数える（負けて時間切れになった戦いは、戦わずに残った兵で割合が高く出るため）
    if (sm.winner === 0) rem += sm.remainingForStars[0];
  }
  const n = seeds.length;
  return { three, wins, rem: rem / n, score: three + (wins / n) * 0.5 + rem / n };
}

function allowedStances(stage: Stage, kind: Kind): Stance[] {
  const all: Stance[] = kind === 'hq' ? ['hold', 'advance'] : [...STANCES];
  return all.filter((s) => stanceAllowedInStage(stage, kind, s));
}

function ok(stage: Stage, c: Cand): boolean {
  return validateStageArmy(stage, c.ps).length === 0;
}

function withStance(stage: Stage, ps: Placement[], st: Stance): Placement[] {
  return ps.map((p) => (allowedStances(stage, p.kind).includes(st) ? { ...p, stance: st } : p));
}

const ORDER_KINDS: OrderKind[] = ['brace', 'charge', 'retreat'];
const TARGETS: OrderTarget[] = ['all', 'left', 'center', 'right'];

function mutate(stage: Stage, c: Cand, rnd: () => number): Cand {
  const zone = stage.field.zones[0];
  const ps = c.ps.map((p) => ({ ...p }));
  let orders = c.orders.map((o) => ({ ...o }));
  const ordersOk = stage.allow?.orders !== false;
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)] as T;
  const r = rnd();
  if (r < 0.1) {
    // 1部隊を、エリアのどこかの空きマスへ跳ばす（遠い形へ移れるように）
    const i = Math.floor(rnd() * ps.length);
    const p = ps[i] as Placement;
    const col = zone.col + Math.floor(rnd() * zone.width);
    const row = zone.row + Math.floor(rnd() * zone.height);
    if (!ps.some((q) => q.col === col && q.row === row)) {
      p.col = col;
      p.row = row;
    }
  } else if (r < 0.4) {
    // 1部隊を、±2 マスの空きマスへ
    const i = Math.floor(rnd() * ps.length);
    const p = ps[i] as Placement;
    const col = p.col + Math.floor(rnd() * 5) - 2;
    const row = p.row + Math.floor(rnd() * 5) - 2;
    if (col >= zone.col && col < zone.col + zone.width && row >= zone.row && row < zone.row + zone.height && !ps.some((q) => q.col === col && q.row === row)) {
      p.col = col;
      p.row = row;
    }
  } else if (r < 0.55) {
    const i = Math.floor(rnd() * ps.length);
    const j = Math.floor(rnd() * ps.length);
    const a = ps[i] as Placement;
    const b = ps[j] as Placement;
    [a.col, b.col, a.row, b.row] = [b.col, a.col, b.row, a.row];
  } else if (r < 0.8 || !ordersOk) {
    const i = Math.floor(rnd() * ps.length);
    const p = ps[i] as Placement;
    p.stance = pick(allowedStances(stage, p.kind));
  } else {
    const r2 = rnd();
    if (orders.length < 3 && r2 < 0.4) orders.push({ atSec: 3 + Math.floor(rnd() * 58), target: pick(TARGETS), kind: pick(ORDER_KINDS) });
    else if (orders.length > 0 && r2 < 0.6) orders.splice(Math.floor(rnd() * orders.length), 1);
    else if (orders.length > 0) {
      const o = orders[Math.floor(rnd() * orders.length)] as StageEnemyOrder;
      if (rnd() < 0.6) o.atSec = Math.max(1, o.atSec + Math.floor(rnd() * 13) - 6);
      else o.target = pick(TARGETS);
    }
    orders = orders.sort((p, q) => p.atSec - q.atSec);
    // 同じ秒の号令は1つにする
    orders = orders.filter((o, k) => k === 0 || o.atSec !== (orders[k - 1] as StageEnemyOrder).atSec);
  }
  return { ps, orders, from: c.from };
}

export function starSearch(stage: Stage, opts: { iters: number; screen: number; keep: number; rand: number; quiet: boolean }): { best: Cand; m20: ReturnType<typeof measure>; perms: { name: string; three: number }[] } {
  const rnd = lcg(opts.rand);
  const screenSeeds = STAGE_SEEDS.slice(0, opts.screen);
  // 探す途中も、置く順を逆にした配置を一緒に測る（置く順に頼って勝つ配置を選ばないため）。点は2つの小さいほう
  const screenM = (c: Cand): ReturnType<typeof measure> => {
    const a = measure(stage, c, screenSeeds);
    const b = measure(stage, { ...c, ps: c.ps.slice().reverse() }, screenSeeds);
    return a.score <= b.score ? a : b;
  };
  const ordersOk = stage.allow?.orders !== false;
  const starts: Cand[] = [{ ps: stage.solution, orders: stage.solutionOrders ?? [], from: '見本' }];
  const orderSets: StageEnemyOrder[][] = ordersOk
    ? [
        [],
        [{ atSec: 5, target: 'all', kind: 'brace' }],
        [{ atSec: 20, target: 'all', kind: 'brace' }, { atSec: 40, target: 'all', kind: 'brace' }],
        [{ atSec: 25, target: 'all', kind: 'charge' }],
        // 全軍堅守を約 22 秒おきに 3 回（堅守は 10 秒。長く耐える面の型）
        ...[5, 10, 15].map((t): StageEnemyOrder[] => [0, 22, 44].map((d) => ({ atSec: t + d, target: 'all' as OrderTarget, kind: 'brace' as OrderKind }))),
        // ひな形 × 見本の号令（号令で決まる面のため。design §13.5 の「道具の小さな直し」）
        ...(stage.solutionOrders?.length ? [stage.solutionOrders] : []),
      ]
    : [[]];
  for (const t of TEMPLATE_IDS) {
    const base = stageTemplateArmy(stage, t);
    for (const [name, ps] of [[t, base], [`${t}・守備`, withStance(stage, base, 'hold')], [`${t}・前進`, withStance(stage, base, 'advance')]] as [string, Placement[]][]) {
      for (const os of orderSets) starts.push({ ps, orders: os, from: `${name}${os.length ? `＋号令${os.length}` : ''}` });
    }
  }
  const scored = starts.filter((c) => ok(stage, c)).map((c) => ({ c, m: screenM(c) }));
  scored.sort((a, b) => b.m.score - a.m.score);
  if (!opts.quiet) console.log(`出発点 ${scored.length} 個。上位：${scored.slice(0, opts.keep).map((x) => `${x.c.from} 星3 ${x.m.three}/${opts.screen}`).join('、')}`);
  let pool = scored.slice(0, opts.keep);
  const per = Math.max(1, Math.floor(opts.iters / pool.length));
  for (let k = 0; k < pool.length; k++) {
    let cur = pool[k] as { c: Cand; m: ReturnType<typeof measure> };
    for (let it = 0; it < per; it++) {
      const n = mutate(stage, cur.c, rnd);
      if (!ok(stage, n)) continue;
      const m = screenM(n);
      if (m.score >= cur.m.score) cur = { c: n, m };
      if (cur.m.three === opts.screen && cur.m.rem > 0.85) break;
    }
    pool[k] = cur;
    if (!opts.quiet) console.log(`  ${cur.c.from} から：星3 ${cur.m.three}/${opts.screen} 勝ち ${cur.m.wins} 残り ${cur.m.rem.toFixed(2)}`);
  }
  pool = pool.sort((a, b) => b.m.score - a.m.score);
  // 上位を種 20 で測り直し、置く順を変えた3通りも測って、いちばん悪い値（最小）で比べる（テストは置く順を変えても 10 以上を求める）
  const finals = pool.map((x) => {
    const m = measure(stage, x.c, STAGE_SEEDS);
    const worst = Math.min(m.three, ...ORDER_PERMS.map((p) => measure(stage, { ...x.c, ps: p.apply(x.c.ps) }, STAGE_SEEDS).three));
    return { c: x.c, m, worst };
  });
  finals.sort((a, b) => b.worst - a.worst || b.m.three - a.m.three || b.m.rem - a.m.rem);
  const best = (finals[0] as { c: Cand; m: ReturnType<typeof measure> });
  const perms = ORDER_PERMS.map((p) => ({ name: p.name, three: measure(stage, { ...best.c, ps: p.apply(best.c.ps) }, STAGE_SEEDS).three }));
  return { best: best.c, m20: best.m, perms };
}

export function starMain(args: string[]): void {
  const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && (args[i - 1] as string).startsWith('--')));
  const opts = { iters: Number(arg(args, '--iters', '400')), screen: Number(arg(args, '--screen', '6')), keep: Number(arg(args, '--keep', '4')), rand: Number(arg(args, '--rand', '1')), quiet: args.includes('--quiet') };
  for (const id of ids) {
    const stage = STAGES.find((s) => s.id === id);
    if (!stage) {
      console.log(`面がない: ${id}（${STAGES.map((s) => s.id).join(', ')}）`);
      continue;
    }
    const t0 = performance.now();
    console.log(`■ ${stage.id} ${stage.name}  戦場 ${stage.field.width}×${stage.field.height}  手持ち ${JSON.stringify(stage.roster)}  号令 ${stage.allow?.orders === false ? 'なし' : 'あり'}`);
    const r = starSearch(stage, opts);
    console.log(`  見つけた配置（出発点 ${r.best.from}）：種20 のうち星3つ ${r.m20.three}・勝ち ${r.m20.wins}・残り ${r.m20.rem.toFixed(2)}  置く順を変えて：${r.perms.map((p) => `${p.name} ${p.three}`).join('・')}`);
    console.log(`  ps: ${JSON.stringify(r.best.ps.map((p) => [p.kind, p.col, p.row, p.stance]))}`);
    console.log(`  orders: ${JSON.stringify(r.best.orders)}`);
    console.log(`  （${((performance.now() - t0) / 1000).toFixed(0)} 秒）`);
  }
}
