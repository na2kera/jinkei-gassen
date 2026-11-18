// 戦場・配置の検査・翼・既定の方針（design §3.2、§3.4）。

import {
  KINDS,
  STANCES,
  type ArmyError,
  type ArmyLimits,
  type Field,
  type Kind,
  type Placement,
  type ReserveSetup,
  type Side,
  type Stance,
  type Wing,
  type Zone,
} from './types.ts';
import { DEFAULT_COSTS } from './tuning.ts';
import { isDenseArray, isInt, isKind, isObject, isStance } from './input.ts';

/** 標準の戦場の大きさ（自軍6 + 中間4 + 敵軍6） */
export const STANDARD_WIDTH = 12;
export const STANDARD_HEIGHT = 16;
export const STANDARD_ZONE_DEPTH = 6;

/** 本陣を含めた1軍の部隊数の上限（§2） */
export const MAX_UNITS = 16;

/**
 * 平地だけの戦場を作る。配置エリアは、陣営1が上側の depth 行、陣営0が下側の depth 行。
 * 標準は 12 × 16 で、陣営0が y 10〜16、陣営1が y 0〜6。
 */
export function plainField(width = STANDARD_WIDTH, height = STANDARD_HEIGHT, depth = STANDARD_ZONE_DEPTH): Field {
  return {
    width,
    height,
    terrain: new Array<Field['terrain'][number]>(width * height).fill('plain'),
    zones: [
      { col: 0, row: height - depth, width, height: depth },
      { col: 0, row: 0, width, height: depth },
    ],
  };
}

/**
 * 配置した列から翼を決める。自分から見て左の3分の1が左翼、右の3分の1が右翼、あいだが中央。
 * 陣営1は向きが逆なので、列の大きいほうが左翼になる。
 * 幅が3で割れないときは、列の中心（col + 0.5）が width/3 より小さければ左の3分の1、
 * 2·width/3 以上なら右の3分の1とする（12列なら 0〜3・4〜7・8〜11）。
 */
export function wingOf(col: number, field: Pick<Field, 'width'>, side: Side): Wing {
  const c = col + 0.5;
  const w = field.width;
  const low = c < w / 3;
  const high = c >= (2 * w) / 3;
  if (!low && !high) return 'center';
  if (side === 0) return low ? 'left' : 'right';
  return low ? 'right' : 'left';
}

/** 兵種ごとの初期の方針（§3.6.1） */
export function defaultStance(kind: Kind): Stance {
  switch (kind) {
    case 'infantry':
      return 'advance';
    case 'shield':
      return 'hold';
    case 'cavalry':
      return 'flank';
    case 'archer':
      return 'advance';
    case 'hq':
      return 'hold';
  }
}

/** その兵種が選べる方針か（本陣は守備と前進だけ） */
export function stanceAllowed(kind: Kind, stance: Stance): boolean {
  if (kind === 'hq') return stance === 'hold' || stance === 'advance';
  return true;
}

/**
 * 遊軍の値を調べる（design §7.2）。誤りがなければ空の配列。engine・面・server のどこからも、これを呼ぶ。
 * オブジェクトであること、兵種が本陣以外の4つのどれか、方針が知っている文字列で、その兵種が選べること。
 * stanceAllowed は本陣以外ならいつも true を返すので、isStance で知らない文字列を先に落とす。
 */
export function reserveErrors(reserve: unknown): ArmyError[] {
  if (!isObject(reserve) || !isKind(reserve.kind) || reserve.kind === 'hq') return [{ code: 'invalid_kind', message: '遊軍の兵種が正しくない（本陣は遊軍にできない）' }];
  if (!isStance(reserve.stance) || !stanceAllowed(reserve.kind, reserve.stance)) {
    return [{ code: 'invalid_stance', message: '遊軍の方針が正しくない' }];
  }
  return [];
}

/** 配置の値段の合計。costs を省略すると DEFAULT_COSTS（assumptions S1）を使う */
export function armyCost(placements: readonly Placement[], costs: Partial<Record<Kind, number>> = DEFAULT_COSTS): number {
  let sum = 0;
  for (const p of placements) {
    const v = costs[p.kind] ?? DEFAULT_COSTS[p.kind] ?? 0;
    sum += typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  return sum;
}

export function inZone(col: number, row: number, zone: Zone): boolean {
  return col >= zone.col && col < zone.col + zone.width && row >= zone.row && row < zone.row + zone.height;
}

/**
 * 配置を検査する。誤りがなければ空の配列。
 * 見るもの：兵種・方針・マスの値が正しいか、エリアの内か、マスの重なり、本陣の数、予算、部隊数。
 * limits.reserve（遊軍）があれば、その値も調べ（reserveErrors）、部隊数と予算に含めて数える。本陣以外の部隊の下限は、戦場の部隊だけで数える。
 */
export function validateArmy(placements: readonly Placement[], zone: Zone, limits: ArmyLimits): ArmyError[] {
  // どんな値が来ても例外を投げない。配列の形と数の上限を、要素を走査する前に調べる
  if (!isDenseArray(placements)) return [{ code: 'invalid_cell', message: '配置は穴のない配列で書く' }];
  const lim: Partial<ArmyLimits> = isObject(limits) ? limits : {};
  const maxUnits = isInt(lim.maxUnits) && lim.maxUnits >= 0 ? lim.maxUnits : MAX_UNITS;
  // 遊軍は null と省略を「なし」とする。値があれば、正しくなくても1部隊として数える（数の上限を先に調べるため）
  const reserve: unknown = lim.reserve ?? null;
  const total = placements.length + (reserve === null ? 0 : 1);
  if (total > maxUnits) return [{ code: 'too_many_units', message: `部隊が多すぎる: ${total} > ${maxUnits}` }];
  const z: Zone | null =
    isObject(zone) && isInt(zone.col) && isInt(zone.row) && isInt(zone.width) && isInt(zone.height) ? zone : null;
  const errors: ArmyError[] = [];
  const requireHq = lim.requireHq ?? true;
  const minUnits = isInt(lim.minUnits) ? lim.minUnits : 1;
  const seen = new Set<string>();
  let hqCount = 0;
  let others = 0;
  for (let index = 0; index < placements.length; index++) {
    const p: unknown = placements[index];
    if (!isObject(p) || !isKind(p.kind)) {
      errors.push({ code: 'invalid_kind', index, message: '兵種が正しくない' });
      continue;
    }
    if (!isStance(p.stance) || !stanceAllowed(p.kind, p.stance)) {
      errors.push({ code: 'invalid_stance', index, message: `${p.kind} には、その方針を選べない` });
    }
    if (!isInt(p.col) || !isInt(p.row)) {
      errors.push({ code: 'invalid_cell', index, message: 'マスの位置は整数で書く' });
      continue;
    }
    if (!z || !inZone(p.col, p.row, z)) {
      errors.push({ code: 'out_of_zone', index, message: `配置エリアの外: (${p.col}, ${p.row})` });
    }
    const key = `${p.col},${p.row}`;
    if (seen.has(key)) errors.push({ code: 'overlap', index, message: `マスが重なっている: (${p.col}, ${p.row})` });
    seen.add(key);
    if (p.kind === 'hq') hqCount++;
    else others++;
  }
  if (requireHq ? hqCount !== 1 : hqCount > 1) {
    errors.push({ code: 'hq_count', message: `本陣の数が正しくない: ${hqCount}` });
  }
  if (others < minUnits) {
    errors.push({ code: 'too_few_units', message: `本陣以外の部隊が少なすぎる: ${others} < ${minUnits}` });
  }
  if (reserve !== null) errors.push(...reserveErrors(reserve));
  if (lim.budget !== undefined && errors.length === 0) {
    const costs = isObject(lim.costs) ? lim.costs : DEFAULT_COSTS;
    const r = reserve as ReserveSetup | null;
    const cost = armyCost(r ? [...placements, { kind: r.kind, col: 0, row: 0, stance: r.stance }] : placements, costs);
    if (!(typeof lim.budget === 'number' && cost <= lim.budget)) errors.push({ code: 'over_budget', message: `予算を超えている: ${cost} > ${String(lim.budget)}` });
  }
  return errors;
}
