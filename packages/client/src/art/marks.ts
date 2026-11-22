// 部隊の印（旗・号令の印・方針の印・号令の相手の枠）の置き場所（design §5.3、§13.14）。
// Phaser を使わない計算だけにして、画面なしで「描く先が境界からはみ出さないか」を確かめられるようにする。
// 座標はどれも部隊の中心（整数の px）からのずれ。SquadSprite はこの値のとおりに描く（立体の画面では旗を出さない。UNIT_FLAG）。

import type { Rect } from '../layout.ts';

/**
 * 旗竿の左の端（部隊の中心から。px）。兵の並び（横に ±7px、絵の端で約 ±10px。art/formation.ts）の外に立てる。
 * 左に付け替えるときは、竿の右の端が −POLE_X になる
 */
export const POLE_X = 12;
/** 旗竿の幅と、はためくときに旗の下半分がずれる 1px */
export const POLE_W = 2;
export const WAVE_PX = 1;
/** 号令の印・方針の印の、部隊の中心からの離れ（兵の並びの外側。px） */
export const MARK_X = -16;
/** 号令の相手の枠の、部隊の中心からの半分の幅 */
export const FRAME_HALF = 16;
/** 号令の印（7 × 7）と方針の印（5 × 5）の大きさ */
export const ORDER_SIZE = 7;
export const STANCE_SIZE = 5;

export interface MarkLayout {
  /** 旗を竿の左に付け替えたか */
  mirror: boolean;
  /** 竿の左の端・上の端と高さ */
  poleX: number;
  poleTop: number;
  poleH: number;
  /** 旗の左の端（はためく前）・上の端・幅・高さ */
  flagX: number;
  flagY: number;
  flagW: number;
  flagH: number;
  /** 号令の印・方針の印の左上 */
  order: { x: number; y: number };
  stance: { x: number; y: number };
  /** 号令の相手の枠 */
  frame: Rect;
}

/** 範囲 [lo, hi] に v を寄せる。入らないとき（範囲が狭い）は lo を優先する */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/**
 * 印の置き場所。cx, cy は部隊の中心（整数の px）、bounds は描いてよい範囲（BoardView.uiBounds。なければ寄せない）。
 * 旗は、右の端（竿 + 旗 + はためく 1px）が範囲を超えるなら竿の左に付け替え、上の端を超えるなら竿ごと下げる。
 * 号令の印・方針の印・号令の相手の枠は、範囲からはみ出すときだけ、範囲の中に寄せる（はみ出さない位置では動かさない）
 */
export function markLayout(o: { cx: number; cy: number; hq: boolean; standing: boolean; morale: number; bounds?: Rect | undefined }): MarkLayout {
  const { cx, cy, hq, standing } = o;
  const b = o.bounds;
  const flagW = hq ? 10 : 6;
  const flagH = hq ? 8 : 4;
  // 立った兵のときは、兵より高く旗を立てる
  const poleH = standing ? (hq ? 30 : 26) : hq ? 24 : 20;
  let poleTop = standing ? (hq ? -34 : -30) : hq ? -22 : -18;
  let mirror = false;
  if (b) {
    if (cx + POLE_X + POLE_W + flagW + WAVE_PX > b.x + b.w) mirror = true;
    if (cy + poleTop < b.y) poleTop = b.y - cy;
  }
  const m = Math.max(0, Math.min(100, o.morale)) / 100;
  // 旗の位置は 2px 単位に揃える。士気が下がるほど旗が下がる
  const flagY = poleTop + Math.round(((1 - m) * (poleH - flagH)) / 2) * 2;
  const poleX = mirror ? -POLE_X - POLE_W : POLE_X;
  const flagX = mirror ? poleX - flagW : poleX + POLE_W;

  const order = { x: MARK_X, y: standing ? -26 : MARK_X };
  const stance = { x: MARK_X, y: 6 };
  // 立った兵のときは、兵（足もとから上へ伸びる）を囲む平たい形にする
  const top = standing ? -18 : -FRAME_HALF;
  const bottom = standing ? 6 : FRAME_HALF;
  const frame = { x: -FRAME_HALF, y: top, w: FRAME_HALF * 2, h: bottom - top };
  if (b) {
    const fit = (p: { x: number; y: number }, w: number, h: number): void => {
      p.x = clamp(p.x, b.x - cx, b.x + b.w - w - cx);
      p.y = clamp(p.y, b.y - cy, b.y + b.h - h - cy);
    };
    fit(order, ORDER_SIZE, ORDER_SIZE);
    fit(stance, STANCE_SIZE, STANCE_SIZE);
    fit(frame, frame.w, frame.h);
  }
  return { mirror, poleX, poleTop, poleH, flagX, flagY, flagW, flagH, order, stance, frame };
}

/**
 * 描く矩形（部隊の中心からのずれを、画面の px に直したもの）。旗ははためいたときの 1px も含める。
 * 確かめ用（どれも境界の中にあるか）
 */
export function markRects(l: MarkLayout, cx: number, cy: number): Record<'pole' | 'flag' | 'order' | 'stance' | 'frame', Rect> {
  const at = (x: number, y: number, w: number, h: number): Rect => ({ x: cx + x, y: cy + y, w, h });
  const flagX = l.mirror ? l.flagX - WAVE_PX : l.flagX;
  return {
    pole: at(l.poleX, l.poleTop, POLE_W, l.poleH),
    flag: at(flagX, l.flagY, l.flagW + WAVE_PX, l.flagH),
    order: at(l.order.x, l.order.y, ORDER_SIZE, ORDER_SIZE),
    stance: at(l.stance.x, l.stance.y, STANCE_SIZE, STANCE_SIZE),
    frame: at(l.frame.x, l.frame.y, l.frame.w, l.frame.h),
  };
}
