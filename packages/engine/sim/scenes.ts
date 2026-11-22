// 合格条件（design §3.9）の場面と、実測値の計算。テスト（test/acceptance）と sim accept で共有する。
// 場面の作り方を自分で決めた箇所は、ここのコメントに書く。

import {
  applyTemplate,
  createBattle,
  plainField,
  STANDARD_ROSTER,
  step,
  summarize,
  type BattleSetup,
  type BattleState,
  type Field,
  type OrderInput,
  type Placement,
  type Side,
  type TemplateId,
} from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { STANDARD_HEIGHT, STANDARD_WIDTH } from '../src/army.ts';
import { median, runSetup, runState, scoreFor, SEEDS_100, SEEDS_40, templateArmy } from './lib.ts';

/** 両軍の前列の行（標準の戦場の配置エリアから計算。10×12 なら 8 と 3） */
const F0 = (): number => plainField().zones[0].row;
const F1 = (): number => plainField().zones[1].row + plainField().zones[1].height - 1;
/** 配置エリアの左端の列（通り道のある盤では 1） */
const C0 = (): number => plainField().zones[0].col;

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);

function setupOf(armies: [Placement[], Placement[]], seed: number, extra: Partial<BattleSetup> = {}): BattleSetup {
  return { field: plainField(), armies, seed, maxTicks: 1800, timeout: 'compare', requireHq: false, ...extra };
}

/** 横一列。cols の各列に同じ兵種・方針で並べる */
function row(kind: Placement['kind'], stance: Placement['stance'], cols: number[], r: number): Placement[] {
  // 列は配置エリアの左端からの数（通り道のある盤では、配置エリアの中に収めるため）
  return cols.map((col) => ({ kind, stance, col: col + C0(), row: r }));
}

/** 戦場全体を両陣営の配置エリアにした戦場（小さな場面で、近い位置から始めるため） */
export function openField(width = STANDARD_WIDTH, height = STANDARD_HEIGHT): Field {
  const f = plainField(width, height);
  f.zones = [
    { col: 0, row: 0, width, height },
    { col: 0, row: 0, width, height },
  ];
  return f;
}

function mustCreate(setup: BattleSetup): BattleState {
  const r = createBattle(setup);
  if (!r.ok) throw new Error(`createBattle に失敗: ${r.error.message} ${JSON.stringify(r.error.armyErrors ?? [])}`);
  return r.value;
}

// ------------------------------------------------------------ A1

/** 配置の配列を逆順にする（id の振り方を変える） */
function reversed(p: Placement[]): Placement[] {
  return p.slice().reverse();
}

export function a1(template: TemplateId, reverse: boolean, seeds = SEEDS_100): number {
  const pts = seeds.map((seed) => {
    let a = templateArmy(template, 0);
    let b = templateArmy(template, 1);
    if (reverse) {
      a = reversed(a);
      b = reversed(b);
    }
    const { state } = runSetup({ field: plainField(), armies: [a, b], seed, maxTicks: 1800, timeout: 'compare' });
    return scoreFor(state, 0);
  });
  return mean(pts);
}

// ------------------------------------------------------------ A2
// 陣営1：歩兵3（4〜6列、前の行、前進）。陣営0：歩兵3（4〜6列、前の行、前進）と騎兵1。
// 場面の作り方（設計書にない部分）：騎兵は列の右端（7列）に置き、方針だけを変える。
//   正面＝前進（列に並べて前進）、側面＝迂回（右の端から回り込む）。

export interface A2Result {
  score: number;
  remaining: number;
  /** 決着までの秒数の平均（時間切れは 180 秒として数える） */
  seconds: number;
}

export function a2(mode: 'front' | 'flank', seeds = SEEDS_40): A2Result {
  const res = seeds.map((seed) => {
    const side0 = [...row('infantry', 'advance', [2, 3, 4], F0()), { kind: 'cavalry' as const, stance: mode === 'front' ? ('advance' as const) : ('flank' as const), col: 5 + C0(), row: F0() }];
    const side1 = row('infantry', 'advance', [2, 3, 4], F1());
    const { state } = runSetup(setupOf([side0, side1], seed));
    const sum = summarize(state);
    return { score: scoreFor(state, 0), remaining: sum.remaining[0], seconds: sum.seconds };
  });
  return { score: mean(res.map((r) => r.score)), remaining: mean(res.map((r) => r.remaining)), seconds: mean(res.map((r) => r.seconds)) };
}

// ------------------------------------------------------------ A3
// 戦場全体を配置エリアにした戦場で、盾兵（陣営0、守備）を (5, 8) に置く。騎兵は陣営1、前進。
// (a) ほかの部隊はいない。騎兵は正面 6 マス先の (5, 2) から当たる。
// (b) 盾兵を正面から押さえる歩兵（陣営1、前進）を (5, 7) に置く（中心どうし 1.0 で、開戦から近接の距離）。騎兵は盾兵の後ろ (5, 13) から当たる。

export interface A3Result {
  /** (a) 騎兵が失った兵の割合が盾兵より大きかった種の割合 */
  frontCavWorse: number;
  /** (b) 盾兵が消えた（敗走・全滅）種の割合 */
  rearShieldGone: number;
  frontCavLoss: number;
  frontShieldLoss: number;
}

function a3Scene(mode: 'front' | 'rear', seed: number): BattleState {
  const side0: Placement[] = [{ kind: 'shield', stance: 'hold', col: 3 + C0(), row: mode === 'front' ? 6 : 4 }];
  const side1: Placement[] =
    mode === 'front'
      ? [{ kind: 'cavalry', stance: 'advance', col: 3 + C0(), row: 0 }]
      : [
          { kind: 'infantry', stance: 'advance', col: 3 + C0(), row: 3 },
          { kind: 'cavalry', stance: 'advance', col: 3 + C0(), row: 9 },
        ];
  const state = mustCreate({ field: openField(), armies: [side0, side1], seed, maxTicks: 1800, timeout: 'compare', requireHq: false });
  runState(state, { stopWhen: (s) => s.tick >= 150 });
  return state;
}

export function a3(seeds = SEEDS_40): A3Result {
  let worse = 0;
  let gone = 0;
  const cl: number[] = [];
  const sl: number[] = [];
  for (const seed of seeds) {
    const a = a3Scene('front', seed);
    const shield = a.units[0]!;
    const cav = a.units[1]!;
    // 失った兵の割合：敗走・全滅した部隊は全部を失ったと数える（summarize の remaining と同じ数え方）
    const lossOf = (u: typeof shield): number => (u.status === 'active' ? 1 - u.men / u.maxMen : 1);
    cl.push(lossOf(cav));
    sl.push(lossOf(shield));
    if (lossOf(cav) > lossOf(shield)) worse++;
    const b = a3Scene('rear', seed);
    if (b.units[0]!.status !== 'active') gone++;
  }
  return { frontCavWorse: worse / seeds.length, rearShieldGone: gone / seeds.length, frontCavLoss: mean(cl), frontShieldLoss: mean(sl) };
}

// ------------------------------------------------------------ A4
// (a) 盾兵2（守備）を (5,10)(6,10)、その後ろに弓兵2（守備）を (5,11)(6,11)。歩兵3（前進）は 8 マス先の (4..6, 2)。
//     「最初の近接が始まる刻み」は、刻みの初めに、近接の距離（1.05）にいる敵どうしの組が初めてできた刻みとする。
//     その刻みの step を呼ぶ前の状態で、歩兵の損害と弓兵の損害を見る。
// (b) 戦場全体を配置エリアにした戦場で、弓兵1（陣営0、前進）を (5,8)、歩兵1（陣営1、前進）を (5,7) に置く。

export interface A4Result {
  /** (a) 種ごとの、最初の近接までに歩兵が失った割合の最小値と平均 */
  infLossMin: number;
  infLossMean: number;
  /** (a) 最初の近接までに弓兵が受けた損害の合計（全種） */
  archerTaken: number;
  /** (b) 歩兵が勝った種の割合 */
  infWins: number;
}

function anyMelee(s: BattleState): boolean {
  for (const a of s.units) {
    if (a.status !== 'active') continue;
    for (const b of s.units) {
      if (b.side === a.side || b.status !== 'active') continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= T.meleeRange) return true;
    }
  }
  return false;
}

export function a4(seeds = SEEDS_40): A4Result {
  const losses: number[] = [];
  let archerTaken = 0;
  let infWins = 0;
  for (const seed of seeds) {
    const side0 = [...row('shield', 'hold', [3, 4], F0()), ...row('archer', 'hold', [3, 4], F0() + 1)];
    const side1 = row('infantry', 'advance', [2, 3, 4], 0);
    const state = mustCreate(setupOf([side0, side1], seed));
    runState(state, { stopWhen: anyMelee });
    const inf = state.units.filter((u) => u.side === 1);
    losses.push(inf.reduce((s, u) => s + (u.maxMen - u.men), 0) / inf.reduce((s, u) => s + u.maxMen, 0));
    archerTaken += state.units.filter((u) => u.kind === 'archer').reduce((s, u) => s + u.stats.taken, 0);

    const b = mustCreate({
      field: openField(),
      armies: [[{ kind: 'archer', stance: 'advance', col: 3 + C0(), row: 6 }], [{ kind: 'infantry', stance: 'advance', col: 3 + C0(), row: 5 }]],
      seed,
      maxTicks: 1800,
      timeout: 'compare',
      requireHq: false,
    });
    runState(b);
    if (b.outcome?.winner === 1) infWins++;
  }
  return { infLossMin: Math.min(...losses), infLossMean: mean(losses), archerTaken, infWins: infWins / seeds.length };
}

// ------------------------------------------------------------ A5
// 陣営1：歩兵5（4〜8列、前の行、守備）。陣営0：歩兵5（4〜8列、前の行、前進）と、右の端（9・10列）に騎兵2（迂回）。
// 「敗走」は rout の出来事で数える（全滅は数えない）。最初の敗走は、どちらの陣営かを問わない。

export interface A5Result {
  /** 騎兵あり：最初の敗走から5秒以内に陣営1の2部隊目が敗走した種の割合 */
  withCav: number;
  /** 開戦から陣営1の2部隊目が敗走するまでの秒数の中央値（起きなければ 180 秒として数える） */
  medianWithCav: number;
  medianWithoutCav: number;
}

function a5Count(withCav: boolean, seed: number): { second: boolean; secondTick: number } {
  const side0 = [...row('infantry', 'advance', [1, 2, 3, 4, 5], F0()), ...(withCav ? row('cavalry', 'flank', [6, 7], F0()) : [])];
  const side1 = row('infantry', 'hold', [1, 2, 3, 4, 5], F1());
  const state = mustCreate(setupOf([side0, side1], seed));
  let first: number | null = null;
  const side1RoutTicks: number[] = [];
  while (!state.outcome) {
    const ev = step(state, []);
    for (const e of ev) {
      if (e.type !== 'rout') continue;
      if (first === null) first = e.tick;
      if (state.units[e.unit]!.side === 1) side1RoutTicks.push(e.tick);
    }
    if (side1RoutTicks.length >= 2) break;
  }
  const secondTick = side1RoutTicks[1] ?? state.maxTicks;
  if (first === null) return { second: false, secondTick };
  const within = side1RoutTicks.filter((t) => t <= first! + 50);
  return { second: within.length >= 2, secondTick };
}

export function a5(seeds = SEEDS_40): A5Result {
  const w = seeds.map((s) => a5Count(true, s));
  const wo = seeds.map((s) => a5Count(false, s));
  return {
    withCav: w.filter((r) => r.second).length / seeds.length,
    medianWithCav: median(w.map((r) => r.secondTick * 0.1)),
    medianWithoutCav: median(wo.map((r) => r.secondTick * 0.1)),
  };
}

// ------------------------------------------------------------ A8
// 号令ごとの場面。どれも、ふつうの初期状態から始まり、号令を出す刻みを決めておく。号令を出すのは陣営0。
// 突撃：陣営0は偃月（R15）、陣営1は鋒矢（R15）。8秒に全軍突撃（2026-11-17 に替えた。design §3.6.6）。
//       出さないと、鋒矢の軸の盾兵が偃月の中央を抜けて本陣を討つ（種40個すべて hq、平均 72.6 秒）。
//       出すと、ぶつかった直後の10秒の攻撃が 1.3 倍になり、偃月の歩兵と弓兵が鋒矢の矢じりと軸を先に崩す（与えた損害の平均：弓兵 380 → 551、歩兵 189 → 256）。
//       盾兵は本陣に届かず、鋒矢は全滅する（40個すべて wipeout）。どちらの場合も、守備の味方にふさがれる部隊も時間切れもない。刻み 6〜15 秒で出しても 40 個すべて勝つ。
//       前の場面（鶴翼 対 偃月）は、盾兵の後ろでふさがれていた弓兵を突撃が押し出していただけだったので、回り込みの決まりを足したときに替えた。
//       T10 の記録の「A8 charge」は、前の場面の配置のまま残している（A8 のテストの場面とは別）。
// 堅守：陣営0は鶴翼（R15）、陣営1は魚鱗（R15）。6秒に中央（4〜7列）へ堅守。
//       中央の翼に入る、両翼の内側の歩兵が魚鱗の先と組み合っている。出さないと崩れて負ける（種1000：103秒で壊滅）。
//       出すと、その場で踏みとどまって崩れず、勝ちに変わる（種1000：58秒で壊滅させて勝ち）。
// 突撃・堅守の場面は、ひな形の組・翼（全軍・中央）・刻み（4・8・15秒）を総当たりして、前後の刻みでも結果が変わらない組を選んだ。
// 後退：陣営0は歩兵3（4〜6列、前の行、前進）と弓兵4（1・2・9・10列、いちばん奥の行、守備）。陣営1は歩兵4（3〜6列、前の行、前進）。
//       歩兵どうしがぶつかった頃（5秒）に全軍後退し、弓兵の届くところまで敵を引き込む。

export type A8Kind = 'charge' | 'brace' | 'retreat';

export const A8_ORDER_TICK: Record<A8Kind, number> = { charge: 80, brace: 60, retreat: 50 };
export const A8_TEMPLATES: Record<'charge' | 'brace', [TemplateId, TemplateId]> = { charge: ['crescent', 'arrow'], brace: ['crane', 'scale'] };

export function a8Setup(kind: A8Kind, seed: number): BattleSetup {
  if (kind === 'charge' || kind === 'brace') {
    const [a, b] = A8_TEMPLATES[kind];
    return { field: plainField(), armies: [templateArmy(a, 0), templateArmy(b, 1)], seed, maxTicks: 1800, timeout: 'compare' };
  }
  // 配置エリアの奥行きが 4 だと、いちばん後ろの弓兵からも前列の戦いに矢が届き、号令なしでも勝つ（main は 5 行離れていた）。
  // 敵の歩兵を 5 にして、号令なしでは負ける場面にした（実験の枝の sim diag retreat --enemy 5 で確かめた）。弓兵は配置エリアの 1・2・幅-3・幅-2 列
  const zw = plainField().zones[0].width;
  const side0 = [...row('infantry', 'advance', [2, 3, 4], F0()), ...row('archer', 'hold', [1, 2, zw - 3, zw - 2], F0() + 3)];
  const side1 = row('infantry', 'advance', [1, 2, 3, 4, 5], F1());
  return setupOf([side0, side1], seed);
}

export function a8Order(kind: A8Kind): OrderInput {
  if (kind === 'charge') return { side: 0, target: 'all', kind: 'charge' };
  if (kind === 'brace') return { side: 0, target: 'center', kind: 'brace' };
  return { side: 0, target: 'all', kind: 'retreat' };
}

export function a8(kind: A8Kind, seeds = SEEDS_40): { withOrder: number; without: number } {
  const w: number[] = [];
  const wo: number[] = [];
  for (const seed of seeds) {
    const s1 = runSetup(a8Setup(kind, seed), { orders: (s) => (s.tick === A8_ORDER_TICK[kind] ? [a8Order(kind)] : []) }).state;
    w.push(scoreFor(s1, 0));
    wo.push(scoreFor(runSetup(a8Setup(kind, seed)).state, 0));
  }
  return { withOrder: mean(w), without: mean(wo) };
}

// ------------------------------------------------------------ A11
// 同じ予算（36）の2軍。守る側：本陣・盾兵4・弓兵4・歩兵6 を横陣に並べ、全部隊を守備。
// 攻める側：本陣・歩兵6・盾兵2・騎兵3・弓兵2 を横陣のひな形どおり。守る側を陣営0にした40戦と陣営1にした40戦。
// 全部隊が守備の軍どうしは、守る側の編成を両軍に使う。

// 予算 24 の版（実験の枝 exp/grid-tuning で置き直したもの。守る側 盾3・弓3・歩3、攻める側 歩5・盾1・騎2・弓1。元の 36 の編成を約 3分の2 に）
export const A11_DEFENSE = { hq: 1, shield: 3, archer: 3, infantry: 3 } as const;
export const A11_OFFENSE = { hq: 1, infantry: 5, shield: 1, cavalry: 2, archer: 1 } as const;

export function allHold(p: Placement[]): Placement[] {
  return p.map((x) => ({ ...x, stance: 'hold' }));
}

function lineOf(roster: Record<string, number>, side: Side): Placement[] {
  const f = plainField();
  return applyTemplate('line', roster, f.zones[side], side);
}

export function a11(seeds = SEEDS_40): { defenderScore: number; holdVsHoldAllDraw: boolean } {
  const pts: number[] = [];
  let allDraw = true;
  for (const seed of seeds) {
    for (const side of [0, 1] as const) {
      const def = allHold(lineOf(A11_DEFENSE, side));
      const atk = lineOf(A11_OFFENSE, side === 0 ? 1 : 0);
      const armies: [Placement[], Placement[]] = side === 0 ? [def, atk] : [atk, def];
      const { state } = runSetup({ field: plainField(), armies, seed, maxTicks: 1800, timeout: 'compare' });
      pts.push(scoreFor(state, side));
    }
    const hh = runSetup({
      field: plainField(),
      armies: [allHold(lineOf(A11_DEFENSE, 0)), allHold(lineOf(A11_DEFENSE, 1))],
      seed,
      maxTicks: 1800,
      timeout: 'compare',
    }).state;
    // 全部隊が守備どうしは、膠着の引き分け（§3.6.4。開戦から 10 秒）
    if (!(hh.outcome?.reason === 'stalemate' && hh.outcome.winner === 'draw')) allDraw = false;
  }
  return { defenderScore: mean(pts), holdVsHoldAllDraw: allDraw };
}

// ------------------------------------------------------------ A13
// 多いほう（陣営0）：歩兵6（3〜8列、前の行、前進）。少ないほう（陣営1）：歩兵4（4〜7列、前の行、前進）。
// 同じ数どうし：歩兵4（4〜7列）対 歩兵4（4〜7列）。値は種ごとの「flankDealt ÷ dealt」の平均。

export function a13(seeds = SEEDS_40): { sixVsFour: number; fourVsFour: number } {
  const ratio = (cols0: number[], seed: number): number => {
    const { state } = runSetup(setupOf([row('infantry', 'advance', cols0, F0()), row('infantry', 'advance', [2, 3, 4, 5], F1())], seed));
    const mine = state.units.filter((u) => u.side === 0);
    const dealt = mine.reduce((s, u) => s + u.stats.dealt, 0);
    const flank = mine.reduce((s, u) => s + u.stats.flankDealt, 0);
    return dealt > 0 ? flank / dealt : 0;
  };
  return {
    sixVsFour: mean(seeds.map((s) => ratio([1, 2, 3, 4, 5, 6], s))),
    fourVsFour: mean(seeds.map((s) => ratio([2, 3, 4, 5], s))),
  };
}

// ------------------------------------------------------------ A14
// 陣営0は R15 を鋒矢、陣営1は R15 を横陣にして全部隊を守備。陣営0が勝った戦いのうち、理由が hq のものの割合。

export function a14(seeds = SEEDS_40): { side0Wins: number; hqShare: number } {
  let wins = 0;
  let hq = 0;
  for (const seed of seeds) {
    const armies: [Placement[], Placement[]] = [templateArmy('arrow', 0), allHold(templateArmy('line', 1))];
    const { state } = runSetup({ field: plainField(), armies, seed, maxTicks: 1800, timeout: 'compare' });
    if (state.outcome?.winner === 0) {
      wins++;
      if (state.outcome.reason === 'hq') hq++;
    }
  }
  return { side0Wins: wins, hqShare: wins > 0 ? hq / wins : 0 };
}

export { applyTemplate, STANDARD_ROSTER };
export type { Side };
