// 受け取った値の検査（design §4.1・§4.4）。形・長さ・値の範囲を確かめ、知らないキーも拒否する。例外は投げない。
// 配置の中身（エリア・重なり・予算）は、ここでは見ない。engine の validateArmy に任せる。
// ここで見るのは「engine に渡してよい形か」と「保存してよい大きさか」まで。

import { KINDS, ORDER_KINDS, ORDER_TARGETS, STANCES, type OrderKind, type OrderTarget, type Placement, type ReserveSetup } from '@jinkei/engine';
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

/** 遊軍の値の文字列の長さの上限（兵種・方針の名前より十分長い。保存する前に大きさを抑えるため） */
const MAX_RESERVE_STRING = 16;

/**
 * 遊軍の値を、決まった鍵だけの新しい値に写す（design §7.7）。undefined（省略）と null は null（なし）。形が違えば 'bad'。
 * ここでは形（鍵が kind と stance だけ、どちらも短い文字列）しか見ない。兵種・方針が正しいかは engine の reserveErrors
 * （validateArmy の limits.reserve）に任せる。知らない方針や本陣の遊軍を、ここで黙って捨てずに invalid_army として返すため。
 * 中身が正しくない値も ReserveSetup の形で返す（検査を通るまで lastValid にはならない）
 */
export function parseReserve(v: unknown): ReserveSetup | null | 'bad' {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || !onlyKeys(v, ['kind', 'stance'])) return 'bad';
  const kind = v['kind'];
  const stance = v['stance'];
  if (typeof kind !== 'string' || typeof stance !== 'string') return 'bad';
  if (kind.length > MAX_RESERVE_STRING || stance.length > MAX_RESERVE_STRING) return 'bad';
  return { kind, stance } as ReserveSetup;
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
      if (!onlyKeys(v, ['type', 'army', 'reserve'])) return null;
      const army = parseArmy(v['army']);
      const reserve = parseReserve(v['reserve']);
      return army === null || reserve === 'bad' ? null : { type: 'draft', army, reserve };
    }
    case 'ready': {
      if (!onlyKeys(v, ['type', 'army', 'reserve'])) return null;
      // army を付けないときは、いまの下書きの組で確定する。reserve の値は（形も）見ない（design §7.7）
      if (!('army' in v)) return { type: 'ready' };
      const reserve = parseReserve(v['reserve']);
      const army = parseArmy(v['army']);
      return army === null || reserve === 'bad' ? null : { type: 'ready', army, reserve };
    }
    case 'reserve': {
      if (!onlyKeys(v, ['type', 'battleNo', 'from'])) return null;
      const from = v['from'];
      if (!isBattleNo(v['battleNo']) || (from !== 'left' && from !== 'right')) return null;
      return { type: 'reserve', battleNo: v['battleNo'], from };
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
    case 'leave':
      return onlyKeys(v, ['type']) ? { type: 'leave' } : null;
    default:
      return null;
  }
}

/** pid は端末が作る128ビットの乱数（16進の小文字32文字）。席に戻るための合言葉 */
export function isPid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
}

/**
 * 接続の URL の cv（client の版。design §7.7）。付けない・形が違うときは 1（遊軍を知らない古い画面）として扱う。
 * 遊軍を使えるのは、両方の席が 2 以上のとき
 */
export function parseClientVersion(v: string | null): number {
  if (v === null || !/^[0-9]{1,4}$/.test(v)) return 1;
  return Math.max(1, Number(v));
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
