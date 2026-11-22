// 端末に残す記録の形と、読んだ値の掃除（design §5.4）。読み書きそのものは save.ts。
// Phaser・window・import.meta を使わない計算だけにして、画面なしで確かめられるようにする（test/reserve.test.ts）。

import { KINDS, MAX_UNITS, reserveErrors, STANCES, STANDARD_ZONE_WIDTH, type Placement, type ReserveSetup } from '@jinkei/engine';
import { parseView, type ViewMode } from './battle/viewMode.ts';

/**
 * 保存の形の版（design §5.4、§13.9）。2 は盤を変えた（design §13）あとの形。鍵（jinkei-gassen/v1）は変えない。
 * 1 の保存からは、座標を持たない項目だけを引き継ぐ（sanitizeSave）
 */
export const SAVE_VERSION = 2;

export interface SaveData {
  v: typeof SAVE_VERSION;
  /** 面ごとの最高の星（0〜3） */
  stars: Record<string, number>;
  /** 面ごとの最後の配置（同じ面をやり直すときに戻すため） */
  placements: Record<string, Placement[]>;
  /**
   * 面ごとの最後の遊軍（design §7.8）。placements と一緒に書き、枠が空なら鍵ごと消す。
   * 遊軍の前の保存にはないので、ないときは空として読む（v は上げない。上げると、古い保存がすべて捨てられるため）
   */
  reserves: Record<string, ReserveSetup>;
  /** 音を切っているか */
  muted: boolean;
  /** 対戦の席に戻るための合言葉（16進の小文字32文字）。相手には送られない */
  pid: string | null;
  /** 対戦で使う名前（1〜12文字） */
  name: string;
  /** 最後に入っていた部屋のコード（読み込み直したときに「前の部屋に戻る」を出すため） */
  roomCode: string | null;
  /**
   * 対戦の最後の配置（自分が下の座標）。読み込み直したあとの次の戦いでも、前の配置から始められるようにする。
   * サーバーは新しい配置の段階に入ると下書きを消すので、手元に残しておかないと、読み込み直した人の配置が空になるため
   */
  pvpArmy: Placement[];
  /** 対戦の最後の遊軍（pvpArmy と組。なければ null） */
  pvpReserve: ReserveSetup | null;
  /** 保存した陣形（design §5.6。8つまで） */
  formations: SavedFormation[];
  /** 戦闘の画面の視点（design §5.7、§5.8）。真上・斜め・横からの3つ（なくした将軍の視点など、知らない値は真上として読む） */
  view: ViewMode;
  /**
   * チュートリアルを済ませたか（design §8.7）。最後まで遊ぶか、飛ばすと付く。
   * チュートリアルの前の保存にはないので、ないときは星が1つでもあれば済みとして読む（v は上げない）
   */
  tutorialDone: boolean;
  /**
   * 対戦のルール説明を見たか（design §10.2）。ロビーのダイアログを「閉じる」で閉じると付く。
   * ない保存・真偽でない値は false として読む（前から遊んでいる人にも、1度は出すため。v は上げない）
   */
  pvpRulesSeen: boolean;
}

/**
 * 保存した陣形。配置は、配置エリアの左上を原点にした列と行で持つ（面や陣営が変わっても同じ形で呼び出せるように）。
 * width は保存したときの配置エリアの幅（幅の違う戦場で呼び出すと、外になる部隊は飛ばす）
 */
export interface SavedFormation {
  name: string;
  width: number;
  units: Placement[];
  /** 遊軍に回した部隊（design §7.8）。なければ項目ごと持たない */
  reserve?: ReserveSetup;
}

/** 陣形の数の上限 */
export const MAX_FORMATIONS = 8;

export function emptySave(): SaveData {
  return { v: SAVE_VERSION, stars: {}, placements: {}, reserves: {}, muted: false, pid: null, name: '', roomCode: null, pvpArmy: [], pvpReserve: null, formations: [], view: 'right', tutorialDone: false, pvpRulesSeen: false };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPlacement(v: unknown): v is Placement {
  if (!isRecord(v)) return false;
  return (
    KINDS.includes(v.kind as Placement['kind']) &&
    STANCES.includes(v.stance as Placement['stance']) &&
    Number.isInteger(v.col) &&
    Number.isInteger(v.row)
  );
}

/** 遊軍の値として正しければ、決まった項目だけを写して返す（engine の reserveErrors と同じ検査）。正しくなければ null */
export function cleanReserve(v: unknown): ReserveSetup | null {
  if (v === null || v === undefined || reserveErrors(v).length > 0) return null;
  const r = v as ReserveSetup;
  return { kind: r.kind, stance: r.stance };
}

/** 陣形を、決まった項目だけ写して作り直す（遊軍は、あるときだけ項目を足す） */
export function copyFormation(f: Omit<SavedFormation, 'reserve'> & { reserve?: unknown }): SavedFormation {
  const out: SavedFormation = { name: f.name, width: f.width, units: f.units.map((p) => ({ kind: p.kind, col: p.col, row: p.row, stance: p.stance })) };
  const r = cleanReserve(f.reserve);
  if (r) out.reserve = r;
  return out;
}

/**
 * 読んだ値を、正しい形の項目だけ残して SaveData に直す（design §13.9）。
 * - v 2：すべての項目を読む。
 * - v 1（盤が 12×16 だったころ）：星・音の設定・合言葉（pid）・名前・部屋のコード・視点・チュートリアルを済ませた印・
 *   対戦のルールを見た印だけを引き継ぐ。面ごとの配置と遊軍・保存した陣形・対戦の配置と遊軍は、座標が合わないので捨てる
 *   （行 10 は古いエリアにも新しいエリアにもあるので、座標の検査では見分けられない）。読むだけでは書き戻さず、次に書くときに v 2 になる。
 * - それ以外：空の保存。
 * 数の上限（配置・陣形の部隊・対戦の配置）は engine の MAX_UNITS、陣形の幅の上限は配置エリアの幅 STANDARD_ZONE_WIDTH を読む（戦場の幅 STANDARD_WIDTH は通り道を含むため。design §13.9）
 */
export function sanitizeSave(raw: unknown): SaveData {
  const data = emptySave();
  if (!isRecord(raw) || (raw.v !== 1 && raw.v !== SAVE_VERSION)) return data;
  if (isRecord(raw.stars)) {
    for (const [id, n] of Object.entries(raw.stars)) {
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 3) data.stars[id] = n;
    }
  }
  if (typeof raw.muted === 'boolean') data.muted = raw.muted;
  if (typeof raw.pid === 'string' && /^[0-9a-f]{32}$/.test(raw.pid)) data.pid = raw.pid;
  if (typeof raw.name === 'string' && [...raw.name].length <= 12) data.name = raw.name;
  if (typeof raw.roomCode === 'string' && /^\d{4}$/.test(raw.roomCode)) data.roomCode = raw.roomCode;
  // 知らない値は真上
  data.view = parseView(raw.view);
  // 済みの印は、星を掃除したあとで決める（design §8.10-6）。真偽値ならその値、そうでなければ、掃除したあとの星に 1 以上があれば済み
  data.tutorialDone = typeof raw.tutorialDone === 'boolean' ? raw.tutorialDone : Object.values(data.stars).some((n) => n >= 1);
  data.pvpRulesSeen = raw.pvpRulesSeen === true;
  // ここから下は座標を持つ項目。v 1 の保存からは引き継がない
  if (raw.v !== SAVE_VERSION) return data;
  if (isRecord(raw.placements)) {
    for (const [id, list] of Object.entries(raw.placements)) {
      if (Array.isArray(list) && list.length <= MAX_UNITS && list.every(isPlacement)) {
        data.placements[id] = list.map((p) => ({ kind: p.kind, col: p.col, row: p.row, stance: p.stance }));
      }
    }
  }
  if (isRecord(raw.reserves)) {
    for (const [id, r] of Object.entries(raw.reserves)) {
      const clean = cleanReserve(r);
      if (clean) data.reserves[id] = clean;
    }
  }
  if (Array.isArray(raw.formations)) {
    for (const f of raw.formations) {
      if (!isRecord(f) || typeof f.name !== 'string' || !Number.isInteger(f.width) || !Array.isArray(f.units)) continue;
      const len = [...f.name].length;
      if (len < 1 || len > 8 || (f.width as number) < 1 || (f.width as number) > STANDARD_ZONE_WIDTH) continue;
      if (f.units.length > MAX_UNITS || !f.units.every(isPlacement)) continue;
      if (data.formations.length >= MAX_FORMATIONS) break;
      // 遊軍の値が壊れていれば、遊軍だけを捨てる（陣形そのものは残す）
      data.formations.push(copyFormation({ name: f.name, width: f.width as number, units: f.units as Placement[], reserve: f.reserve }));
    }
  }
  if (Array.isArray(raw.pvpArmy) && raw.pvpArmy.length <= MAX_UNITS && raw.pvpArmy.every(isPlacement)) {
    data.pvpArmy = raw.pvpArmy.map((p) => ({ kind: p.kind, col: p.col, row: p.row, stance: p.stance }));
  }
  data.pvpReserve = cleanReserve(raw.pvpReserve);
  return data;
}
