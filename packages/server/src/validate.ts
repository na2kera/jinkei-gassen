// 受け取った値の検査（design §4.1・§4.4）。形・長さ・値の範囲を確かめ、知らないキーも拒否する。例外は投げない。
// 配置の中身（エリア・重なり・予算）は、ここでは見ない。engine の validateArmy に任せる。
// ここで見るのは「engine に渡してよい形か」と「保存してよい大きさか」まで。

import { KINDS, ORDER_KINDS, ORDER_TARGETS, STANCES, type OrderKind, type OrderTarget, type Placement } from '@jinkei/engine';
import type { ClientMessage } from './protocol.ts';

/** 受け付けるメッセージの最大の長さ（文字数）。16部隊の配置でも 1KB ほど */
export const MAX_MESSAGE_LENGTH = 4096;
/** 名前の最大文字数（コードポイント） */
export const MAX_NAME_LENGTH = 12;
/** 1つの配置の部隊数の上限。engine の上限（本陣を含めて16）より多い配列は、中身を見ずに断る */
export const MAX_ARMY_LENGTH = 16;
/** マスの値の範囲。戦場より大きい値は validateArmy がエリア外として断るが、保存する前に桁を抑える */
const MAX_CELL = 63;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function onlyKeys(o: Obj, allowed: readonly string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

function isCell(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_CELL;
}

function isBattleNo(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 2 ** 31;
}

/** 配置の配列を、決まった鍵だけの新しい配列に写す。形が違えば null */
export function parseArmy(v: unknown): Placement[] | null {
  if (!Array.isArray(v) || v.length > MAX_ARMY_LENGTH) return null;
  const out: Placement[] = [];
  for (let i = 0; i < v.length; i++) {
    const p: unknown = v[i];
    if (!isObj(p) || !onlyKeys(p, ['kind', 'col', 'row', 'stance'])) return null;
    const kind = KINDS.find((k) => k === p['kind']);
    const stance = STANCES.find((s) => s === p['stance']);
    if (kind === undefined || stance === undefined || !isCell(p['col']) || !isCell(p['row'])) return null;
    out.push({ kind, col: p['col'], row: p['row'], stance });
  }
  return out;
}

/** WebSocket で受け取った1件を検査する。形が違えば null（呼ぶ側は黙って捨てる） */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_LENGTH) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v['type']) {
    case 'draft': {
      if (!onlyKeys(v, ['type', 'army'])) return null;
      const army = parseArmy(v['army']);
      return army === null ? null : { type: 'draft', army };
    }
    case 'ready': {
      if (!onlyKeys(v, ['type', 'army'])) return null;
      if (!('army' in v)) return { type: 'ready' };
      const army = parseArmy(v['army']);
      return army === null ? null : { type: 'ready', army };
    }
    case 'unready':
      return onlyKeys(v, ['type']) ? { type: 'unready' } : null;
    case 'order': {
      if (!onlyKeys(v, ['type', 'battleNo', 'target', 'kind'])) return null;
      const target = ORDER_TARGETS.find((t): t is OrderTarget => t === v['target']);
      const kind = ORDER_KINDS.find((k): k is OrderKind => k === v['kind']);
      if (!isBattleNo(v['battleNo']) || target === undefined || kind === undefined) return null;
      return { type: 'order', battleNo: v['battleNo'], target, kind };
    }
    case 'rematch':
      if (!onlyKeys(v, ['type', 'battleNo']) || !isBattleNo(v['battleNo'])) return null;
      return { type: 'rematch', battleNo: v['battleNo'] };
    default:
      return null;
  }
}

/** pid は端末が作る128ビットの乱数（16進の小文字32文字）。席に戻るための合言葉 */
export function isPid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
}

/** 部屋のコード（4桁の数字） */
export function isRoomCode(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9]{4}$/.test(v);
}

// 制御文字・書式文字・行区切り・段落区切り・私用領域・サロゲートの片割れを拒否する（相手の画面に出るため）
const BAD_NAME_CHAR = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u;

/** 名前を整える。前後の空白を除き NFC にする。不正なら null */
export function normalizeName(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 64) return null;
  const s = v.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const len = [...s].length;
  if (len < 1 || len > MAX_NAME_LENGTH) return null;
  if (BAD_NAME_CHAR.test(s)) return null;
  return s;
}
