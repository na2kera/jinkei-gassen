// 「戦場の座標 → 画面の座標」（投影）と、その逆の変換を閉じ込める唯一の場所（design §5.2、§5.7）。
// 真上と斜め見下ろし、対戦で上下左右を返す表示の違いは、すべてここで吸収する。
// シーンや絵の側で (x - originX) / CELL のような計算を書かないこと。
//
// 斜め見下ろしは、遠近をつけない平行な投影：横はそのまま、縦を 0.6 倍に縮める（1マスが 24 × 14.4px）。
// 縦が縮んで空いた分は、戦場を縦の中央に寄せる（centeredFieldView）。

import type { Rect } from '../layout.ts';
import { CELL } from '../layout.ts';

export interface Point {
  x: number;
  y: number;
}

export interface Cell {
  col: number;
  row: number;
}

/** 斜め見下ろしの縦の縮み */
export const OBLIQUE_Y = 0.6;

export class FieldView {
  constructor(
    /** 戦場を描く画面の矩形（投影したあとの大きさ） */
    readonly rect: Rect,
    readonly cols: number,
    readonly rows: number,
    /** true なら上下左右を返す（1人用で陣営1から見るとき。対戦の場面はサーバーが返し済み） */
    readonly flipped = false,
    /** true なら斜め見下ろし（縦を 0.6 倍） */
    readonly oblique = false,
  ) {}

  /** 縦の縮み（真上は 1） */
  get yScale(): number {
    return this.oblique ? OBLIQUE_Y : 1;
  }

  /** 戦場の座標（マス単位、連続値）→ 画面の px */
  toScreen(x: number, y: number): Point {
    const fx = this.flipped ? this.cols - x : x;
    const fy = this.flipped ? this.rows - y : y;
    return { x: this.rect.x + fx * CELL, y: this.rect.y + fy * CELL * this.yScale };
  }

  /**
   * 戦場の向き（単位ベクトル）→ 画面の上での向き（縮める前）。
   * 部隊の中の兵の並びはこの向きで回してから、縦だけ yScale で縮める（並びは戦場の座標で決めてから投影する）
   */
  dirToScreen(fx: number, fy: number): Point {
    return this.flipped ? { x: -fx, y: -fy } : { x: fx, y: fy };
  }

  /** マスの中心の画面の px */
  cellCenter(col: number, row: number): Point {
    return this.toScreen(col + 0.5, row + 0.5);
  }

  /**
   * マスの左上の画面の px と大きさ（地形のタイルを敷くため）。
   * 斜めでは高さが 14.4px になるので、隣のマスと隙間も重なりもないよう、上下の端を丸めてから差を取る
   */
  cellRect(col: number, row: number): Rect {
    const a = this.toScreen(col, row);
    const b = this.toScreen(col + 1, row + 1);
    const x0 = Math.round(Math.min(a.x, b.x));
    const x1 = Math.round(Math.max(a.x, b.x));
    const y0 = Math.round(Math.min(a.y, b.y));
    const y1 = Math.round(Math.max(a.y, b.y));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** 画面の px → 戦場の座標（toScreen の逆） */
  toField(sx: number, sy: number): Point {
    const x = (sx - this.rect.x) / CELL;
    const y = (sy - this.rect.y) / (CELL * this.yScale);
    return this.flipped ? { x: this.cols - x, y: this.rows - y } : { x, y };
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

  /** 画面の上での1マスの横幅 */
  get cellPx(): number {
    return CELL;
  }
}

/**
 * 戦場の幅が面で変わる（6〜12）ので、狭い戦場は、決まった描き場所（12列ぶん）の中央に寄せて描く。
 * 1マスの大きさは変えない。外側には岩壁の絵を置く（art/field.ts）。
 * 斜めのときは縦が縮むので、縦も中央に寄せる。
 * 配置の操作・枠・文字の位置は、どれもここで作った FieldView を通すので、幅や視点に合わせて動く。
 */
export function centeredFieldView(area: Rect, field: { width: number; height: number }, flipped = false, oblique = false): FieldView {
  const w = field.width * CELL;
  const h = Math.round(field.height * CELL * (oblique ? OBLIQUE_Y : 1));
  const x = area.x + Math.round((area.w - w) / 2 / CELL) * CELL;
  const y = area.y + Math.round((area.h - h) / 4) * 2;
  return new FieldView({ x, y, w, h }, field.width, field.height, flipped, oblique);
}
