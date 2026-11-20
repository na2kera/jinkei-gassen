// ボタンの押せる範囲を広げる計算（design §9.2、§9.9-1・4）。見た目は変えず、押せる範囲だけを外へ広げる。
// Phaser を読まない純粋な関数にして、node のテストで実物の配置（layout.ts）を通して確かめられるようにする。
//
// 1辺ごとに、次のいちばん小さいものまで広げる：
//   上限 max ／ その辺の向かいにある、いちばん近いほかのボタン・障害物までのすき間の半分（切り捨て）／ 画面の端まで。
// 「向かいにある」は、広げる向きと直角の向きに自分を太らせた帯と重なること（斜め隣の角どうしが重ならないように）。
// ボタンどうしの帯は 2 × max 太らせる（両方が max ずつ広がるため。max だけだと斜め隣が広げたあと重なる。§9.9-1）。
// 障害物は広がらないので max でよい。自分と重なっている相手（重ねて出す箱など）は数えない。

import type { Rect } from '../layout.ts';

/** 1辺を広げる上限（内部の px） */
export const HIT_GROW_MAX = 8;

/** 押せる範囲の組。重ねて出す箱のボタンは 'popup' にして、下の画面のボタンと別に数える（§9.2、§9.9-4） */
export type HitGroup = 'base' | 'popup';

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** [a0, a1) を pad だけ太らせた帯と、[b0, b1) が重なるか */
function inBand(a0: number, a1: number, b0: number, b1: number, pad: number): boolean {
  return b0 < a1 + pad && b1 > a0 - pad;
}

interface Limits {
  left: number;
  right: number;
  up: number;
  down: number;
}

/** 相手 o が向かいにあれば、その向きの上限をすき間の半分まで下げる */
function limitBy(r: Rect, o: Rect, pad: number, lim: Limits): void {
  if (overlaps(r, o)) return;
  if (inBand(r.y, r.y + r.h, o.y, o.y + o.h, pad)) {
    // 左右の向かい
    if (o.x + o.w <= r.x) lim.left = Math.min(lim.left, Math.floor((r.x - (o.x + o.w)) / 2));
    if (o.x >= r.x + r.w) lim.right = Math.min(lim.right, Math.floor((o.x - (r.x + r.w)) / 2));
  }
  if (inBand(r.x, r.x + r.w, o.x, o.x + o.w, pad)) {
    // 上下の向かい
    if (o.y + o.h <= r.y) lim.up = Math.min(lim.up, Math.floor((r.y - (o.y + o.h)) / 2));
    if (o.y >= r.y + r.h) lim.down = Math.min(lim.down, Math.floor((o.y - (r.y + r.h)) / 2));
  }
}

/**
 * rects[i] を広げたものを [i] に入れて返す。obstacles は広がらないもの（戦場・入力欄）。bounds は画面。
 * 広げた範囲は、もとの矩形を必ず含む（縮めない）。
 */
export function growRects(rects: readonly Rect[], obstacles: readonly Rect[], bounds: Rect, max: number): Rect[] {
  return rects.map((r, i) => {
    const lim: Limits = {
      left: Math.min(max, Math.max(0, r.x - bounds.x)),
      right: Math.min(max, Math.max(0, bounds.x + bounds.w - (r.x + r.w))),
      up: Math.min(max, Math.max(0, r.y - bounds.y)),
      down: Math.min(max, Math.max(0, bounds.y + bounds.h - (r.y + r.h))),
    };
    rects.forEach((o, j) => {
      if (j !== i) limitBy(r, o, 2 * max, lim);
    });
    for (const o of obstacles) limitBy(r, o, max, lim);
    return { x: r.x - lim.left, y: r.y - lim.up, w: r.w + lim.left + lim.right, h: r.h + lim.up + lim.down };
  });
}

/**
 * 組を分けて広げる（§9.9-4）。
 *   'popup' のボタンは、同じ組のボタンと画面の端だけを数える（障害物は数えない。方針の箱は戦場の上に出るため）。
 *   'popup' のボタンが1つでもあるあいだ、'base' のボタンは広げない（箱の下に隠れたボタンの広げた分だけが、
 *   箱の外にはみ出して押せる、という穴を作らないため）。
 * 結果は items と同じ並び。
 */
export function growGroups(items: readonly { rect: Rect; group: HitGroup }[], obstacles: readonly Rect[], bounds: Rect, max: number): Rect[] {
  const out: Rect[] = items.map((it) => ({ ...it.rect }));
  const popup = items.map((it, i) => ({ it, i })).filter((x) => x.it.group === 'popup');
  if (popup.length > 0) {
    const grown = growRects(
      popup.map((x) => x.it.rect),
      [],
      bounds,
      max,
    );
    popup.forEach((x, k) => {
      out[x.i] = grown[k]!;
    });
    return out;
  }
  const grown = growRects(
    items.map((it) => it.rect),
    obstacles,
    bounds,
    max,
  );
  return grown;
}
