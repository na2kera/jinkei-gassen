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
const PORTRAIT_MIN_H = 568;
// 縦に伸ばしすぎると FIT で全体が小さくなるので上限を置く（細長い端末でも 19.5:9 程度まで）
const PORTRAIT_MAX_H = 720;
const GAP = 8;
/** 戦場の枠（4px）のぶんも含めた、戦場と操作の欄のあいだ */
const PANEL_GAP = 12;
/** 縦長の操作の欄の高さ（配置と戦闘のどちらのボタンも収まる高さ） */
const PORTRAIT_PANEL_H = 148;

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
  /** 手持ち5種（本陣・歩兵・盾兵・騎兵・弓兵の順） */
  roster: Rect[];
  /** ひな形7つ */
  templates: Rect[];
  start: Rect;
  /** 音を切るボタン */
  mute: Rect;
}

const MUTE_W = 64;

export function deployPanel(l: Layout): DeployPanel {
  const p = l.panel;
  if (l.mode === 'landscape') {
    const roster = row(p.x, p.y, p.w, 36, 5, 4);
    const t1 = row(p.x, p.y + 48, p.w, 32, 4, 4);
    const t2 = row(p.x, p.y + 84, p.w, 32, 4, 4).slice(0, 3);
    const by = p.y + p.h - 40;
    return {
      roster,
      templates: [...t1, ...t2],
      mute: { x: p.x, y: by, w: MUTE_W, h: 40 },
      start: { x: p.x + MUTE_W + 4, y: by, w: p.w - MUTE_W - 4, h: 40 },
    };
  }
  // ひな形は1列に7つ並べると、名前が枠に触れるほど窮屈になるので、4つと3つの2列にする
  const roster = row(p.x, p.y, p.w, 32, 5, 4);
  const t1 = row(p.x, p.y + 38, p.w, 32, 4, 4);
  const t2 = row(p.x, p.y + 74, p.w, 32, 4, 4).slice(0, 3);
  return {
    roster,
    templates: [...t1, ...t2],
    mute: { x: p.x, y: p.y + 112, w: MUTE_W, h: 36 },
    start: { x: p.x + MUTE_W + 4, y: p.y + 112, w: p.w - MUTE_W - 4, h: 36 },
  };
}

/** 戦闘の画面の操作の欄 */
export interface BattlePanel {
  time: Rect;
  /** 号令の残りの印（3つ） */
  marks: Rect[];
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
  const marks = [0, 1, 2].map((i) => ({ x: p.x + 64 + i * 16, y: p.y + (top - 10) / 2, w: 10, h: 10 }));
  const speed = { x: p.x + p.w - 56, y: p.y, w: 56, h: top };
  const mute = { x: speed.x - 4 - MUTE_W, y: p.y, w: MUTE_W, h: top };
  const targets = row(p.x, p.y + top + 8, p.w, bh, 4, 4);
  const orders = row(p.x, p.y + top + 8 + bh + 6, p.w, bh, 3, 4);
  return { time: { x: p.x, y: p.y, w: 56, h: top }, marks, mute, speed, targets, orders };
}

/** 結果の画面。画面全体の中央に、枠の箱と「もう一度」を縦に並べる */
export interface ResultLayout {
  centerX: number;
  box: Rect;
  /** 行ごとの y（上から） */
  title: number;
  reason: number;
  remaining: number;
  review: number;
  retry: Rect;
}

export function resultLayout(l: Layout): ResultLayout {
  const cx = l.width / 2;
  const boxW = l.mode === 'landscape' ? 320 : l.width - GAP * 2;
  const boxH = 264;
  const retryH = 40;
  // 箱と「もう一度」をひとまとまりにして、縦の中央に置く
  const top = even(Math.max(GAP, (l.height - boxH - 20 - retryH) / 2));
  const box = { x: even(cx - boxW / 2), y: top, w: boxW, h: boxH };
  return {
    centerX: cx,
    box,
    title: top + 20,
    reason: top + 68,
    remaining: top + 96,
    review: top + 140,
    retry: { x: even(cx - 80), y: top + boxH + 20, w: 160, h: retryH },
  };
}
