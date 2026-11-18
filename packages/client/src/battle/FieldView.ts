// 「戦場の座標 → 画面の座標」（投影）と、その逆の変換を閉じ込める唯一の場所（design §5.2、§5.7、§5.8）。
// 視点（真上・斜め・横から）の違いと、対戦で上下左右を返す表示の違いは、すべてここで吸収する。
// シーンや絵の側で (x - originX) / CELL のような計算を書かないこと。視点の名前（mode）を見て分けないこと
// （standing、depthSorted、art などの値と、vecToScreen などの口を使う）。
//
// 斜め見下ろしは、遠近をつけない平行な投影：横はそのまま、縦を 0.6 倍に縮める（1マスが 24 × 14.4px）。
// 横からは、戦場の右の辺の外から左を向いて少し見下ろす：戦場の y（奥行き）を画面の横に 0.75 倍、
// 戦場の x を画面の縦に 0.6 倍で写す（1マスが 18 × 14.4px。自軍が左、敵軍が右。鏡写しにはならない）。
// 縮んで空いた分は、戦場を描き場所の中央に寄せる（centeredFieldView）。
//
// 将軍の視点（遠近つき）は、仕様が決まっていない（design §5.8.3）ので、まだ作らない。
// 足すときは、このファイルの変換（toScreen・toField・vecToScreen・facingOnScreen・spriteScale・masked・art）と、
// battle/viewMode.ts の VIEW_CYCLE、art/tallArt.ts の絵を足す。

import type { Rect } from '../layout.ts';
import { CELL } from '../layout.ts';
import type { ViewMode } from './viewMode.ts';

export interface Point {
  x: number;
  y: number;
}

export interface Cell {
  col: number;
  row: number;
}

/** 高さのある地形の絵の組（art/tallArt.ts）。flat は真上（立てない） */
export type ArtKind = 'flat' | 'oblique' | 'side';

/** 押して選べる部隊（戦場の座標） */
export interface PickTarget {
  id: number;
  x: number;
  y: number;
}

/** 斜め見下ろしの縦の縮み */
export const OBLIQUE_Y = 0.6;
/** 横からの、奥行き（戦場の y）の縮み。16 行で 288px */
export const SIDE_X = 0.75;
/** 横からの、戦場の x の縮み（斜めと同じ） */
export const SIDE_Y = 0.6;
/** 部隊を選べる、押した位置からの離れ（マス） */
const PICK_DIST = 0.55;
/** 斜めで部隊を選ぶとき、押した位置を下にずらす px（立った兵の体を押すことが多いため） */
const OBLIQUE_PICK_SHIFT = 6;
/** 立った兵の絵の高さ（10〜11px）の半分。横から部隊を選ぶときの「体のまん中」を、足もとからこれだけ上に取る */
const STAND_BODY = 5;

export class FieldView {
  /** 戦場を描く画面の矩形（投影したあとの大きさ） */
  readonly rect: Rect;
  readonly cols: number;
  readonly rows: number;
  /** true なら上下左右を返す（1人用で陣営1から見るとき。対戦の場面はサーバーが返し済み） */
  readonly flipped: boolean;
  readonly mode: ViewMode;

  constructor(rect: Rect, cols: number, rows: number, flipped = false, mode: ViewMode = 'top') {
    if (mode === 'general') throw new Error('将軍の視点の変換はまだない（design §5.8.3）');
    this.rect = rect;
    this.cols = cols;
    this.rows = rows;
    this.flipped = flipped;
    this.mode = mode;
  }

  /** 兵を立った姿の絵にするか（真上だけ false）。森の木・柵・城壁・門も、このとき高さのある絵で立てる */
  get standing(): boolean {
    return this.mode !== 'top';
  }

  /** 兵・門・森の木・柵・城壁を、奥のものから先に描く（depth の順に並べ直す）か（真上だけ false） */
  get depthSorted(): boolean {
    return this.mode !== 'top';
  }

  /** 戦場の絵・兵・演出の層を、描き場所の矩形で切り抜くか（将軍の視点で使う予定。いまはどれも false） */
  get masked(): boolean {
    return false;
  }

  /** 高さのある地形の絵の組（art/tallArt.ts で、絵の鍵と置き方を選ぶ） */
  get art(): ArtKind {
    return this.mode === 'top' ? 'flat' : this.mode === 'side' ? 'side' : 'oblique';
  }

  /** 真上・斜めの縦の縮み（真上は 1） */
  private get yScale(): number {
    return this.mode === 'oblique' ? OBLIQUE_Y : 1;
  }

  /** 兵の絵の倍率（整数。将軍の視点だけ 1 以外になる予定） */
  spriteScale(_x: number, _y: number): number {
    return 1;
  }

  /** 戦場の座標（マス単位、連続値）→ 画面の px */
  toScreen(x: number, y: number): Point {
    const fx = this.flipped ? this.cols - x : x;
    const fy = this.flipped ? this.rows - y : y;
    if (this.mode === 'side') {
      return { x: this.rect.x + (this.rows - fy) * CELL * SIDE_X, y: this.rect.y + fx * CELL * SIDE_Y };
    }
    return { x: this.rect.x + fx * CELL, y: this.rect.y + fy * CELL * this.yScale };
  }

  /** 画面の px → 戦場の座標（toScreen の逆） */
  toField(sx: number, sy: number): Point {
    let x: number;
    let y: number;
    if (this.mode === 'side') {
      x = (sy - this.rect.y) / (CELL * SIDE_Y);
      y = this.rows - (sx - this.rect.x) / (CELL * SIDE_X);
    } else {
      x = (sx - this.rect.x) / CELL;
      y = (sy - this.rect.y) / (CELL * this.yScale);
    }
    return this.flipped ? { x: this.cols - x, y: this.rows - y } : { x, y };
  }

  /**
   * 戦場の座標 (x, y) から (x + vx, y + vy) へのベクトルを、画面の px のベクトルに直す（design §5.8.1）。
   * 値は両端を toScreen に通した差。遠近のない視点では、どこでも同じ値になるので、引き算をせずに直接出す
   * （引き算の丸めの誤差で、兵の絵の位置が 1px ずれないように）
   */
  vecToScreen(_x: number, _y: number, vx: number, vy: number): Point {
    const ux = this.flipped ? -vx : vx;
    const uy = this.flipped ? -vy : vy;
    if (this.mode === 'side') return { x: -uy * CELL * SIDE_X, y: ux * CELL * SIDE_Y };
    return { x: ux * CELL, y: uy * CELL * this.yScale };
  }

  /**
   * 画面の点 (sx, sy)（戦場の座標では (x, y)）を、戦場の上で px で書いたずれ p − q（1マス = CELL px。兵の並びのずれ）
   * だけ動かした画面の点。sx + vecToScreen(x, y, (p − q) / CELL) と同じ値。
   * 真上と斜めでは、§5.8 の前の UnitSprite と足す順まで同じにして出す（横は (sx + p) − q、縦は sy + (p − q) × 縮み）。
   * 割って掛ける丸めや、足す順の違いの丸めで、兵の絵の位置が 1px も変わらないようにするため
   */
  shiftOnScreen(sx: number, sy: number, x: number, y: number, px: number, py: number, qx: number, qy: number): Point {
    if (this.mode === 'top' || this.mode === 'oblique') {
      const upx = this.flipped ? -px : px;
      const uqx = this.flipped ? -qx : qx;
      const dy = py - qy;
      const uy = this.flipped ? -dy : dy;
      return { x: sx + upx - uqx, y: sy + uy * this.yScale };
    }
    const dx = px - qx;
    const dy = py - qy;
    if (this.mode === 'side') {
      const ux = this.flipped ? -dx : dx;
      const uy = this.flipped ? -dy : dy;
      return { x: sx + -uy * SIDE_X, y: sy + ux * SIDE_Y };
    }
    const v = this.vecToScreen(x, y, dx / CELL, dy / CELL);
    return { x: sx + v.x, y: sy + v.y };
  }

  /**
   * 戦場の向き (fx, fy) が、画面の上でどちらを向くか（縦横の縮みを除いた向き）。兵の4方向の絵を選ぶために使う。
   * 縮みを除くのは、斜めで縦を縮めた向きから選ぶと、斜めを向いた部隊の絵が変わってしまうため（design §5.8.1）
   */
  facingOnScreen(_x: number, _y: number, fx: number, fy: number): Point {
    const ux = this.flipped ? -fx : fx;
    const uy = this.flipped ? -fy : fy;
    if (this.mode === 'side') return { x: -uy, y: ux };
    return { x: ux, y: uy };
  }

  /** 画面の点の、並べる値（画面で手前＝下のものほど大きい。同じ高さなら右のものを少しだけ手前にする） */
  depthAt(sx: number, sy: number): number {
    return sy + sx * 0.001;
  }

  /** 戦場の座標 → 並べる値（depthAt と同じ決め方） */
  depthOf(x: number, y: number): number {
    const p = this.toScreen(x, y);
    return this.depthAt(p.x, p.y);
  }

  /** マスの中心の画面の px */
  cellCenter(col: number, row: number): Point {
    return this.toScreen(col + 0.5, row + 0.5);
  }

  /** マスの4隅の画面の px（左上・右上・右下・左下の順。戦場の座標で回った順） */
  cellQuad(col: number, row: number): [Point, Point, Point, Point] {
    return [this.toScreen(col, row), this.toScreen(col + 1, row), this.toScreen(col + 1, row + 1), this.toScreen(col, row + 1)];
  }

  /**
   * マスの左上の画面の px と大きさ（地形のタイルを敷くため）。4隅を囲む矩形。
   * 斜めや横からでは高さが 14.4px になるので、隣のマスと隙間も重なりもないよう、端を丸めてから差を取る
   */
  cellRect(col: number, row: number): Rect {
    const q = this.cellQuad(col, row);
    const x0 = Math.round(Math.min(...q.map((p) => p.x)));
    const x1 = Math.round(Math.max(...q.map((p) => p.x)));
    const y0 = Math.round(Math.min(...q.map((p) => p.y)));
    const y1 = Math.round(Math.max(...q.map((p) => p.y)));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** 画面の px → マス。戦場の外なら null */
  cellAt(sx: number, sy: number): Cell | null {
    const p = this.toField(sx, sy);
    const col = Math.floor(p.x);
    const row = Math.floor(p.y);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return { col, row };
  }

  contains(sx: number, sy: number): boolean {
    const r = this.rect;
    return sx >= r.x && sy >= r.y && sx < r.x + r.w && sy < r.y + r.h;
  }

  /**
   * 旗・数字の箱・押せる範囲を止める矩形（描く絵を切り抜くものではない）。area は描き場所（12列×16行ぶん）。
   * 真上は戦場の矩形。斜めは、奥の行の兵や旗が戦場の矩形より上に伸びるので、縦は描き場所まで広げる
   * （横は戦場の幅。狭い戦場の外の岩壁には出さない）。横からは、縦も横も描き場所いっぱい
   */
  uiBounds(area: Rect): Rect {
    const f = this.rect;
    if (this.mode === 'top') return f;
    if (this.mode === 'oblique') return { x: f.x, y: area.y, w: f.w, h: area.h };
    return { x: area.x, y: area.y, w: area.w, h: area.h };
  }

  /** 部隊を画面の上で選ぶときの、体のまん中（立った兵は、足もとから絵の高さの半分だけ上） */
  pickPoint(x: number, y: number): Point {
    const p = this.toScreen(x, y);
    return this.standing ? { x: p.x, y: p.y - STAND_BODY * this.spriteScale(x, y) } : p;
  }

  /** 部隊を画面の上で選ぶときの、体のまん中からの離れ（px） */
  pickRadius(x: number, y: number): number {
    return PICK_DIST * CELL * this.spriteScale(x, y);
  }

  /**
   * 押した画面の位置から、部隊を1つ選ぶ（なければ null）。
   * 真上と斜めは、押した位置を戦場の座標に戻して、0.55 マス以内でいちばん近い部隊（斜めは 6px 下にずらしてから戻す）。
   * 横からは、画面の上で、体のまん中から pickRadius 以内でいちばん近い部隊。同じ離れなら、手前（depthOf が大きい）の部隊
   */
  pick(units: readonly PickTarget[], sx: number, sy: number): number | null {
    // 画面の上で選ぶときの「同じ離れ」の幅（px。浮動小数の丸めで、同じ離れが少し違って出るため）
    const same = 1e-6;
    if (this.mode === 'top' || this.mode === 'oblique') {
      const at = this.toField(sx, sy + (this.mode === 'oblique' ? OBLIQUE_PICK_SHIFT : 0));
      let best: { id: number; d: number } | null = null;
      for (const u of units) {
        const d = Math.hypot(u.x - at.x, u.y - at.y);
        if (d <= PICK_DIST && (!best || d < best.d)) best = { id: u.id, d };
      }
      return best ? best.id : null;
    }
    let best: { id: number; d: number; depth: number } | null = null;
    for (const u of units) {
      const c = this.pickPoint(u.x, u.y);
      const d = Math.hypot(c.x - sx, c.y - sy);
      if (d > this.pickRadius(u.x, u.y)) continue;
      const depth = this.depthOf(u.x, u.y);
      if (!best || d < best.d - same || (Math.abs(d - best.d) <= same && depth > best.depth)) best = { id: u.id, d, depth };
    }
    return best ? best.id : null;
  }
}

/** 視点ごとの、戦場の画面の上での大きさ（px） */
function projectedSize(field: { width: number; height: number }, mode: ViewMode): { w: number; h: number } {
  if (mode === 'side') return { w: Math.round(field.height * CELL * SIDE_X), h: Math.round(field.width * CELL * SIDE_Y) };
  return { w: field.width * CELL, h: Math.round(field.height * CELL * (mode === 'oblique' ? OBLIQUE_Y : 1)) };
}

/**
 * 戦場の幅が面で変わる（6〜12）ので、狭い戦場は、決まった描き場所（12列ぶん）の中央に寄せて描く。
 * 1マスの大きさは変えない。外側には岩壁の絵を置く（art/field.ts）。幅が奇数なら半マスずらして中央に置く。
 * 斜めのときは縦が縮むので、縦も中央に寄せる。横からは、戦場の横の幅が画面の縦になるので、狭い戦場は縦が短くなる。
 * 配置の操作・枠・文字の位置は、どれもここで作った FieldView を通すので、幅や視点に合わせて動く。
 * 配置と公開の画面は、真上（top）を渡す。
 */
export function centeredFieldView(area: Rect, field: { width: number; height: number }, flipped = false, mode: ViewMode = 'top'): FieldView {
  const { w, h } = projectedSize(field, mode);
  // 幅が奇数の戦場は、半マスずらしてちょうど中央に置く（2px 単位に揃える）。外側の岩壁は描き場所の格子で先に全体に敷き、
  // その上に戦場のマスを重ねるので、半マスずれても切れ目は出ない（art/field.ts）
  const x = area.x + Math.round((area.w - w) / 4) * 2;
  const y = area.y + Math.round((area.h - h) / 4) * 2;
  return new FieldView({ x, y, w, h }, field.width, field.height, flipped, mode);
}
