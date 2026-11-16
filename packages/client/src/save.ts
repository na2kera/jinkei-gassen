// 端末に残す記録（design §5.4）。localStorage の1つの鍵に JSON で置く。
// 読み書きはすべて try/catch で包み、localStorage が使えない環境（プライベートブラウズなど）でも遊べるようにする。
// 形が合わないデータは、その項目だけ捨てて初期値にする（古い形や壊れたデータで起動できなくなるのを防ぐため）。

import { KINDS, STANCES, type Placement } from '@jinkei/engine';

export const SAVE_KEY = 'jinkei-gassen/v1';

export interface SaveData {
  v: 1;
  /** 面ごとの最高の星（0〜3） */
  stars: Record<string, number>;
  /** 面ごとの最後の配置（同じ面をやり直すときに戻すため） */
  placements: Record<string, Placement[]>;
  /** 音を切っているか */
  muted: boolean;
}

function empty(): SaveData {
  return { v: 1, stars: {}, placements: {}, muted: false };
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
