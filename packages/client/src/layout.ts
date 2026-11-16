// 画面の置き場所を決める唯一の場所（design §5.3、assumptions S13）。
// シーンはここで決めた矩形を読むだけにし、座標の数字を直書きしない。
// 向きが変わったときに、ここを計算し直すだけで全画面が組み直せるようにするため。

export type Mode = 'landscape' | 'portrait';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  mode: Mode;
  /** 内部の大きさ（Phaser の gameSize） */
  width: number;
  height: number;
  /** 戦場を描く矩形（どちらの向きでも 288 × 384） */
  field: Rect;
  /** 操作の欄 */
  panel: Rect;
}

/** 1マスの大きさ（px） */
export const CELL = 24;
export const FIELD_COLS = 12;
export const FIELD_ROWS = 16;
const FIELD_W = CELL * FIELD_COLS;
const FIELD_H = CELL * FIELD_ROWS;

const LANDSCAPE_W = 640;
const LANDSCAPE_H = 400;
const PORTRAIT_W = 320;
// S13 の下限は 568 だが、面の名前・戻る・ひな形2列が入るよう 600 にする（これより細長い端末では左右が少し空く）
const PORTRAIT_MIN_H = 600;
// 縦に伸ばしすぎると FIT で全体が小さくなるので上限を置く（細長い端末でも 19.5:9 程度まで）
const PORTRAIT_MAX_H = 720;
const GAP = 8;
/** 戦場の枠（4px）のぶんも含めた、戦場と操作の欄のあいだ */
const PANEL_GAP = 12;
/** 縦長の操作の欄の高さ（配置と戦闘のどちらのボタンも収まる高さ） */
const PORTRAIT_PANEL_H = 190;

/** 2px 単位に揃える（ドットの枠がずれないように） */
function even(n: number): number {
  return Math.round(n / 2) * 2;
}

/** 親要素の大きさから、向きと内部の大きさを決める */
export function computeLayout(parentW: number, parentH: number): Layout {
  const portrait = parentW > 0 && parentH > 0 && parentH > parentW;
  if (!portrait) {
    return {
      mode: 'landscape',
      width: LANDSCAPE_W,
      height: LANDSCAPE_H,
      field: { x: GAP, y: GAP, w: FIELD_W, h: FIELD_H },
      panel: { x: GAP * 2 + FIELD_W, y: GAP, w: LANDSCAPE_W - FIELD_W - GAP * 3, h: FIELD_H },
    };
  }
  // 画面の縦横比に合わせて縦を伸ばす。伸ばした分は、戦場と操作の欄をひとまとまりにして縦の中央に寄せ、
  // 上下に均等に配る（操作の欄の下だけが大きく空かないようにするため）
  const h = Math.min(PORTRAIT_MAX_H, Math.max(PORTRAIT_MIN_H, Math.round((PORTRAIT_W * parentH) / parentW)));
  const fieldX = (PORTRAIT_W - FIELD_W) / 2;
  const block = FIELD_H + PANEL_GAP + PORTRAIT_PANEL_H;
  const top = even(Math.max(GAP, (h - block) / 2));
  return {
    mode: 'portrait',
    width: PORTRAIT_W,
    height: h,
    field: { x: fieldX, y: top, w: FIELD_W, h: FIELD_H },
    panel: { x: GAP, y: top + FIELD_H + PANEL_GAP, w: PORTRAIT_W - GAP * 2, h: PORTRAIT_PANEL_H },
  };
}

let current: Layout = computeLayout(LANDSCAPE_W, LANDSCAPE_H);

export function getLayout(): Layout {
  return current;
}

export function setLayout(next: Layout): void {
  current = next;
}

export function sameSize(a: Layout, b: Layout): boolean {
  return a.width === b.width && a.height === b.height;
}

/** game.events に流す、置き場所が変わった合図 */
export const LAYOUT_EVENT = 'jg-layout';

/** 横に n 個、同じ幅で並べる（端数は左から1px ずつ配る代わりに、全体を左に寄せる） */
function row(x: number, y: number, w: number, h: number, n: number, gap: number): Rect[] {
  const bw = Math.floor((w - gap * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => ({ x: x + i * (bw + gap), y, w: bw, h }));
}

/** 配置の画面の操作の欄 */
export interface DeployPanel {
  /** ステージ選択へ戻る */
  back: Rect;
  /** 面の名前を書く場所（左端と縦の中央） */
  name: { x: number; y: number };
  /** 音を切るボタン */
  mute: Rect;
  /** 手持ち5種（本陣・歩兵・盾兵・騎兵・弓兵の順） */
  roster: Rect[];
  /** ひな形7つ */
  templates: Rect[];
  start: Rect;
}

const MUTE_W = 64;
const BACK_W = 56;

export function deployPanel(l: Layout): DeployPanel {
  const p = l.panel;
  const head = 32;
  const back = { x: p.x, y: p.y, w: BACK_W, h: head };
  const mute = { x: p.x + p.w - MUTE_W, y: p.y, w: MUTE_W, h: head };
  const name = { x: p.x + BACK_W + 8, y: p.y + head / 2 };
  if (l.mode === 'landscape') {
    const roster = row(p.x, p.y + 42, p.w, 36, 5, 4);
    const t1 = row(p.x, p.y + 88, p.w, 32, 4, 4);
    const t2 = row(p.x, p.y + 124, p.w, 32, 4, 4).slice(0, 3);
    return { back, name, mute, roster, templates: [...t1, ...t2], start: { x: p.x, y: p.y + p.h - 40, w: p.w, h: 40 } };
  }
  // ひな形は1列に7つ並べると、名前が枠に触れるほど窮屈になるので、4つと3つの2列にする
  const roster = row(p.x, p.y + 38, p.w, 32, 5, 4);
  const t1 = row(p.x, p.y + 76, p.w, 30, 4, 4);
  const t2 = row(p.x, p.y + 110, p.w, 30, 4, 4).slice(0, 3);
  return { back, name, mute, roster, templates: [...t1, ...t2], start: { x: p.x, y: p.y + 148, w: p.w, h: 38 } };
}

/** 戦闘の画面の操作の欄 */
export interface BattlePanel {
  time: Rect;
  /** 号令の残りの印（3つ） */
  marks: Rect[];
  /** やめる（配置へ戻る） */
  quit: Rect;
  /** 音を切るボタン */
  mute: Rect;
  speed: Rect;
  /** 全軍・左翼・中央・右翼 */
  targets: Rect[];
  /** 突撃・堅守・後退 */
  orders: Rect[];
}

export function battlePanel(l: Layout): BattlePanel {
  const p = l.panel;
  const top = 32;
  const bh = l.mode === 'landscape' ? 36 : 34;
  const marks = [0, 1, 2].map((i) => ({ x: p.x + 44 + i * 16, y: p.y + (top - 10) / 2, w: 10, h: 10 }));
  const speed = { x: p.x + p.w - 56, y: p.y, w: 56, h: top };
  const mute = { x: speed.x - 4 - MUTE_W, y: p.y, w: MUTE_W, h: top };
  const quit = { x: p.x + 96, y: p.y, w: mute.x - 4 - (p.x + 96), h: top };
  const targets = row(p.x, p.y + top + 8, p.w, bh, 4, 4);
  const orders = row(p.x, p.y + top + 8 + bh + 6, p.w, bh, 3, 4);
  return { time: { x: p.x, y: p.y, w: 40, h: top }, marks, quit, mute, speed, targets, orders };
}

/** 結果の画面。画面全体の中央に、枠の箱とボタンの列を縦に並べる */
export interface ResultLayout {
  centerX: number;
  box: Rect;
  /** 行ごとの y（上から） */
  title: number;
  reason: number;
  stars: number;
  review: number;
  /** もう一度・次へ・戻る */
  buttons: Rect[];
}

export function resultLayout(l: Layout): ResultLayout {
  const cx = l.width / 2;
  const boxW = l.mode === 'landscape' ? 320 : l.width - GAP * 2;
  const boxH = 272;
  const btnH = 40;
  // 箱とボタンをひとまとまりにして、縦の中央に置く
  const top = even(Math.max(GAP, (l.height - boxH - 16 - btnH) / 2));
  const box = { x: even(cx - boxW / 2), y: top, w: boxW, h: boxH };
  const rowW = l.mode === 'landscape' ? 320 : l.width - GAP * 2;
  return {
    centerX: cx,
    box,
    title: top + 16,
    reason: top + 60,
    stars: top + 88,
    review: top + 124,
    buttons: row(even(cx - rowW / 2), top + boxH + 16, rowW, btnH, 3, 6),
  };
}

/** タイトルの画面 */
export interface TitleLayout {
  centerX: number;
  title: number;
  stage: Rect;
  pvp: Rect;
  mute: Rect;
}

export function titleLayout(l: Layout): TitleLayout {
  const cx = l.width / 2;
  const top = even(l.height / 2 - 96);
  const w = 160;
  return {
    centerX: cx,
    title: top,
    stage: { x: even(cx - w / 2), y: top + 72, w, h: 40 },
    pvp: { x: even(cx - w / 2), y: top + 124, w, h: 40 },
    mute: { x: l.width - GAP - MUTE_W, y: l.height - GAP - 32, w: MUTE_W, h: 32 },
  };
}

/** ステージ選択の画面。章の見出しと、面のボタンを縦に並べる */
export interface StageSelectLayout {
  back: Rect;
  /** 章の見出し。章が2つ以上あれば、ここに章を切り替えるボタンを並べる */
  heading: Rect;
  /** 面のボタン（count 個） */
  stages: Rect[];
}

export function stageSelectLayout(l: Layout, count: number): StageSelectLayout {
  const w = l.mode === 'landscape' ? 320 : l.width - GAP * 2;
  const x = even(l.width / 2 - w / 2);
  const rowH = 40;
  const gap = 6;
  const listH = count * rowH + (count - 1) * gap;
  const top = even(Math.max(48, (l.height - listH) / 2 + 16));
  return {
    back: { x: GAP, y: GAP, w: BACK_W, h: 32 },
    heading: { x, y: top - 44, w, h: 32 },
    stages: Array.from({ length: count }, (_, i) => ({ x, y: top + i * (rowH + gap), w, h: rowH })),
  };
}

/** 対戦の画面（準備中） */
export function lobbyLayout(l: Layout): { centerX: number; text: number; back: Rect } {
  return { centerX: l.width / 2, text: even(l.height / 2 - 16), back: { x: GAP, y: GAP, w: BACK_W, h: 32 } };
}
