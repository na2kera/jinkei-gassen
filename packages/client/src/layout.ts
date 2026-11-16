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
  // 画面の縦横比に合わせて縦を伸ばし、余った分は操作の欄に回す
  const h = Math.min(PORTRAIT_MAX_H, Math.max(PORTRAIT_MIN_H, Math.round((PORTRAIT_W * parentH) / parentW)));
  const fieldX = (PORTRAIT_W - FIELD_W) / 2;
  const panelY = GAP + FIELD_H + GAP;
  return {
    mode: 'portrait',
    width: PORTRAIT_W,
    height: h,
    field: { x: fieldX, y: GAP, w: FIELD_W, h: FIELD_H },
    panel: { x: GAP, y: panelY, w: PORTRAIT_W - GAP * 2, h: h - panelY - GAP },
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
}

export function deployPanel(l: Layout): DeployPanel {
  const p = l.panel;
  if (l.mode === 'landscape') {
    const roster = row(p.x, p.y, p.w, 32, 5, 4);
    const t1 = row(p.x, p.y + 48, p.w, 28, 4, 4);
    const t2 = row(p.x, p.y + 80, p.w, 28, 4, 4).slice(0, 3);
    return { roster, templates: [...t1, ...t2], start: { x: p.x, y: p.y + p.h - 40, w: p.w, h: 40 } };
  }
  const roster = row(p.x, p.y, p.w, 28, 5, 4);
  const templates = row(p.x, p.y + 36, p.w, 28, 7, 4);
  return { roster, templates, start: { x: p.x, y: p.y + 72, w: p.w, h: 36 } };
}

/** 戦闘の画面の操作の欄 */
export interface BattlePanel {
  time: Rect;
  /** 号令の残りの印（3つ） */
  marks: Rect[];
  speed: Rect;
  /** 全軍・左翼・中央・右翼 */
  targets: Rect[];
  /** 突撃・堅守・後退 */
  orders: Rect[];
}

export function battlePanel(l: Layout): BattlePanel {
  const p = l.panel;
  const top = l.mode === 'landscape' ? 32 : 28;
  const marks = [0, 1, 2].map((i) => ({ x: p.x + 72 + i * 20, y: p.y + (top - 12) / 2, w: 12, h: 12 }));
  const speed = { x: p.x + p.w - 64, y: p.y, w: 64, h: top };
  const targets = row(p.x, p.y + top + 8, p.w, 32, 4, 4);
  const orders = row(p.x, p.y + top + 48, p.w, 32, 3, 4);
  return { time: { x: p.x, y: p.y, w: 64, h: top }, marks, speed, targets, orders };
}

/** 結果の画面。画面全体の中央に縦に並べる */
export interface ResultLayout {
  centerX: number;
  /** 行ごとの y（上から） */
  title: number;
  reason: number;
  remaining: number;
  review: number;
  retry: Rect;
}

export function resultLayout(l: Layout): ResultLayout {
  const cx = l.width / 2;
  const top = l.mode === 'landscape' ? 48 : 96;
  return {
    centerX: cx,
    title: top,
    reason: top + 48,
    remaining: top + 80,
    review: top + 128,
    retry: { x: cx - 80, y: l.height - (l.mode === 'landscape' ? 72 : 120), w: 160, h: 40 },
  };
}
