// 端末に残す記録（design §5.4）。localStorage の1つの鍵に JSON で置く。
// 読み書きはすべて try/catch で包み、localStorage が使えない環境（プライベートブラウズなど）でも遊べるようにする。
// 形が合わないデータは、その項目だけ捨てて初期値にする（古い形や壊れたデータで起動できなくなるのを防ぐため）。

import { KINDS, STANCES, type Placement } from '@jinkei/engine';

/**
 * 保存の鍵。開発時だけ、URL に ?save=b のように付けると別の鍵（jinkei-gassen/v1:b）を使う。
 * 同じブラウザの2枚のタブで対戦を確かめるとき、pid と名前を別にするため（本番では使わない）。
 */
export const SAVE_KEY = saveKey();

function saveKey(): string {
  const base = 'jinkei-gassen/v1';
  if (!import.meta.env.DEV) return base;
  try {
    const slot = new URLSearchParams(window.location.search).get('save');
    return slot && /^[a-z0-9]{1,8}$/.test(slot) ? `${base}:${slot}` : base;
  } catch {
    return base;
  }
}

export interface SaveData {
  v: 1;
  /** 面ごとの最高の星（0〜3） */
  stars: Record<string, number>;
  /** 面ごとの最後の配置（同じ面をやり直すときに戻すため） */
  placements: Record<string, Placement[]>;
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
}

function empty(): SaveData {
  return { v: 1, stars: {}, placements: {}, muted: false, pid: null, name: '', roomCode: null, pvpArmy: [] };
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

/** 読んだ値を、正しい形の項目だけ残して SaveData に直す */
function sanitize(raw: unknown): SaveData {
  const data = empty();
  if (!isRecord(raw) || raw.v !== 1) return data;
  if (isRecord(raw.stars)) {
    for (const [id, n] of Object.entries(raw.stars)) {
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 3) data.stars[id] = n;
    }
  }
  if (isRecord(raw.placements)) {
    for (const [id, list] of Object.entries(raw.placements)) {
      if (Array.isArray(list) && list.length <= 16 && list.every(isPlacement)) {
        data.placements[id] = list.map((p) => ({ kind: p.kind, col: p.col, row: p.row, stance: p.stance }));
      }
    }
  }
  if (typeof raw.muted === 'boolean') data.muted = raw.muted;
  if (typeof raw.pid === 'string' && /^[0-9a-f]{32}$/.test(raw.pid)) data.pid = raw.pid;
  if (typeof raw.name === 'string' && [...raw.name].length <= 12) data.name = raw.name;
  if (typeof raw.roomCode === 'string' && /^\d{4}$/.test(raw.roomCode)) data.roomCode = raw.roomCode;
  if (Array.isArray(raw.pvpArmy) && raw.pvpArmy.length <= 16 && raw.pvpArmy.every(isPlacement)) {
    data.pvpArmy = raw.pvpArmy.map((p) => ({ kind: p.kind, col: p.col, row: p.row, stance: p.stance }));
  }
  return data;
}

let cache: SaveData | null = null;

export function loadSave(): SaveData {
  if (cache) return cache;
  try {
    const text = window.localStorage.getItem(SAVE_KEY);
    cache = text ? sanitize(JSON.parse(text)) : empty();
  } catch {
    cache = empty();
  }
  return cache;
}

function write(): void {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(loadSave()));
  } catch {
    // 書けなくても遊べるので、黙って続ける
  }
}

export function starsOf(stageId: string): number {
  return loadSave().stars[stageId] ?? 0;
}

/** 星を記録する。前より多いときだけ書き換え、書き換えたかを返す */
export function recordStars(stageId: string, stars: number): boolean {
  const data = loadSave();
  if (stars <= (data.stars[stageId] ?? 0)) return false;
  data.stars[stageId] = stars;
  write();
  return true;
}

export function savedPlacements(stageId: string): Placement[] | null {
  const list = loadSave().placements[stageId];
  return list ? list.map((p) => ({ ...p })) : null;
}

export function savePlacements(stageId: string, placements: readonly Placement[]): void {
  loadSave().placements[stageId] = placements.map((p) => ({ kind: p.kind, col: p.col, row: p.row, stance: p.stance }));
  write();
}

export function savedMuted(): boolean {
  return loadSave().muted;
}

export function saveMuted(muted: boolean): void {
  loadSave().muted = muted;
  write();
}

/** 開発用：星だけを書き換える（面を飛ばすため） */
export function setStarsForDebug(stageId: string, stars: number): void {
  loadSave().stars[stageId] = stars;
  write();
}

/** 開発用：記録を消す */
export function clearSave(): void {
  cache = empty();
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // 消せなくても、手元の記録は空になっている
  }
}

/** 対戦の pid。なければ作って保存する（128ビットの乱数を16進の小文字で） */
export function playerId(): string {
  const data = loadSave();
  if (data.pid) return data.pid;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  data.pid = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  write();
  return data.pid;
}

export function savedName(): string {
  return loadSave().name;
}

export function saveName(name: string): void {
  loadSave().name = name;
  write();
}

export function savedRoomCode(): string | null {
  return loadSave().roomCode;
}

export function saveRoomCode(code: string | null): void {
  loadSave().roomCode = code;
  write();
}

/** 開発用：pid を作り直す（同じ鍵の2枚のタブで別の人として入るため） */
export function resetPlayerIdForDebug(): string {
  loadSave().pid = null;
  return playerId();
}

export function savedPvpArmy(): Placement[] {
  return loadSave().pvpArmy.map((p) => ({ ...p }));
}

export function savePvpArmy(list: readonly Placement[]): void {
  loadSave().pvpArmy = list.map((p) => ({ kind: p.kind, col: p.col, row: p.row, stance: p.stance }));
  write();
}
