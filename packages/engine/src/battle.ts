// 戦闘の作成と、1刻みの計算（design §3.1、§3.6）。
// step は渡された状態を書き換える。判断はすべて「刻みの初めの状態」（snap）を見て行い、
// 動き・損害・士気は全部隊ぶんを計算してから同時に適用する。部隊を処理する順番（id の順）で結果が変わらないようにするため。

import { MAX_UNITS, validateArmy } from './army.ts';
import { angleBetween, dist, leftOf, normalize, rotateToward, sideSign } from './geom.ts';
import { applyOrder, endOrder } from './orders.ts';
import { nextFloat, rngFromSeed } from './rng.ts';
import { hasTerrain, terrainAllowsImpact, terrainArcherRange, terrainArrowClear, terrainDamageMult, terrainSpeedMult, type AttackKind } from './terrain.ts';
import { collapseBesideGate, pathLength, pushOutOfWalls, readWalls, routeTo, sideOfWall, wallsOfGate, type WallInfo } from './walls.ts';
import { DT, KIND_STATS, T } from './tuning.ts';
import { isDenseArray, isInt, isObject, isOrderKind, isOrderTarget, isSide, isTerrain, MAX_FIELD_SIDE, MAX_ORDERS_PER_STEP, MAX_SCRIPTED_ORDERS } from './input.ts';
import { wingOf } from './army.ts';
import {
  ORDER_KINDS,
  ORDER_TARGETS,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type BrokenRecord,
  type GateSetup,
  type Facing,
  type Field,
  type OrderInput,
  type Placement,
  type Result,
  type ScriptedOrder,
  type Side,
  type Unit,
  type UnitKind,
  type Zone,
} from './types.ts';
import type { KindStats } from './tuning.ts';

/** 門の数字（動かない、攻撃しない、向きを変えない） */
const GATE_STATS: KindStats = { men: T.gateMen, speed: 0, melee: 0, turn: 0 };

/** 兵種の数字。門は GATE_STATS */
function statsOf(kind: UnitKind): KindStats {
  return kind === 'gate' ? GATE_STATS : KIND_STATS[kind];
}

/** 門か（門は、支え・囲み・壊滅・残った兵・号令の対象に数えない） */
export function isGate(u: Unit): boolean {
  return u.kind === 'gate';
}

// ---------------------------------------------------------------- 作成

/** 戦場を調べ、正しければ、決まった鍵だけを取り出した複製を返す（JSON にして戻しても変わらない形にする） */
function cleanField(field: unknown): Field | string {
  if (!isObject(field)) return '戦場がない';
  const { width, height, terrain, zones } = field;
  if (!isInt(width) || !isInt(height) || width < 3 || height < 3 || width > MAX_FIELD_SIDE || height > MAX_FIELD_SIDE) return '戦場の大きさが正しくない';
  if (!isDenseArray(terrain) || terrain.length !== width * height) return '地形の長さが width × height と違う';
  if (!terrain.every(isTerrain)) return '知らない地形がある';
  if (!isDenseArray(zones) || zones.length !== 2) return '配置エリアは陣営ごとに1つ';
  const out: Zone[] = [];
  for (const z of zones) {
    if (!isObject(z)) return '配置エリアが正しくない';
    const { col, row } = z;
    const zw = z['width'];
    const zh = z['height'];
    if (!isInt(col) || !isInt(row) || !isInt(zw) || !isInt(zh)) return '配置エリアの値は整数で書く';
    if (zw < 1 || zh < 1 || col < 0 || row < 0 || col + zw > width || row + zh > height) return '配置エリアが戦場からはみ出している';
    out.push({ col, row, width: zw, height: zh });
  }
  return { width, height, terrain: terrain.slice(), zones: [out[0] as Zone, out[1] as Zone] };
}

/** 陣営の「前」の向き（陣営0は y が減る向き） */
export function frontOf(side: Side): { x: number; y: number } {
  return side === 0 ? { x: 0, y: -1 } : { x: 0, y: 1 };
}

/** 陣営から見た「左」が x の小さいほうなら -1、大きいほうなら +1 */
function leftSignX(side: Side): number {
  return side === 0 ? -1 : 1;
}

/**
 * 戦闘を作る。setup はどんな値でもよく、正しくなければ例外を投げずにエラーを返す。
 * 作った状態は、決まった鍵だけでできていて、JSON にして戻しても同じになる。
 */
export function createBattle(setup: BattleSetup): Result<BattleState> {
  const bad = (message: string): Result<BattleState> => ({ ok: false, error: { code: 'invalid_setup', message } });
  if (!isObject(setup)) return bad('設定がない');
  const field = cleanField(setup.field);
  if (typeof field === 'string') return { ok: false, error: { code: 'invalid_field', message: field } };
  if (typeof setup.seed !== 'number' || !Number.isFinite(setup.seed)) return bad('種が正しくない');
  if (!isInt(setup.maxTicks) || setup.maxTicks < 1) return bad('maxTicks は1以上の整数');
  if (!['compare', 'side0_wins', 'side0_loses'].includes(setup.timeout as string)) return bad('timeout が正しくない');
  if (setup.requireHq !== undefined && typeof setup.requireHq !== 'boolean') return bad('requireHq が正しくない');
  const rawScripted: unknown = setup.scriptedOrders ?? [];
  if (!isDenseArray(rawScripted)) return bad('予定された号令は配列で書く');
  if (rawScripted.length > MAX_SCRIPTED_ORDERS) return bad(`予定された号令は ${MAX_SCRIPTED_ORDERS} 件まで`);
  const scripted: ScriptedOrder[] = [];
  for (const o of rawScripted) {
    if (!isObject(o) || !isInt(o.tick) || o.tick < 0 || !isSide(o.side) || !isOrderTarget(o.target) || !isOrderKind(o.kind)) {
      return bad('予定された号令が正しくない');
    }
    scripted.push({ tick: o.tick, side: o.side, target: o.target, kind: o.kind });
  }
  const requireHq = setup.requireHq ?? true;
  // 城壁と門の形（§3.8）：城壁は戦場を横切る1行だけ、その行の1マスだけが切れ目で、そこに門を置く
  const walls = readWalls(field);
  if (typeof walls === 'string') return { ok: false, error: { code: 'invalid_field', message: walls } };
  const z0 = field.zones[0];
  if (walls && walls.row >= z0.row && walls.row < z0.row + z0.height) return { ok: false, error: { code: 'invalid_field', message: '陣営0の配置エリアに城壁を置けない' } };
  let gate: GateSetup | null = null;
  if (setup.gate !== undefined) {
    const g: unknown = setup.gate;
    if (!isObject(g) || !isSide(g.side) || !isInt(g.col) || !isInt(g.row) || typeof g.win !== 'boolean') return bad('門の指定が正しくない');
    if (!walls) return bad('門は城壁の行の切れ目に置く（城壁がない）');
    if (g.row !== walls.row || g.col !== walls.gapCol) return bad('門は城壁の行の切れ目に置く');
    gate = { side: g.side, col: g.col, row: g.row, win: g.win };
  } else if (walls) {
    return bad('城壁の切れ目には門を置く');
  }
  if (setup.skipZoneCheck !== undefined && !isSide(setup.skipZoneCheck)) return bad('skipZoneCheck が正しくない');
  if (!isDenseArray(setup.armies) || setup.armies.length !== 2) return bad('軍は2つ');
  const whole: Zone = { col: 0, row: 0, width: field.width, height: field.height };
  const taken = new Map<string, Side>();
  if (gate) taken.set(`${gate.col},${gate.row}`, gate.side);
  for (const side of [0, 1] as const) {
    const zone = setup.skipZoneCheck === side ? whole : field.zones[side];
    const errors = validateArmy(setup.armies[side] as Placement[], zone, { maxUnits: MAX_UNITS, requireHq });
    if (errors.length === 0) {
      // 城壁のマスには置けない。両軍のマス（と門のマス）も重ならない
      (setup.armies[side] as Placement[]).forEach((pl, index) => {
        if (field.terrain[pl.row * field.width + pl.col] === 'wall') errors.push({ code: 'on_wall', index, message: `城壁のマスには置けない: (${pl.col}, ${pl.row})` });
        const key = `${pl.col},${pl.row}`;
        if (taken.has(key)) errors.push({ code: 'overlap', index, message: `ほかの部隊（門・相手の軍）とマスが重なっている: (${pl.col}, ${pl.row})` });
        taken.set(key, side);
      });
    }
    if (errors.length > 0) {
      return { ok: false, error: { code: 'invalid_army', message: `陣営${side}の配置が正しくない`, side, armyErrors: errors } };
    }
  }

  const units: Unit[] = [];
  for (const side of [0, 1] as const) {
    for (const p of setup.armies[side]) {
      const stats = statsOf(p.kind);
      const f = frontOf(side);
      const x = p.col + 0.5;
      const y = p.row + 0.5;
      units.push({
        id: units.length,
        side,
        kind: p.kind,
        wing: wingOf(p.col, field, side),
        x,
        y,
        fx: f.x,
        fy: f.y,
        men: stats.men,
        maxMen: stats.men,
        morale: T.moraleMax,
        stance: p.stance,
        home: { x, y },
        status: 'active',
        goneReason: null,
        target: null,
        attacking: null,
        order: null,
        stats: { dealt: 0, taken: 0, flankDealt: 0, routsCaused: 0 },
        flankPhase: 1,
        flankEdgeX: 0,
        runup: 0,
        huntMoves: [],
        huntStuckOn: null,
        slideSign: 0,
        lastHitTick: null,
        routTick: null,
      });
    }
  }

  // 迂回の端：自分に近いほうの端。同じ近さなら、開戦時にその側にいる敵が少ないほう。それも同じなら自分から見て左。
  const half = field.width / 2;
  const leftEdge = T.flankEdgeOffset;
  const rightEdge = field.width - T.flankEdgeOffset;
  for (const u of units) {
    const dl = u.x;
    const dr = field.width - u.x;
    let toSmallX: boolean;
    if (Math.abs(dl - dr) > 1e-9) toSmallX = dl < dr;
    else {
      const enemies = units.filter((e) => e.side !== u.side);
      const small = enemies.filter((e) => e.x < half).length;
      const large = enemies.filter((e) => e.x > half).length;
      if (small !== large) toSmallX = small < large;
      else toSmallX = leftSignX(u.side) < 0;
    }
    u.flankEdgeX = toSmallX ? leftEdge : rightEdge;
  }

  // 迂回の②の行き先：開戦時の敵軍の重心の行より 1.5 マス奥。戦場に収まらなければ収まるところまで。
  const flankY: [number, number] = [0, 0];
  for (const side of [0, 1] as const) {
    const enemies = units.filter((e) => e.side !== side);
    if (enemies.length === 0) {
      flankY[side] = side === 0 ? T.flankEdgeOffset : field.height - T.flankEdgeOffset;
      continue;
    }
    const cy = enemies.reduce((s, e) => s + e.y, 0) / enemies.length;
    const y = side === 0 ? cy - T.flankDepth : cy + T.flankDepth;
    flankY[side] = Math.min(field.height - T.flankEdgeOffset, Math.max(T.flankEdgeOffset, y));
  }

  const initialMen: [number, number] = [0, 0];
  for (const u of units) initialMen[u.side] += u.men;

  // 門は、守る側の部隊として戦場に立つ（ほかの部隊の id のあとに置く）。開戦時の兵数・迂回の計算には数えない
  let gateState: BattleState['gate'] = null;
  if (gate) {
    const gx = gate.col + 0.5;
    const gy = gate.row + 0.5;
    const f = frontOf(gate.side);
    gateState = { ...gate, id: units.length };
    units.push({
      id: units.length,
      side: gate.side,
      kind: 'gate',
      wing: 'center',
      x: gx,
      y: gy,
      fx: f.x,
      fy: f.y,
      men: T.gateMen,
      maxMen: T.gateMen,
      morale: T.moraleMax,
      stance: 'hold',
      home: { x: gx, y: gy },
      status: 'active',
      goneReason: null,
      target: null,
      attacking: null,
      order: null,
      stats: { dealt: 0, taken: 0, flankDealt: 0, routsCaused: 0 },
      flankPhase: 1,
      flankEdgeX: gx,
      runup: 0,
      huntMoves: [],
      huntStuckOn: null,
      slideSign: 0,
      lastHitTick: null,
      routTick: null,
    });
  }

  const state: BattleState = {
    tick: 0,
    rng: rngFromSeed(setup.seed),
    field,
    units,
    ordersUsed: [0, 0],
    maxTicks: setup.maxTicks,
    timeout: setup.timeout,
    outcome: null,
    requireHq,
    initialMen,
    firstBroken: [null, null],
    scriptedOrders: scripted.sort((a, b) => a.tick - b.tick),
    scriptedNext: 0,
    brokenLastTick: [],
    flankY,
    gate: gateState,
  };
  return { ok: true, value: state };
}

// ---------------------------------------------------------------- 1刻み

/** 刻みの初めの状態の写し（判断はこれだけを見る） */
interface Snap {
  x: number;
  y: number;
  fx: number;
  fy: number;
  status: Unit['status'];
  target: number | null;
}

type Attack = 'melee' | 'arrow' | null;

interface Decision {
  target: number | null;
  attack: Attack;
  /** 動かない部隊（戦う部隊と、守備・堅守で持ち場にいる部隊） */
  anchor: boolean;
  /** 動く向き（単位ベクトル。動かないなら 0） */
  dx: number;
  dy: number;
  /** この刻みに動く上限の距離（行き先までの距離）。上限なしは Infinity */
  limit: number;
  /** 速さの倍率（突撃・敗走） */
  speedMult: number;
  /** 刻みの初めに、近接の距離に active な敵がいたか（騎兵の助走に使う） */
  hadMeleeEnemy: boolean;
  /** 後退中で、狙いにかかわらず動く向きを向く */
  faceMove: boolean;
  /** 敗走中（すり抜け、端に収めない） */
  routing: boolean;
  /** 本陣狙いで本陣へ向かって動く（詰まりの判定に、この刻みに動いた距離を数える） */
  huntMove: boolean;
}

interface Damage {
  attacker: number;
  defender: number;
  kind: AttackKind;
  facing: Facing;
  amount: number;
}

interface TickCtx {
  state: BattleState;
  snap: Snap[];
  t: number;
  /** 城壁（ない戦場は null） */
  walls: WallInfo | null;
  /** 刻みの初めに立っている門の id（ないか、もう破れていれば null） */
  gateUp: number | null;
  /**
   * 距離のしきい値（近接の距離）の比べ方の遊び。地形のある戦場では 1e-9、平地だけの戦場では 0。
   * 地形（速さ 0.5 倍など）で動く距離の刻みが変わると、鏡写しの位置どうしで浮動小数の丸めの差（1e-14 ほど）がしきい値をまたぎ、
   * 対称な戦場でも陣営で判定が分かれる。平地だけの戦場は、地形を入れる前と1刻みも変えない（T10）ため 0 のままにする
   */
  eps: number;
}

function isEnemy(a: Unit, b: Unit): boolean {
  return a.side !== b.side;
}

/** 防ぐ側 d から見た、攻める側 a の方向で向きを決める（刻みの初めの向きと位置で見る） */
function facingOf(snap: Snap[], defender: number, attacker: number): Facing {
  const d = snap[defender] as Snap;
  const a = snap[attacker] as Snap;
  const ang = angleBetween(d.fx, d.fy, a.x - d.x, a.y - d.y);
  if (ang <= T.frontAngle) return 'front';
  if (ang > T.rearAngle) return 'rear';
  return 'side';
}

function sd(ctx: TickCtx, a: number, b: number): number {
  const p = ctx.snap[a] as Snap;
  const q = ctx.snap[b] as Snap;
  return dist(p.x, p.y, q.x, q.y);
}

/** 後退で止まる行（配置エリアのいちばん奥の2行）に入っているか */
function inRetreatRows(state: BattleState, u: Unit, y: number): boolean {
  const z = state.field.zones[u.side];
  if (u.side === 0) return y >= z.row + z.height - T.retreatRows;
  return y < z.row + T.retreatRows;
}

/** 近接の距離にいる敵から、狙いを選ぶ：いまの狙いが届くなら変えない。そうでなければ、いまの向きにいちばん近い方向の敵。同じなら近いほう、それも同じなら id の小さいほう。 */
function pickMelee(ctx: TickCtx, u: Unit, meleeEnemies: number[], curInMelee: boolean): number {
  if (curInMelee && u.target !== null) return u.target;
  const s = ctx.snap[u.id] as Snap;
  let best = -1;
  let bestAng = Infinity;
  let bestD = Infinity;
  for (const id of meleeEnemies) {
    const e = ctx.snap[id] as Snap;
    const ang = angleBetween(s.fx, s.fy, e.x - s.x, e.y - s.y);
    const d = dist(s.x, s.y, e.x, e.y);
    if (ang < bestAng - 1e-9 || (Math.abs(ang - bestAng) <= 1e-9 && (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && id < best)))) {
      best = id;
      bestAng = ang;
      bestD = d;
    }
  }
  return best;
}

/** 弓兵が撃つ相手：撃てる距離にいる active な敵のうち、いちばん近い敵。いなければ、撃っていた敗走中の狙いが届く間は撃ち続ける。 */
function pickArrow(ctx: TickCtx, u: Unit): number | null {
  const { state } = ctx;
  const me = ctx.snap[u.id] as Snap;
  const range = terrainArcherRange(state.field, me);
  let best: number | null = null;
  let bestD = Infinity;
  for (const e of state.units) {
    // 弓兵は門を狙わない
    if (!isEnemy(u, e) || isGate(e) || (ctx.snap[e.id] as Snap).status !== 'active') continue;
    const d = sd(ctx, u.id, e.id);
    if (d > range || !terrainArrowClear(state.field, me, ctx.snap[e.id] as Snap)) continue;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && e.id < best)) {
      best = e.id;
      bestD = d;
    }
  }
  if (best !== null) return best;
  const cur = (ctx.snap[u.id] as Snap).target;
  if (cur !== null) {
    if ((ctx.snap[cur] as Snap).status === 'routing' && sd(ctx, u.id, cur) <= range && terrainArrowClear(state.field, me, ctx.snap[cur] as Snap)) return cur;
  }
  return null;
}

/** 条件に合う active な敵のうち、いちばん近い敵（同じなら id の小さいほう） */
function nearestEnemy(ctx: TickCtx, u: Unit, filter: (e: Unit) => boolean, maxD = Infinity): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const e of ctx.state.units) {
    if (!isEnemy(u, e) || isGate(e) || (ctx.snap[e.id] as Snap).status !== 'active' || !filter(e)) continue;
    const d = sd(ctx, u.id, e.id);
    if (d > maxD) continue;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && e.id < best)) {
      best = e.id;
      bestD = d;
    }
  }
  return best;
}

function enemyHq(ctx: TickCtx, u: Unit): number | null {
  for (const e of ctx.state.units) {
    if (isEnemy(u, e) && e.kind === 'hq' && (ctx.snap[e.id] as Snap).status === 'active') return e.id;
  }
  return null;
}

function emptyDecision(): Decision {
  return {
    target: null,
    attack: null,
    anchor: false,
    dx: 0,
    dy: 0,
    limit: Infinity,
    speedMult: 1,
    hadMeleeEnemy: false,
    faceMove: false,
    routing: false,
    huntMove: false,
  };
}

function setDir(d: Decision, vx: number, vy: number, limit = Infinity): void {
  const n = normalize(vx, vy);
  if (!n) {
    d.dx = 0;
    d.dy = 0;
    return;
  }
  d.dx = n.x;
  d.dy = n.y;
  d.limit = limit;
}

/** 前進の狙い：距離 + 横のずれ がいちばん小さい敵。いまの狙いは、ほかの敵が 1.0 以上小さくならない限り変えない */
function pickAdvance(ctx: TickCtx, u: Unit): number | null {
  const chosen = pickAdvanceOrdinary(ctx, u);
  // 門が立っている間、城壁の反対側に狙いを持つ前進の部隊は、狙いを門に替える（門を破らないと先へ進めない）
  if (chosen !== null && ctx.gateUp !== null && ctx.walls && isEnemy(u, ctx.state.units[ctx.gateUp] as Unit)) {
    const s = ctx.snap[u.id] as Snap;
    const e = ctx.snap[chosen] as Snap;
    const a = sideOfWall(ctx.walls, s.y);
    const b = sideOfWall(ctx.walls, e.y);
    if (a !== 0 && b !== a) return ctx.gateUp;
  }
  return chosen;
}

function pickAdvanceOrdinary(ctx: TickCtx, u: Unit): number | null {
  const s = ctx.snap[u.id] as Snap;
  // 距離は、城壁の反対側の敵については、門のマスの中心を通る折れ線の長さ
  const score = (id: number): number => {
    const e = ctx.snap[id] as Snap;
    return pathLength(ctx.walls, s.x, s.y, e.x, e.y) + Math.abs(e.x - s.x);
  };
  let best: number | null = null;
  let bestScore = Infinity;
  for (const e of ctx.state.units) {
    if (!isEnemy(u, e) || isGate(e) || (ctx.snap[e.id] as Snap).status !== 'active') continue;
    const sc = score(e.id);
    if (sc < bestScore - 1e-9 || (Math.abs(sc - bestScore) <= 1e-9 && best !== null && e.id < best)) {
      best = e.id;
      bestScore = sc;
    }
  }
  const cur = s.target;
  if (cur !== null && best !== null && cur !== best && !isGate(ctx.state.units[cur] as Unit)) {
    const c = ctx.state.units[cur] as Unit;
    // ほかの敵の値が 1.0 以上小さければ切り替える（ちょうど 1.0 小さいときも切り替える）
    if (isEnemy(u, c) && (ctx.snap[cur] as Snap).status === 'active' && !(bestScore <= score(cur) - T.advanceSwitchMargin + 1e-9)) {
      return cur;
    }
  }
  return best;
}

/** 方針に沿った「戦わないときの」動き。passing は、正面にいない近接の敵とは戦わずに進むかどうか */
interface Plan {
  target: number | null;
  vx: number;
  vy: number;
  limit: number;
  passing: boolean;
  /** 守備で持ち場にいる（錨になる） */
  atHome: boolean;
  /** 本陣狙いで、敵の本陣へ向かっている */
  hunt?: boolean;
}

/** 行き先 (dx, dy) へ向かう向き。城壁をはさむときは通り道（門の手前 → 門 → 行き先）の、いま向かう点へ */
function steer(ctx: TickCtx, s: Snap, dx: number, dy: number, limit: number): { vx: number; vy: number; limit: number } {
  const w = routeTo(ctx.walls, s.x, s.y, dx, dy);
  if (!w.waypoint) return { vx: dx - s.x, vy: dy - s.y, limit };
  return { vx: w.x - s.x, vy: w.y - s.y, limit: Math.min(limit, Math.hypot(w.x - s.x, w.y - s.y)) };
}

function planAdvance(ctx: TickCtx, u: Unit): Plan {
  const s = ctx.snap[u.id] as Snap;
  const target = pickAdvance(ctx, u);
  if (target === null) return { target: null, vx: 0, vy: 0, limit: Infinity, passing: false, atHome: false };
  const e = ctx.snap[target] as Snap;
  const v = steer(ctx, s, e.x, e.y, Infinity);
  return { target, vx: v.vx, vy: v.vy, limit: v.limit, passing: false, atHome: false };
}

function planMove(ctx: TickCtx, u: Unit, stance: Unit['stance']): Plan {
  const s = ctx.snap[u.id] as Snap;
  switch (stance) {
    case 'advance':
      return planAdvance(ctx, u);
    case 'hold': {
      const target = nearestEnemy(ctx, u, () => true, T.holdWatchRange);
      const dh = dist(s.x, s.y, u.home.x, u.home.y);
      if (dh > T.homeTolerance) {
        const v = steer(ctx, s, u.home.x, u.home.y, dh);
        return { target, vx: v.vx, vy: v.vy, limit: v.limit, passing: false, atHome: false };
      }
      return { target, vx: 0, vy: 0, limit: Infinity, passing: false, atHome: true };
    }
    case 'flank': {
      let fy = ctx.state.flankY[u.side];
      // 城壁のある戦場では、①②を自分の側だけで行い、③で前進と同じになる
      if (ctx.walls) {
        const side = sideOfWall(ctx.walls, s.y);
        if (side !== 0 && sideOfWall(ctx.walls, fy) !== side) fy = side < 0 ? ctx.walls.row - 0.5 : ctx.walls.row + 1.5;
        if (u.flankPhase === 3) return planAdvance(ctx, u);
      }
      if (u.flankPhase === 1 && Math.abs(s.x - u.flankEdgeX) <= T.waypointTolerance) u.flankPhase = 2;
      if (u.flankPhase === 2) {
        const reached = u.side === 0 ? s.y <= fy + T.waypointTolerance : s.y >= fy - T.waypointTolerance;
        if (reached) u.flankPhase = 3;
        if (reached && ctx.walls) return planAdvance(ctx, u);
      }
      if (u.flankPhase === 1) {
        const dx = u.flankEdgeX - s.x;
        return { target: null, vx: dx, vy: 0, limit: Math.abs(dx), passing: true, atHome: false };
      }
      if (u.flankPhase === 2) {
        const dx = u.flankEdgeX - s.x;
        const dy = fy - s.y;
        return { target: null, vx: dx, vy: dy, limit: Math.hypot(dx, dy), passing: true, atHome: false };
      }
      // ③ 本陣以外でいちばん近い敵（本陣しか残っていなければ本陣）
      let target = nearestEnemy(ctx, u, (e) => e.kind !== 'hq');
      if (target === null) target = nearestEnemy(ctx, u, () => true);
      if (target === null) return { target: null, vx: 0, vy: 0, limit: Infinity, passing: false, atHome: false };
      const e = ctx.snap[target] as Snap;
      const v = steer(ctx, s, e.x, e.y, Infinity);
      return { target, vx: v.vx, vy: v.vy, limit: v.limit, passing: false, atHome: false };
    }
    case 'hunt': {
      // 敵の本陣へまっすぐ向かう。途中の敵にぶつかったら、④の決まり（手前で止まり、接線に回る）で列に沿って滑る。
      const hq = enemyHq(ctx, u);
      if (hq === null) return planAdvance(ctx, u);
      const h = ctx.snap[hq] as Snap;
      const v = steer(ctx, s, h.x, h.y, Infinity);
      return { target: hq, vx: v.vx, vy: v.vy, limit: v.limit, passing: false, atHome: false, hunt: true };
    }
  }
}

function decide(ctx: TickCtx, u: Unit): Decision {
  const { state } = ctx;
  const d = emptyDecision();
  const s = ctx.snap[u.id] as Snap;
  if (s.status === 'routing') {
    // 敗走：自陣の奥へまっすぐ、速さ 1.3 倍。敗走した次の刻みから動く（この刻みの初めにはもう routing なので動く）。
    const back = frontOf(u.side);
    d.dx = -back.x;
    d.dy = -back.y;
    d.speedMult = T.routSpeedMult;
    d.routing = true;
    return d;
  }
  if (s.status !== 'active') return d;
  // 門は動かない、攻撃しない、向きを変えない
  if (isGate(u)) {
    d.anchor = true;
    return d;
  }

  // 近接の距離にいる敵（門は別に数える：門と戦うのは、門を狙っているとき・詰まったときだけ）
  const meleeEnemies: number[] = [];
  for (const e of state.units) {
    if (!isEnemy(u, e) || isGate(e) || (ctx.snap[e.id] as Snap).status !== 'active') continue;
    if (sd(ctx, u.id, e.id) <= T.meleeRange + ctx.eps) meleeEnemies.push(e.id);
  }
  // 門は大きな構えなので、門を攻めるときだけ、近接が届く距離を gateReach にする（門の前に3部隊ほどが並んで攻められる）
  const gateInMelee = ctx.gateUp !== null && isEnemy(u, state.units[ctx.gateUp] as Unit) && sd(ctx, u.id, ctx.gateUp) <= T.gateReach + ctx.eps;
  d.hadMeleeEnemy = meleeEnemies.length > 0;
  const cur = s.target;
  const curInMelee =
    cur !== null &&
    isEnemy(u, state.units[cur] as Unit) &&
    !isGate(state.units[cur] as Unit) &&
    (ctx.snap[cur] as Snap).status !== 'gone' &&
    sd(ctx, u.id, cur) <= T.meleeRange + ctx.eps;
  const hasMelee = meleeEnemies.length > 0 || curInMelee;
  const order = u.order?.kind ?? null;

  // 後退の号令：下がっている間は戦わず、撃たない。奥の2行に入ったら、堅守と同じ動き（倍率なし）。
  let staticMode = order === 'brace';
  if (order === 'retreat') {
    if (!inRetreatRows(state, u, s.y)) {
      const back = frontOf(u.side);
      d.dx = -back.x;
      d.dy = -back.y;
      d.faceMove = true;
      return d;
    }
    staticMode = true;
  }

  if (staticMode) {
    d.anchor = true;
    if (hasMelee) {
      d.target = pickMelee(ctx, u, meleeEnemies, curInMelee);
      d.attack = 'melee';
    } else if (u.kind === 'archer' && (d.target = pickArrow(ctx, u)) !== null) {
      d.attack = 'arrow';
    } else {
      // 向くだけ：守備と同じく、4マス以内のいちばん近い敵
      d.target = nearestEnemy(ctx, u, () => true, T.holdWatchRange);
    }
    return d;
  }

  const stance = order === 'charge' ? 'advance' : u.stance;
  if (order === 'charge') d.speedMult = T.chargeSpeedMult;
  const plan = planMove(ctx, u, stance);

  if (plan.hunt && plan.target !== null) {
    // 本陣狙い：本陣以外の敵とは、正面にいても戦わない。戦うのは、狙い（敵の本陣）が近接の距離に入ったときだけ。
    const hq = plan.target;
    const fightWith = (id: number): Decision => {
      d.anchor = true;
      d.target = id;
      d.attack = 'melee';
      return d;
    };
    if (meleeEnemies.includes(hq)) return fightWith(hq);
    // 弓兵は、近接の距離にふつうの敵がいなければ、撃てる敵を撃つ（兵種ごとの違いが方針より先）。門と戦っている途中・詰まって戦い始めるときも同じ。
    // 詰まって戦っている相手（huntStuckOn）は覚えたままにし、撃てる敵がいなくなったら、また戦う
    if (u.kind === 'archer' && meleeEnemies.length === 0) {
      const t = pickArrow(ctx, u);
      if (t !== null) {
        d.anchor = true;
        d.target = t;
        d.attack = 'arrow';
        return d;
      }
    }
    // 詰まって戦っている相手がまだ近接の距離にいれば、戦い続ける。消えたか離れたら、また本陣へ向かう
    // 門の前で止められたときも、詰まったときの決まりで門と戦う
    const stuckCandidates = gateInMelee && ctx.gateUp !== null ? [...meleeEnemies, ctx.gateUp] : meleeEnemies;
    if (u.huntStuckOn !== null) {
      if (stuckCandidates.includes(u.huntStuckOn)) return fightWith(u.huntStuckOn);
      u.huntStuckOn = null;
      u.huntMoves = [];
    }
    // 続けて2秒のあいだ、動いた距離が 0.3 マスに満たなければ「詰まった」として、近接の距離のいちばん近い敵と戦う。
    // 動いた距離は、2秒のあいだの差し引き（いまの位置と2秒前の位置の距離）で見る。押し合いで小刻みに揺れる分を数えると、
    // その場から進めていないのに「動いている」ことになり、詰まりを見落とすため。
    let mx = 0;
    let my = 0;
    for (const m of u.huntMoves) {
      mx += m[0];
      my += m[1];
    }
    const moved = Math.hypot(mx, my);
    if (u.huntMoves.length >= T.huntStuckTicks && moved < T.huntStuckDist && stuckCandidates.length > 0) {
      let best = stuckCandidates[0] as number;
      for (const id of stuckCandidates) {
        const dd = sd(ctx, u.id, id);
        const db = sd(ctx, u.id, best);
        if (dd < db - 1e-9 || (Math.abs(dd - db) <= 1e-9 && id < best)) best = id;
      }
      u.huntStuckOn = best;
      u.huntMoves = [];
      return fightWith(best);
    }
    d.huntMove = true;
  } else if (hasMelee) {
    let fight = true;
    if (plan.passing) {
      // 迂回の①②は、進む向きの正面（±50°）に近接の敵がいなければ戦わずに進む
      fight = meleeEnemies.some((id) => {
        const e = ctx.snap[id] as Snap;
        return angleBetween(plan.vx, plan.vy, e.x - s.x, e.y - s.y) <= T.passFrontAngle;
      });
    }
    if (fight) {
      d.anchor = true;
      d.target = pickMelee(ctx, u, meleeEnemies, curInMelee && (!plan.passing || meleeEnemies.includes(cur as number)));
      if (d.target < 0) d.target = pickMelee(ctx, u, meleeEnemies, false);
      d.attack = 'melee';
      return d;
    }
  }

  // 弓兵は、近接で戦わないときは撃つ（迂回の①②は撃たずに進む）
  if (u.kind === 'archer' && !(stance === 'flank' && u.flankPhase !== 3)) {
    const t = pickArrow(ctx, u);
    if (t !== null) {
      d.anchor = true;
      d.target = t;
      d.attack = 'arrow';
      return d;
    }
  }

  // 狙いが門で、門が近接の距離に入ったら、門と戦う（近接の距離にふつうの敵がいるときは、上でその敵と戦っている。弓兵は、撃てる敵がいる間は上で撃っている）
  if (plan.target !== null && plan.target === ctx.gateUp && gateInMelee && !plan.hunt) {
    d.anchor = true;
    d.target = plan.target;
    d.attack = 'melee';
    return d;
  }

  d.target = plan.target;
  if (plan.atHome) d.anchor = true;
  setDir(d, plan.vx, plan.vy, plan.limit);
  return d;
}

/**
 * 動きたい分 (mx, my) を、刻みの初めの位置にいるほかの active な部隊にぶつからないように直す。
 * 0.9 以内に入るなら手前で止まり、残りの分の半分を、相手のまわりを回る向き（接線）に進む。
 */
function resolveMove(ctx: TickCtx, u: Unit, mx: number, my: number, target: number | null, keepSlide = false): { x: number; y: number } {
  const s = ctx.snap[u.id] as Snap;
  const L = Math.hypot(mx, my);
  if (L < 1e-12) return { x: s.x, y: s.y };
  const r = T.spacing;
  let hitS = Infinity;
  let hitId = -1;
  // すでに近すぎる相手が複数いるときは、いちばん近い相手で止まる（id の順で選ぶと、陣営で結果が変わるため）
  let overlapD = Infinity;
  for (const o of ctx.state.units) {
    if (o.id === u.id || (ctx.snap[o.id] as Snap).status !== 'active') continue;
    const os = ctx.snap[o.id] as Snap;
    const px = s.x - os.x;
    const py = s.y - os.y;
    const c = px * px + py * py - r * r;
    const b = px * mx + py * my;
    if (c < 0) {
      // すでに近すぎる：近づく向きなら、その場で止まる
      const d2 = px * px + py * py;
      if (b < 0 && (d2 < overlapD - 1e-12 || (Math.abs(d2 - overlapD) <= 1e-12 && o.id < hitId))) {
        hitS = 0;
        hitId = o.id;
        overlapD = d2;
      }
      continue;
    }
    if (hitS === 0) continue;
    const a = mx * mx + my * my;
    const disc = b * b - a * c;
    if (disc < 0) continue;
    const sHit = (-b - Math.sqrt(disc)) / a;
    if (sHit >= 0 && sHit <= 1 && (sHit < hitS - 1e-12 || (Math.abs(sHit - hitS) <= 1e-12 && o.id < hitId))) {
      hitS = sHit;
      hitId = o.id;
    }
  }
  if (hitId < 0) {
    // 何にもぶつからずに動けたら、回る向きの記憶を消す
    if (keepSlide) u.slideSign = 0;
    return { x: s.x + mx, y: s.y + my };
  }
  const cx = s.x + mx * hitS;
  const cy = s.y + my * hitS;
  const rest = (1 - hitS) * L * 0.5;
  const os = ctx.snap[hitId] as Snap;
  const n = normalize(cx - os.x, cy - os.y);
  if (!n || rest < 1e-12) return { x: cx, y: cy };
  // 接線の2つの向きのうち、動きたい向きに近いほう。真正面なら、狙いのある側、それも同じなら左。
  const t1 = { x: -n.y, y: n.x };
  const dot = (t1.x * mx + t1.y * my) / L;
  let tx: number;
  let ty: number;
  // ぶつかった相手が味方で、保った回る側の接線が動きたい向きと反対（後ろ向き）になったら、保つのをやめて決め直す
  // （詰まった味方どうしで回り合って下がり続けないように。敵の列に沿って滑るときは、つなぎ目で後ろ向きになっても保つ）
  const keptBackward = keepSlide && u.slideSign !== 0 && (ctx.state.units[hitId] as Unit).side === u.side && (() => {
    const left = sideSign(mx, my, t1.x, t1.y) >= 0;
    const sg = left === (u.slideSign > 0) ? 1 : -1;
    return (t1.x * sg * mx + t1.y * sg * my) / L < -1e-9;
  })();
  if (keepSlide && u.slideSign !== 0 && !keptBackward) {
    // 本陣狙い：ぶつかり続けている間は、最初に決めた回る側（動きたい向きの左か右か）を保つ。
    // 敵の列にぶつかると、相手が隣の部隊へ次々に変わる。相手ごとに向きを決め直すと、隣どうしのすき間で
    // 左右に行き来して挟まるため、同じ側へ滑り続けて列の端か穴まで進ませる
    const left = sideSign(mx, my, t1.x, t1.y) >= 0;
    const sign = left === (u.slideSign > 0) ? 1 : -1;
    tx = t1.x * sign;
    ty = t1.y * sign;
  } else if (Math.abs(dot) > 1e-6) {
    const sign = dot > 0 ? 1 : -1;
    tx = t1.x * sign;
    ty = t1.y * sign;
  } else {
    let goLeft = true;
    if (target !== null) {
      const ts = ctx.snap[target] as Snap;
      const side = sideSign(mx, my, ts.x - s.x, ts.y - s.y);
      if (side < -1e-9) goLeft = false;
    }
    const l = leftOf(mx / L, my / L);
    tx = goLeft ? l.x : -l.x;
    ty = goLeft ? l.y : -l.y;
  }
  if (keepSlide) u.slideSign = sideSign(mx, my, tx, ty) >= 0 ? 1 : -1;
  return { x: cx + tx * rest, y: cy + ty * rest };
}

/** 重なりをほどく。2回くり返し、各回の初めの位置で計算して同時に適用する。 */
function separate(state: BattleState, anchors: boolean[]): void {
  const act = state.units.filter((u) => u.status === 'active');
  for (let iter = 0; iter < 2; iter++) {
    const px = act.map((u) => u.x);
    const py = act.map((u) => u.y);
    const ox = new Array<number>(act.length).fill(0);
    const oy = new Array<number>(act.length).fill(0);
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i] as Unit;
        const b = act[j] as Unit;
        const dx = (px[j] as number) - (px[i] as number);
        const dy = (py[j] as number) - (py[i] as number);
        const d = Math.hypot(dx, dy);
        if (d >= T.spacing) continue;
        const aa = anchors[a.id] ?? false;
        const ba = anchors[b.id] ?? false;
        if (aa && ba) continue;
        const overlap = T.spacing - d;
        let nx: number;
        let ny: number;
        if (d < 1e-12) {
          // 位置がまったく同じ：id の小さいほうを左（x の小さいほう）、大きいほうを右へ
          const lo = a.id < b.id ? i : j;
          nx = lo === i ? 1 : -1; // i → j の向き
          ny = 0;
        } else {
          nx = dx / d;
          ny = dy / d;
        }
        // n は i から j への向き
        if (aa) {
          ox[j] = (ox[j] as number) + nx * overlap;
          oy[j] = (oy[j] as number) + ny * overlap;
        } else if (ba) {
          ox[i] = (ox[i] as number) - nx * overlap;
          oy[i] = (oy[i] as number) - ny * overlap;
        } else {
          ox[i] = (ox[i] as number) - (nx * overlap) / 2;
          oy[i] = (oy[i] as number) - (ny * overlap) / 2;
          ox[j] = (ox[j] as number) + (nx * overlap) / 2;
          oy[j] = (oy[j] as number) + (ny * overlap) / 2;
        }
      }
    }
    for (let i = 0; i < act.length; i++) {
      const u = act[i] as Unit;
      u.x = (px[i] as number) + (ox[i] as number);
      u.y = (py[i] as number) + (oy[i] as number);
    }
  }
}

function clampInside(state: BattleState, u: Unit): void {
  const m = T.edgeMargin;
  const { width, height } = state.field;
  u.x = Math.min(width - m, Math.max(m, u.x));
  u.y = Math.min(height - m, Math.max(m, u.y));
}

function rand(state: BattleState): number {
  const [v, next] = nextFloat(state.rng);
  state.rng = next;
  return T.randomMin + (T.randomMax - T.randomMin) * v;
}

/** 受ける側の倍率のうち、号令によるもの */
function orderTakenMult(u: Unit): number {
  if (u.order?.kind === 'charge') return T.chargeTakenMult;
  if (u.order?.kind === 'brace') return T.braceTakenMult;
  return 1;
}

function attackerOrderMult(u: Unit): number {
  return u.order?.kind === 'charge' ? T.chargeAttackMult : 1;
}

function meleeDamage(state: BattleState, snap: Snap[], a: Unit, def: Unit): Damage {
  const facing = facingOf(snap, def.id, a.id);
  let v = statsOf(a.kind).melee * Math.sqrt(Math.max(0, a.men) / a.maxMen) * rand(state) * attackerOrderMult(a);
  if (def.kind === 'archer') {
    if (a.kind === 'cavalry') v *= T.cavalryVsArcher;
    if (a.kind === 'infantry') v *= T.infantryVsArcher;
  }
  v *= def.kind === 'shield' && facing === 'front' ? T.shieldFrontMelee : T.facingMult[facing];
  if (def.kind === 'hq') v *= T.hqTakenMult;
  if (def.kind === 'archer') v *= T.archerMeleeTakenMult;
  v *= orderTakenMult(def);
  v *= terrainDamageMult(state.field, snap[a.id] as Snap, snap[def.id] as Snap, 'melee');
  return { attacker: a.id, defender: def.id, kind: 'melee', facing, amount: v * DT };
}

/** 門への損害：攻撃 × √(兵数の割合) × ばらつき × 攻める側の倍率（突撃の号令、丘、川）。向きと受ける側の倍率はかけない */
function gateDamage(state: BattleState, snap: Snap[], a: Unit, gate: Unit): Damage {
  let v = statsOf(a.kind).melee * Math.sqrt(Math.max(0, a.men) / a.maxMen) * rand(state) * attackerOrderMult(a);
  v *= terrainDamageMult(state.field, snap[a.id] as Snap, snap[gate.id] as Snap, 'melee', false);
  return { attacker: a.id, defender: gate.id, kind: 'melee', facing: 'front', amount: v * DT };
}

function arrowDamage(state: BattleState, snap: Snap[], a: Unit, def: Unit): Damage {
  const facing = facingOf(snap, def.id, a.id);
  let v = T.arrowDamage * Math.sqrt(Math.max(0, a.men) / a.maxMen) * rand(state) * attackerOrderMult(a);
  if (def.kind === 'shield' && facing === 'front') v *= T.shieldFrontArrow;
  if (def.kind === 'hq') v *= T.hqTakenMult;
  v *= orderTakenMult(def);
  v *= terrainDamageMult(state.field, snap[a.id] as Snap, snap[def.id] as Snap, 'arrow');
  return { attacker: a.id, defender: def.id, kind: 'arrow', facing, amount: v * DT };
}

function impactDamage(state: BattleState, snap: Snap[], a: Unit, def: Unit): Damage {
  const facing = facingOf(snap, def.id, a.id);
  let v = T.impactDamage * Math.sqrt(Math.max(0, a.men) / a.maxMen) * attackerOrderMult(a);
  v *= def.kind === 'shield' && facing === 'front' ? T.shieldFrontImpact : T.facingMult[facing];
  if (def.kind === 'hq') v *= T.hqTakenMult;
  if (def.kind === 'archer') v *= T.archerMeleeTakenMult;
  v *= orderTakenMult(def);
  v *= terrainDamageMult(state.field, snap[a.id] as Snap, snap[def.id] as Snap, 'impact');
  return { attacker: a.id, defender: def.id, kind: 'impact', facing, amount: v };
}

/** 士気の減りの「支え」の倍率（刻みの初めの位置で数える） */
function supportMult(ctx: TickCtx, u: Unit): number {
  let allies = 0;
  let hqNear = false;
  for (const o of ctx.state.units) {
    if (o.id === u.id || o.side !== u.side || isGate(o) || (ctx.snap[o.id] as Snap).status !== 'active') continue;
    const d = sd(ctx, u.id, o.id);
    if (d <= T.supportRange) allies++;
    if (o.kind === 'hq' && d <= T.hqSupportRange) hqNear = true;
  }
  let m = 1 - T.supportPerAlly * Math.min(T.supportMaxAllies, allies);
  if (hqNear && u.kind !== 'hq') m *= T.hqSupportMult;
  if (u.order?.kind === 'brace') m *= T.braceMoraleMult;
  return m;
}

function pushEvent(events: BattleEvent[], e: BattleEvent): void {
  events.push(e);
}

/**
 * 1刻み進める。決着後は何もしない。渡された状態を書き換え、この刻みの出来事を返す。
 * state は「createBattle が作り、step だけが書き換え、JSON にして戻しただけのもの」を前提とし、中身の全検査はしない
 * （サーバーは利用者から状態を受け取らない）。orders は利用者の入力なので、配列でない・先頭の
 * MAX_ORDERS_PER_STEP 件より後ろ・形や名前が正しくない号令は無視し、状態を変えない。
 */
export function step(state: BattleState, orders: readonly OrderInput[]): BattleEvent[] {
  const events: BattleEvent[] = [];
  if (state.outcome) return events;
  const t = state.tick;
  const n = state.units.length;
  const moraleDelta = new Array<number>(n).fill(0);

  // ① 号令を受け付ける（予定された号令を先に、続けて渡された号令を配列の順に）
  const incoming: OrderInput[] = [];
  const sc = state.scriptedOrders;
  while (state.scriptedNext < sc.length && (sc[state.scriptedNext] as ScriptedOrder).tick < t) state.scriptedNext++;
  while (state.scriptedNext < sc.length && (sc[state.scriptedNext] as ScriptedOrder).tick === t) {
    const o = sc[state.scriptedNext] as ScriptedOrder;
    incoming.push({ side: o.side, target: o.target, kind: o.kind });
    state.scriptedNext++;
  }
  if (Array.isArray(orders)) {
    const n = Math.min(orders.length, MAX_ORDERS_PER_STEP);
    for (let i = 0; i < n; i++) {
      const o: unknown = orders[i];
      if (isObject(o) && isSide(o.side) && isOrderTarget(o.target) && isOrderKind(o.kind)) incoming.push({ side: o.side, target: o.target, kind: o.kind });
    }
  }
  for (const o of incoming) {
    if (applyOrder(state, o.side, o.target, o.kind, moraleDelta)) {
      pushEvent(events, { type: 'order', tick: t, side: o.side, target: o.target, kind: o.kind });
    }
  }

  // ② 切れた号令を外す
  for (const u of state.units) if (u.order && t >= u.order.untilTick) endOrder(u);

  const snap: Snap[] = state.units.map((u) => ({ x: u.x, y: u.y, fx: u.fx, fy: u.fy, status: u.status, target: u.target }));
  // 城壁は門のある戦場だけ（createBattle で調べ済み）。門が破れたあとは、崩れた3マスのうち自分の x にいちばん近い列を通る
  const gateUp = state.gate && (state.units[state.gate.id] as Unit).status === 'active' ? state.gate.id : null;
  const walls = state.gate ? wallsOfGate(state.gate, gateUp === null, state.field.width) : null;
  const eps = hasTerrain(state.field) ? 1e-9 : 0;
  const ctx: TickCtx = { state, snap, t, walls, gateUp, eps };

  // ③ 狙いと動く向きを決める
  const decisions = state.units.map((u) => decide(ctx, u));
  for (const u of state.units) {
    const d = decisions[u.id] as Decision;
    if (u.status === 'active') u.target = d.target;
  }

  // ④ 動く
  const anchors = decisions.map((d) => d.anchor);
  const newPos: { x: number; y: number }[] = state.units.map((u) => ({ x: u.x, y: u.y }));
  for (const u of state.units) {
    const d = decisions[u.id] as Decision;
    if (u.status === 'gone' || d.anchor || (d.dx === 0 && d.dy === 0)) continue;
    const speed = statsOf(u.kind).speed * d.speedMult * terrainSpeedMult(state.field, u.kind, snap[u.id] as Snap);
    const step = Math.min(speed * DT, d.limit);
    const mx = d.dx * step;
    const my = d.dy * step;
    if (d.routing) newPos[u.id] = { x: u.x + mx, y: u.y + my };
    else newPos[u.id] = resolveMove(ctx, u, mx, my, d.target, d.huntMove);
  }
  for (const u of state.units) {
    const p = newPos[u.id] as { x: number; y: number };
    u.x = p.x;
    u.y = p.y;
  }
  separate(state, anchors);
  for (const u of state.units) if (u.status === 'active') clampInside(state, u);
  // 城壁のマスからも押し出す（動き・滑り・重なりをほどく処理のあとで、必ず行う。部隊どうしの間隔より優先する）
  if (ctx.walls) {
    for (const u of state.units) {
      if (u.status !== 'active' || isGate(u)) continue;
      pushOutOfWalls(ctx.walls, state.field, u, (snap[u.id] as Snap).y);
      clampInside(state, u);
    }
  }
  for (const u of state.units) {
    const d = decisions[u.id] as Decision;
    const s = snap[u.id] as Snap;
    if (u.kind === 'cavalry' && u.status === 'active' && !d.hadMeleeEnemy) {
      // 助走は「続けて動いた距離」。この刻みに動かなかったら 0 に戻す（止まって待ってから突入しないように）
      const moved = dist(s.x, s.y, u.x, u.y);
      u.runup = moved < T.runupStillDist ? 0 : u.runup + moved;
    }
    // 本陣狙いの詰まりの判定：本陣へ向かって動いた刻みの距離を、直近の huntStuckTicks 刻みぶん持つ
    if (u.status === 'active' && d.huntMove && !d.anchor) {
      u.huntMoves.push([u.x - s.x, u.y - s.y]);
      if (u.huntMoves.length > T.huntStuckTicks) u.huntMoves.shift();
    } else if (u.huntMoves.length > 0) {
      u.huntMoves = [];
    }
  }

  // ⑤ 向きを変える
  for (const u of state.units) {
    if (u.status === 'gone' || isGate(u)) continue;
    const d = decisions[u.id] as Decision;
    const s = snap[u.id] as Snap;
    let gx = 0;
    let gy = 0;
    if (d.routing || d.faceMove) {
      gx = d.dx;
      gy = d.dy;
    } else if (d.target !== null) {
      const ts = snap[d.target] as Snap;
      gx = ts.x - s.x;
      gy = ts.y - s.y;
    } else if (d.dx !== 0 || d.dy !== 0) {
      gx = d.dx;
      gy = d.dy;
    } else {
      const f = frontOf(u.side);
      gx = f.x;
      gy = f.y;
    }
    const r = rotateToward(u.fx, u.fy, gx, gy, statsOf(u.kind).turn * DT);
    u.fx = r.x;
    u.fy = r.y;
  }

  // ⑥ 戦う（刻みの初めの位置・向きで見る。ばらつきの乱数は攻める側の id の順に引く）
  const damages: Damage[] = [];
  const shocks: { defender: number; amount: number }[] = [];
  const bounced: number[] = [];
  // attacking は「この刻みに実際に攻撃した相手」。狙いに向かっているだけの部隊は null のまま
  for (const u of state.units) u.attacking = null;
  for (const a of state.units) {
    const d = decisions[a.id] as Decision;
    if ((snap[a.id] as Snap).status !== 'active' || d.attack === null || d.target === null) continue;
    const def = state.units[d.target] as Unit;
    if ((snap[def.id] as Snap).status === 'gone') continue;
    a.attacking = def.id;
    if (d.attack === 'melee' && isGate(def)) {
      // 門：近接だけで、突入は受けない。突入が起きなくても助走は 0 に戻る
      if (a.kind === 'cavalry') a.runup = 0;
      damages.push(gateDamage(state, snap, a, def));
    } else if (d.attack === 'melee') {
      if (a.kind === 'cavalry' && a.runup >= T.impactRunup && terrainAllowsImpact(state.field, snap[a.id] as Snap, snap[def.id] as Snap)) {
        const imp = impactDamage(state, snap, a, def);
        damages.push(imp);
        const bounce = def.kind === 'shield' && imp.facing === 'front';
        if (bounce) bounced.push(a.id);
        else {
          const brace = def.order?.kind === 'brace' ? T.braceMoraleMult : 1;
          shocks.push({ defender: def.id, amount: T.impactShock[imp.facing] * brace });
        }
        pushEvent(events, { type: 'impact', tick: t, attacker: a.id, defender: def.id, facing: imp.facing });
      }
      if (a.kind === 'cavalry') a.runup = 0;
      damages.push(meleeDamage(state, snap, a, def));
    } else {
      damages.push(arrowDamage(state, snap, a, def));
    }
  }
  for (const u of state.units) {
    const d = decisions[u.id] as Decision;
    if (u.kind === 'cavalry' && d.hadMeleeEnemy) u.runup = 0;
  }

  // ⑦ 兵数と士気をまとめて動かす
  const incomingSum = new Array<number>(n).fill(0);
  for (const dm of damages) incomingSum[dm.defender] = (incomingSum[dm.defender] ?? 0) + dm.amount;
  const scale = state.units.map((u) => {
    const sum = incomingSum[u.id] as number;
    return sum > u.men && sum > 0 ? Math.max(0, u.men) / sum : 1;
  });
  const menLoss = new Array<number>(n).fill(0);
  const support = state.units.map((u) => (u.status === 'active' ? supportMult(ctx, u) : 1));
  for (const dm of damages) {
    const applied = dm.amount * (scale[dm.defender] as number);
    if (applied <= 0) continue;
    menLoss[dm.defender] = (menLoss[dm.defender] ?? 0) + applied;
    const a = state.units[dm.attacker] as Unit;
    const def = state.units[dm.defender] as Unit;
    a.stats.dealt += applied;
    def.stats.taken += applied;
    if (dm.kind !== 'arrow' && dm.facing !== 'front') a.stats.flankDealt += applied;
    const dirMult = dm.kind === 'arrow' ? T.moraleArrowMult : T.moraleFacing[dm.facing];
    moraleDelta[def.id] = (moraleDelta[def.id] as number) - (applied / def.maxMen) * T.moraleLossScale * dirMult * (support[def.id] as number);
  }
  for (const sh of shocks) moraleDelta[sh.defender] = (moraleDelta[sh.defender] as number) - sh.amount;
  for (const id of bounced) {
    const c = state.units[id] as Unit;
    const loss = Math.min(T.impactBouncedMen, Math.max(0, c.men - (menLoss[id] as number)));
    menLoss[id] = (menLoss[id] as number) + loss;
    c.stats.taken += loss;
    moraleDelta[id] = (moraleDelta[id] as number) - T.impactBouncedMorale;
  }

  // そのほかの士気の増減（active な部隊だけ）
  const meleeAttackers: number[][] = state.units.map(() => []);
  for (const a of state.units) {
    const d = decisions[a.id] as Decision;
    if ((snap[a.id] as Snap).status === 'active' && d.attack === 'melee' && d.target !== null) meleeAttackers[d.target]?.push(a.id);
  }
  for (const u of state.units) {
    if ((snap[u.id] as Snap).status !== 'active' || isGate(u)) continue;
    let delta = 0;
    // 囲まれている：近接で攻めてくる敵が2部隊以上いて、そのうち2部隊の方向が 100°以上開いている
    const atk = meleeAttackers[u.id] as number[];
    if (atk.length >= 2) {
      const s = snap[u.id] as Snap;
      let surrounded = false;
      for (let i = 0; i < atk.length && !surrounded; i++) {
        for (let j = i + 1; j < atk.length && !surrounded; j++) {
          const p = snap[atk[i] as number] as Snap;
          const q = snap[atk[j] as number] as Snap;
          if (angleBetween(p.x - s.x, p.y - s.y, q.x - s.x, q.y - s.y) >= T.surroundAngle) surrounded = true;
        }
      }
      if (surrounded) delta -= T.surroundPerSec * DT;
    }
    // 前の刻みに敗走・全滅した部隊の影響
    const s = snap[u.id] as Snap;
    for (const rec of state.brokenLastTick) {
      if (rec.unit === u.id) continue;
      const d = dist(s.x, s.y, rec.x, rec.y);
      if (rec.side === u.side) {
        if (d <= T.allyRoutedRange) delta -= rec.reason === 'routed' ? T.allyRoutedLoss : T.allyDestroyedLoss;
      } else if (rec.holders.includes(u.id)) {
        delta += T.targetBrokenGain;
      } else if (d <= T.enemyBrokenRange) {
        delta += T.enemyBrokenGain;
      }
    }
    // 2.0 マス以内に敵がおらず、この2秒のあいだ損害を受けていない
    let enemyNear = false;
    let hqNear = false;
    for (const o of state.units) {
      if (o.id === u.id || isGate(o) || (snap[o.id] as Snap).status !== 'active') continue;
      const d = sd(ctx, u.id, o.id);
      if (o.side !== u.side && d <= T.recoverEnemyRange) enemyNear = true;
      if (o.side === u.side && o.kind === 'hq' && d <= T.hqSupportRange) hqNear = true;
    }
    const quiet = (u.lastHitTick === null || t - u.lastHitTick >= T.recoverQuietTicks) && (menLoss[u.id] as number) <= 0;
    if (!enemyNear && quiet) delta += T.recoverPerSec * DT;
    if (hqNear && u.kind !== 'hq') delta += T.hqNearPerSec * DT;
    moraleDelta[u.id] = (moraleDelta[u.id] as number) + delta;
  }

  // 適用と、状態の切り替え
  const newBroken: BrokenRecord[] = [];
  for (const u of state.units) {
    if (u.status === 'gone') continue;
    const loss = menLoss[u.id] as number;
    if (loss > 0) {
      u.men = Math.max(0, u.men - loss);
      u.lastHitTick = t;
    }
    const wasActive = u.status === 'active';
    // 門の士気は 100 のまま変わらず、敗走しない
    if (wasActive && !isGate(u)) u.morale = Math.min(T.moraleMax, Math.max(0, u.morale + (moraleDelta[u.id] as number)));
    const holders = (): number[] => state.units.filter((o) => isEnemy(o, u) && (snap[o.id] as Snap).target === u.id).map((o) => o.id);
    if (u.men <= 1e-9) {
      u.men = 0;
      u.status = 'gone';
      u.goneReason = 'destroyed';
      u.order = null;
      pushEvent(events, { type: 'destroyed', tick: t, unit: u.id });
      // 門が破れたら、両隣の城壁も崩れる（刻み t+1 から3マスの幅で通れる）
      if (isGate(u) && state.gate) collapseBesideGate(state.field, state.gate);
      // 門が全滅しても、まわりの士気は動かない。最初に消えた部隊・敗走させた数にも数えない
      if (wasActive && !isGate(u)) newBroken.push({ unit: u.id, side: u.side, x: u.x, y: u.y, reason: 'destroyed', holders: holders() });
    } else if (wasActive && u.morale <= 0) {
      u.morale = 0;
      u.status = 'routing';
      u.routTick = t;
      u.order = null;
      u.target = null;
      pushEvent(events, { type: 'rout', tick: t, unit: u.id });
      newBroken.push({ unit: u.id, side: u.side, x: u.x, y: u.y, reason: 'routed', holders: holders() });
    } else if (u.status === 'routing') {
      const out = u.x < 0 || u.y < 0 || u.x > state.field.width || u.y > state.field.height;
      if (out || t - (u.routTick ?? t) >= T.routTicks) {
        u.status = 'gone';
        u.goneReason = 'routed';
      }
    }
  }
  for (const rec of newBroken) {
    for (const h of rec.holders) (state.units[h] as Unit).stats.routsCaused += 1;
    if (state.firstBroken[rec.side] === null) state.firstBroken[rec.side] = rec.unit;
  }
  state.brokenLastTick = newBroken;

  // ⑧ 決着を調べる
  const lost: [{ hq: boolean; wipe: boolean; gate: boolean }, { hq: boolean; wipe: boolean; gate: boolean }] = [
    { hq: false, wipe: false, gate: false },
    { hq: false, wipe: false, gate: false },
  ];
  for (const side of [0, 1] as const) {
    const mine = state.units.filter((u) => u.side === side && !isGate(u));
    const hq = mine.find((u) => u.kind === 'hq');
    lost[side].hq = hq !== undefined && hq.status !== 'active';
    const others = mine.filter((u) => u.kind !== 'hq');
    lost[side].wipe = others.length > 0 && others.every((u) => u.status !== 'active');
  }
  // 門を破る決着：win が true の門が全滅した刻みに、門の側は負けの条件を満たす
  if (state.gate && state.gate.win && (state.units[state.gate.id] as Unit).status !== 'active') lost[state.gate.side].gate = true;
  const l0 = lost[0].hq || lost[0].wipe || lost[0].gate;
  const l1 = lost[1].hq || lost[1].wipe || lost[1].gate;
  if (l0 || l1) {
    const winner: Side | 'draw' = l0 && l1 ? 'draw' : l0 ? 1 : 0;
    // 理由の優先は gate、hq、wipeout の順
    const why = (k: 'gate' | 'hq'): boolean => (l0 && lost[0][k]) || (l1 && lost[1][k]);
    const reason = why('gate') ? 'gate' : why('hq') ? 'hq' : 'wipeout';
    state.outcome = { winner, reason, tick: t };
    pushEvent(events, { type: 'end', tick: t, winner, reason });
  }

  // ⑨ 刻みを進め、時間切れを調べる
  state.tick = t + 1;
  if (!state.outcome && state.tick >= state.maxTicks) {
    const winner = timeoutWinner(state);
    state.outcome = { winner, reason: 'timeout', tick: t };
    pushEvent(events, { type: 'end', tick: t, winner, reason: 'timeout' });
  }
  return events;
}

/** 残った兵の割合（active な部隊の兵数の合計 ÷ 開戦時の兵数の合計） */
export function remainingRatio(state: BattleState, side: Side): number {
  const init = state.initialMen[side];
  if (init <= 0) return 0;
  let sum = 0;
  for (const u of state.units) if (u.side === side && u.status === 'active' && !isGate(u)) sum += u.men;
  return sum / init;
}

function timeoutWinner(state: BattleState): Side | 'draw' {
  if (state.timeout === 'side0_wins') return 0;
  if (state.timeout === 'side0_loses') return 1;
  const a = Math.round(remainingRatio(state, 0) * 100);
  const b = Math.round(remainingRatio(state, 1) * 100);
  if (a === b) return 'draw';
  return a > b ? 0 : 1;
}
