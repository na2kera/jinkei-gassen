// ステージ（design §3.10）。面のデータの型と、面を戦いに直す関数。面の中身は stages.ts。

import { defaultStance, MAX_UNITS, validateArmy } from './army.ts';
import { isDenseArray, isObject } from './input.ts';
import { applyTemplate } from './templates.ts';
import type { ArmyError, BattleSetup, BattleSummary, Field, Kind, OrderKind, OrderTarget, Placement, ReserveFrom, ReserveSetup, Roster, ScriptedReserve, Side, Stance } from './types.ts';

export interface StageEnemyOrder {
  atSec: number;
  target: OrderTarget;
  kind: OrderKind;
}

/** 面の敵の遊軍、または見本・測定の自軍の遊軍を「何秒にどちらから呼ぶか」（design §7.6） */
export interface StageReserveCall {
  atSec: number;
  from: ReserveFrom;
}

export interface StageAllow {
  /** 配置の画面で選べる方針。空の配列なら方針の切り替えを出さず、どの部隊も兵種の初期設定の方針で動く。省略するとすべて選べる */
  stances?: Stance[];
  /** 号令を出せるか。省略すると出せる */
  orders?: boolean;
  /** 配置の画面でひな形を出すか。省略すると出す */
  templates?: boolean;
}

export interface Stage {
  id: string;
  chapter: 1 | 2 | 3;
  index: number;
  name: string;
  /** 配置画面に出す1行。説明は面の作りで伝える */
  hint: string;
  field: Field;
  /** 手持ち。本陣は必ず1 */
  roster: Roster;
  /** 敵の配置と方針 */
  enemy: Placement[];
  enemyOrders?: StageEnemyOrder[];
  win: { type: 'defeat' } | { type: 'survive' } | { type: 'gate' };
  /** 第1章で、まだ教えていない操作を隠す */
  allow?: StageAllow;
  /** 配置中に見せない敵のマス */
  fog?: { col: number; row: number }[];
  /** 勝てる配置の見本（テスト用。画面には出さない） */
  solution: Placement[];
  /** 見本で出す号令（テスト用。画面には出さない）。号令が開く面で、配置と号令の組で勝つ見本にするため */
  solutionOrders?: StageEnemyOrder[];
  /** 面の長さ（秒）。省略すると 180 秒 */
  seconds?: number;
  /** 門の場所（門はいつも陣営1のもの）。win が gate の面では必須 */
  gate?: { col: number; row: number };
  /** 敵の遊軍（§7.6）。atSec 秒に from から呼ぶ。いまの15面には書かない */
  enemyReserve?: ReserveSetup & StageReserveCall;
}

/** 配置の画面に見せる敵の部隊。方針は含めない */
export interface StageEnemyView {
  kind: Kind;
  col: number;
  row: number;
}

/** 面の戦いの最長の刻み数（3分） */
export const STAGE_MAX_TICKS = 1800;

/** 面と自軍の配置から、戦いの設定を作る。win を時間切れの扱いに、enemyOrders を予定された号令に直す */
export function stageSetup(stage: Stage, placements: Placement[], seed: number): BattleSetup {
  return stageSetupWith(stage, placements, seed, []);
}

/**
 * stageSetup に、自軍の予定された号令（見本の号令など）を足したもの。
 * reserve は自軍の遊軍、myReserve は見本・測定用の「何秒にどちらから呼ぶか」。どちらも省略すれば、いままでと同じ設定を作る
 */
export function stageSetupWith(
  stage: Stage,
  placements: Placement[],
  seed: number,
  myOrders: StageEnemyOrder[],
  reserve?: ReserveSetup | null,
  myReserve?: StageReserveCall | null,
): BattleSetup {
  const mine = myOrders.map((o) => ({ tick: Math.round(o.atSec * 10), side: 0 as Side, target: o.target, kind: o.kind }));
  const maxTicks = Math.round((stage.seconds ?? STAGE_MAX_TICKS / 10) * 10);
  // 門を破る面（gate）は段階4。それまでは、ふつうの面と同じく時間切れで負けにする
  const timeout: BattleSetup['timeout'] = stage.win.type === 'survive' ? 'side0_wins' : 'side0_loses';
  return {
    field: stage.field,
    armies: [placements, stage.enemy],
    seed,
    maxTicks,
    timeout,
    scriptedOrders: [...mine, ...(stage.enemyOrders ?? []).map((o) => ({ tick: Math.round(o.atSec * 10), side: 1 as Side, target: o.target, kind: o.kind }))],
    // 敵の配置は「配置エリアの中」の検査を外す（面のデータでは、敵のエリアを中間地帯まで広げてよいため）
    skipZoneCheck: 1,
    ...(stage.gate ? { gate: { side: 1 as Side, col: stage.gate.col, row: stage.gate.row, win: stage.win.type === 'gate' } } : {}),
    ...reserveSetup(stage, reserve ?? null, myReserve ?? null),
  };
}

/** 面の設定に足す遊軍の項目。自軍にも敵にも遊軍がなければ、項目ごと足さない（遊軍のない面の設定を、いままでと同じ形に保つ） */
function reserveSetup(stage: Stage, mine: ReserveSetup | null, myCall: StageReserveCall | null): Pick<BattleSetup, 'reserves' | 'scriptedReserves'> {
  const er = stage.enemyReserve;
  const enemy: ReserveSetup | null = er ? { kind: er.kind, stance: er.stance } : null;
  const calls: ScriptedReserve[] = [];
  if (myCall) calls.push({ tick: Math.round(myCall.atSec * 10), side: 0, from: myCall.from });
  if (er) calls.push({ tick: Math.round(er.atSec * 10), side: 1, from: er.from });
  if (!mine && !enemy && calls.length === 0) return {};
  const mineCopy: ReserveSetup | null = mine ? { kind: mine.kind, stance: mine.stance } : null;
  return { reserves: [mineCopy, enemy], ...(calls.length > 0 ? { scriptedReserves: calls } : {}) };
}

/** その面で選べる方針か（兵種の初期設定の方針は、いつでもよい） */
export function stanceAllowedInStage(stage: Stage, kind: Kind, stance: Stance): boolean {
  if (stance === defaultStance(kind)) return true;
  const list = stage.allow?.stances;
  return list === undefined || list.includes(stance);
}

/**
 * 面の配置を調べる。validateArmy（エリア・重なり・本陣1つ・部隊数）に加えて、兵種ごとの数が手持ちを超えていないこと、
 * その面で選べる方針であること。全部隊を置いていなくてもよい。どんな値を渡されても例外を投げない。
 * reserve（遊軍）があれば、手持ちと部隊数の上限を戦場の部隊 + 遊軍で数える。本陣以外の部隊の下限は、戦場の部隊だけで数える（§7.6）
 */
export function validateStageArmy(stage: Stage, placements: Placement[], reserve?: ReserveSetup | null): ArmyError[] {
  if (!isObject(stage) || !isObject(stage.field) || !isDenseArray(stage.field.zones)) {
    return [{ code: 'invalid_cell', message: '面が正しくない' }];
  }
  const zone = stage.field.zones[0];
  const rv: unknown = reserve ?? null;
  const errors = validateArmy(placements, zone as never, { maxUnits: MAX_UNITS, requireHq: true, reserve: rv as ReserveSetup | null });
  if (!isDenseArray(placements)) return errors;
  const count: Partial<Record<Kind, number>> = {};
  // 遊軍の方針も、その面で選べるものに限る（index は付けない）。兵種と方針の値そのものの誤りは validateArmy（reserveErrors）が返している
  if (isObject(rv) && typeof rv.kind === 'string' && rv.kind !== 'hq') {
    count[rv.kind as Kind] = 1;
    if (typeof rv.stance === 'string' && !errors.some((e) => e.index === undefined && (e.code === 'invalid_stance' || e.code === 'invalid_kind')) && !stanceAllowedInStage(stage, rv.kind as Kind, rv.stance as Stance)) {
      errors.push({ code: 'invalid_stance', message: `この面では遊軍の ${rv.kind} に方針 ${rv.stance} を選べない` });
    }
  }
  placements.forEach((p, index) => {
    if (!isObject(p) || typeof p.kind !== 'string') return;
    count[p.kind] = (count[p.kind] ?? 0) + 1;
    if (typeof p.stance === 'string' && !errors.some((e) => e.index === index && e.code === 'invalid_stance') && !stanceAllowedInStage(stage, p.kind, p.stance)) {
      errors.push({ code: 'invalid_stance', index, message: `この面では ${p.kind} に方針 ${p.stance} を選べない` });
    }
  });
  for (const [kind, n] of Object.entries(count) as [Kind, number][]) {
    const have = stage.roster[kind] ?? 0;
    if (n > have) errors.push({ code: 'over_roster', message: `${kind} が手持ちより多い: ${n} > ${have}` });
  }
  // 城壁のマス・敵の部隊のマス・門のマスには置けない
  const enemyCells = new Set((isDenseArray(stage.enemy) ? stage.enemy : []).map((e) => `${e.col},${e.row}`));
  if (stage.gate) enemyCells.add(`${stage.gate.col},${stage.gate.row}`);
  const w = stage.field.width;
  placements.forEach((p, index) => {
    if (!isObject(p) || typeof p.col !== 'number' || typeof p.row !== 'number') return;
    if (Array.isArray(stage.field.terrain) && stage.field.terrain[p.row * w + p.col] === 'wall') errors.push({ code: 'on_wall', index, message: '城壁のマスには置けない' });
    if (enemyCells.has(`${p.col},${p.row}`)) errors.push({ code: 'overlap', index, message: '敵の部隊とマスが重なっている' });
  });
  return errors;
}

/** 星の境目：残った兵の割合が [0] 以上で2つ、[1] 以上で3つ */
export const STAR_THRESHOLDS: readonly [number, number] = [0.5, 0.7];

/** 星（勝ったときだけ1以上）：残った兵の割合（remainingForStars）が STAR_THRESHOLDS[1]（0.7）以上で3つ、[0]（0.5）以上で2つ、それ未満で1つ。負けと引き分けは0 */
export function starsFor(summary: BattleSummary, side: Side): 0 | 1 | 2 | 3 {
  if (!isObject(summary) || summary.winner !== side) return 0;
  // 呼ばなかった遊軍を無傷として数える割合（§7.5）。それがない振り返り（古い形で保存された結果）では remaining を使う
  const forStars: unknown = summary.remainingForStars?.[side];
  const r = typeof forStars === 'number' ? forStars : summary.remaining?.[side];
  if (typeof r !== 'number' || !Number.isFinite(r)) return 1;
  if (r >= STAR_THRESHOLDS[1]) return 3;
  if (r >= STAR_THRESHOLDS[0]) return 2;
  return 1;
}

/** 配置の画面に見せる敵：霧のマスを除き、方針を含めない */
export function stageEnemyVisible(stage: Stage): StageEnemyView[] {
  const fog = new Set((stage.fog ?? []).map((c) => `${c.col},${c.row}`));
  return stage.enemy.filter((p) => !fog.has(`${p.col},${p.row}`)).map((p) => ({ kind: p.kind, col: p.col, row: p.row }));
}

/**
 * その面に、横陣のひな形をそのまま置いた配置（テストと sim の比べ用）。
 * 方針を出さない面では、方針を兵種の初期設定に直す。
 */
export function stageLineArmy(stage: Stage): Placement[] {
  const ps = applyTemplate('line', stage.roster, stage.field.zones[0], 0);
  return ps.map((p) => (stanceAllowedInStage(stage, p.kind, p.stance) ? p : { ...p, stance: defaultStance(p.kind) }));
}
