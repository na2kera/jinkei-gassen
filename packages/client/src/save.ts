// 端末に残す記録（design §5.4）。localStorage の1つの鍵に JSON で置く。
// 読み書きはすべて try/catch で包み、localStorage が使えない環境（プライベートブラウズなど）でも遊べるようにする。
// 形が合わないデータは、その項目だけ捨てて初期値にする（古い形や壊れたデータで起動できなくなるのを防ぐため）。

import type { Placement, ReserveSetup } from '@jinkei/engine';
import type { ViewMode } from './battle/viewMode.ts';
import { cleanReserve, copyFormation, emptySave, MAX_FORMATIONS, sanitizeSave, type SaveData, type SavedFormation } from './saveFormat.ts';

// 形と掃除は saveFormat.ts（画面なしで確かめるため）。ここからも同じ名前で読めるようにしておく
export { MAX_FORMATIONS };
export type { SaveData, SavedFormation };

/**
 * 保存の鍵。開発時だけ、URL に ?save=b のように付けると別の鍵（jinkei-gassen/v1:b）を使う。
 * 同じブラウザの2枚のタブで対戦を確かめるとき、pid と名前を別にするため（本番では使わない）。
 */
export const SAVE_KEY = saveKey();

function saveKey(): string {
  const base = 'jinkei-gassen/v1';
  // node のテスト（import.meta.env がない）では、本番と同じく別の鍵を使わない
  if (!import.meta.env?.DEV) return base;
  try {
    const slot = new URLSearchParams(window.location.search).get('save');
    return slot && /^[a-z0-9]{1,8}$/.test(slot) ? `${base}:${slot}` : base;
  } catch {
    return base;
  }
}


let cache: SaveData | null = null;

export function loadSave(): SaveData {
  if (cache) return cache;
  try {
    const text = window.localStorage.getItem(SAVE_KEY);
    cache = text ? sanitizeSave(JSON.parse(text)) : emptySave();
  } catch {
    cache = emptySave();
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

/** 面ごとの最後の遊軍（なければ null） */
export function savedReserve(stageId: string): ReserveSetup | null {
  return cleanReserve(loadSave().reserves[stageId]);
}

/** 面ごとの最後の配置と遊軍を、一緒に書く（枠が空なら遊軍の鍵を消す。古い遊軍が新しい配置に付いて残らないように） */
export function savePlacements(stageId: string, placements: readonly Placement[], reserve: ReserveSetup | null = null): void {
  const data = loadSave();
  data.placements[stageId] = placements.map((p) => ({ kind: p.kind, col: p.col, row: p.row, stance: p.stance }));
  const r = cleanReserve(reserve);
  if (r) data.reserves[stageId] = r;
  else delete data.reserves[stageId];
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

/** チュートリアルを済ませたか（design §8.7） */
export function tutorialDone(): boolean {
  return loadSave().tutorialDone;
}

/** チュートリアルを済ませた印を付ける（最後まで遊ぶか、飛ばしたとき） */
export function markTutorialDone(): void {
  if (loadSave().tutorialDone) return;
  loadSave().tutorialDone = true;
  write();
}

/** 開発用：済みの印を付ける・外す */
export function setTutorialDoneForDebug(v: boolean): void {
  loadSave().tutorialDone = v;
  write();
}

/** 対戦のルール説明を見たか（design §10.2） */
export function pvpRulesSeen(): boolean {
  return loadSave().pvpRulesSeen;
}

/** ルール説明を見た印を付ける（ダイアログを「閉じる」で閉じたとき）。もう付いていれば書き込まない */
export function markPvpRulesSeen(): void {
  if (loadSave().pvpRulesSeen) return;
  loadSave().pvpRulesSeen = true;
  write();
}

/** 開発用：見た印を付ける・外す */
export function setPvpRulesSeenForDebug(v: boolean): void {
  loadSave().pvpRulesSeen = v;
  write();
}

/** 開発用：記録を消す */
export function clearSave(): void {
  cache = emptySave();
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

export function savedPvpReserve(): ReserveSetup | null {
  return cleanReserve(loadSave().pvpReserve);
}

/** 対戦の最後の配置と遊軍を、一緒に書く */
export function savePvpArmy(list: readonly Placement[], reserve: ReserveSetup | null = null): void {
  const data = loadSave();
  data.pvpArmy = list.map((p) => ({ kind: p.kind, col: p.col, row: p.row, stance: p.stance }));
  data.pvpReserve = cleanReserve(reserve);
  write();
}

export function savedFormations(): SavedFormation[] {
  return loadSave().formations.map(copyFormation);
}

/**
 * 陣形を保存する。同じ名前があれば上書きする。8つあって新しい名前なら、replaceIndex の陣形と入れ替える
 * （replaceIndex がなければ保存せず false を返す。画面が入れ替える相手を選ばせる）
 */
export function saveFormation(f: SavedFormation, replaceIndex?: number): boolean {
  const list = loadSave().formations;
  const same = list.findIndex((x) => x.name === f.name);
  const copy = copyFormation(f);
  if (same >= 0) list[same] = copy;
  else if (list.length < MAX_FORMATIONS) list.push(copy);
  else if (replaceIndex !== undefined && replaceIndex >= 0 && replaceIndex < list.length) list[replaceIndex] = copy;
  else return false;
  write();
  return true;
}

export function deleteFormation(name: string): void {
  const data = loadSave();
  data.formations = data.formations.filter((f) => f.name !== name);
  write();
}

export function savedView(): ViewMode {
  return loadSave().view;
}

export function saveView(v: ViewMode): void {
  loadSave().view = v;
  write();
}
