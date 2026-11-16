// 利用者の入力を、参照する前に調べるための小さな道具。
// engine の公開の口（createBattle・validateArmy・canOrder・canOrderView・step の号令・applyTemplate）は、
// どんな値を渡されても例外を投げずにエラーの結果を返すため、値を読む前にここで形を確かめる。

import { KINDS, ORDER_KINDS, ORDER_TARGETS, STANCES, type Kind, type OrderKind, type OrderTarget, type Side, type Stance, type Terrain } from './types.ts';

export const TERRAINS: readonly Terrain[] = ['plain', 'hill', 'forest', 'river', 'fence', 'wall'];

/** 戦場の一辺の上限（巨大な配列で時間を使わないため） */
export const MAX_FIELD_SIDE = 64;
/** 1回の step で見る号令の数 */
export const MAX_ORDERS_PER_STEP = 8;
/** 予定された号令の上限 */
export const MAX_SCRIPTED_ORDERS = 32;

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** 穴のない配列か（疎な配列は forEach が穴を飛ばすので、長さと各添字で確かめる） */
export function isDenseArray(v: unknown): v is unknown[] {
  if (!Array.isArray(v)) return false;
  for (let i = 0; i < v.length; i++) if (!(i in v)) return false;
  return true;
}

export const isSide = (v: unknown): v is Side => v === 0 || v === 1;
export const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as readonly string[]).includes(v);
export const isStance = (v: unknown): v is Stance => typeof v === 'string' && (STANCES as readonly string[]).includes(v);
export const isOrderKind = (v: unknown): v is OrderKind => typeof v === 'string' && (ORDER_KINDS as readonly string[]).includes(v);
export const isOrderTarget = (v: unknown): v is OrderTarget => typeof v === 'string' && (ORDER_TARGETS as readonly string[]).includes(v);
export const isTerrain = (v: unknown): v is Terrain => typeof v === 'string' && (TERRAINS as readonly string[]).includes(v);
