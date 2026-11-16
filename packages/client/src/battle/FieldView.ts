// 「戦場の座標 → 画面の座標」と、その逆の変換を閉じ込める唯一の場所（design §5.2）。
// 段階5の斜め視点や、対戦で上下左右を返す表示は、このクラスを差し替えて足す。
// シーンや絵の側で (x - originX) / CELL のような計算を書かないこと。

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

export class FieldView {
  constructor(
    /** 戦場を描く画面の矩形 */
    readonly rect: Rect,
    readonly cols: number,
    readonly rows: number,
    /** true なら上下左右を返す（対戦で陣営1が自分のとき用。今は使わない） */
    readonly flipped = false,
  ) {}

  /** 戦場の座標（マス単位、連続値）→ 画面の px */
  toScreen(x: number, y: number): Point {
    const fx = this.flipped ? this.cols - x : x;
    const fy = this.flipped ? this.rows - y : y;
    return { x: this.rect.x + fx * CELL, y: this.rect.y + fy * CELL };
  }

  /** 戦場の向き（単位ベクトル）→ 画面の向き */
  dirToScreen(fx: number, fy: number): Point {
    return this.flipped ? { x: -fx, y: -fy } : { x: fx, y: fy };
  }

  /** マスの中心の画面の px */
  cellCenter(col: number, row: number): Point {
    return this.toScreen(col + 0.5, row + 0.5);
  }

  /** マスの左上の画面の px と大きさ（背景を塗るため。斜め視点では菱形になるので差し替える） */
  cellRect(col: number, row: number): Rect {
    const c = this.cellCenter(col, row);
    return { x: c.x - CELL / 2, y: c.y - CELL / 2, w: CELL, h: CELL };
  }

  /** 画面の px → 戦場の座標 */
  toField(sx: number, sy: number): Point {
    const x = (sx - this.rect.x) / CELL;
    const y = (sy - this.rect.y) / CELL;
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

  /** 画面の上での1マスの大きさ（兵の並びの間隔などに使う） */
  get cellPx(): number {
    return CELL;
  }
}

/**
 * 戦場の幅が面で変わる（6〜12）ので、狭い戦場は、決まった描き場所（12列ぶん）の中央に寄せて描く。
 * 1マスの大きさは変えない。外側には岩壁の絵を置く（art/field.ts）。
 * 配置の操作・枠・文字の位置は、どれもここで作った FieldView を通すので、幅に合わせて動く。
 */
export function centeredFieldView(area: Rect, field: { width: number; height: number }, flipped = false): FieldView {
  const w = field.width * CELL;
  const h = field.height * CELL;
  const x = area.x + Math.round((area.w - w) / 2 / CELL) * CELL;
  const y = area.y + Math.round((area.h - h) / 2 / CELL) * CELL;
  return new FieldView({ x, y, w, h }, field.width, field.height, flipped);
}
