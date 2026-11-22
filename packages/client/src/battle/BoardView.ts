// 立体の画面の投影（design §14.4）。回転・傾き（0.75）・縮みを持つカメラで、戦場の座標を画面の px に写す。
// 古い FieldView（真上・斜め・横からの決まった投影）の代わり。シーンと絵は、ここの口だけを通す（向きの名前を見て分けない）。
// Phaser を読まない計算だけにして、画面なしで確かめられるようにする。

import type { Rect } from '../layout.ts';
import { ANGLES, SQUASH } from '../art/stack/bake.ts';
import { heightAt, type HeightMap } from '../art/stack/height.ts';

export interface Point {
  x: number;
  y: number;
}

export interface Cell {
  col: number;
  row: number;
}

/** 盤のマスの大きさ（盤の px） */
export const BOARD_CELL = 32;
/** 兵の背丈のぶん、盤の上に見る余白（px。いちばん奥の行の本陣の幟が入る値） */
export const TOP_EXTRA = 34;
/** 盤の端の兵がはみ出すぶん（左右に。px） */
export const SIDE_EXTRA = 8;

/** カメラ：rot は盤を画面の上で時計回りに回す角度（ラジアン）、k は縮み */
export interface Cam {
  rot: number;
  k: number;
}

/** 盤の広さ（列・行） */
export interface BoardSize {
  width: number;
  height: number;
}

/** その向きでの、盤の半分の広がり（px。縮み 1） */
function extents(rot: number, b: BoardSize): { ex: number; ey: number } {
  const hw = (b.width * BOARD_CELL) / 2;
  const hh = (b.height * BOARD_CELL) / 2;
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return { ex: hw * c + hh * s, ey: (hw * s + hh * c) * SQUASH };
}

/**
 * その向きで盤の全体が入る縮み。strict（戦闘の止まった向き・戦闘中の切り替え）は、兵の背丈と端の兵のはみ出しを見る。
 * ゆるい限り（配置・公開と公開の回転）は、盤そのものと兵の背丈が入ればよい
 */
export function limit(rot: number, strict: boolean, area: Rect, b: BoardSize): number {
  const { ex, ey } = extents(rot, b);
  if (strict) return Math.min(1, (area.w - 4) / (2 * ex + 2 * SIDE_EXTRA), area.h / (2 * ey + TOP_EXTRA + 6));
  return Math.min(1, area.w / (2 * ex), area.h / (2 * ey + TOP_EXTRA));
}

/** 止まった向きの縮み（戦闘はきつい限り、配置・公開は 1） */
export function fit(rot: number, battle: boolean, area: Rect, b: BoardSize): number {
  return battle ? limit(rot, true, area, b) : 1;
}

/** ゆっくり始まりゆっくり止まる進み具合 */
export function ease(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  return t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
}

/**
 * 始まりの (rot, k) から終わりの (rot, k) へ、進み具合 p（0〜1）のときのカメラ。途中の縮みは、その角度で入る限りで抑える
 * （まっすぐ結ぶと、途中の角度で盤が描き場所からはみ出すため。design §14.4）
 */
export function camBetween(from: Cam, to: Cam, p: number, strict: boolean, area: Rect, b: BoardSize): Cam {
  const e = ease(p);
  const rot = from.rot + (to.rot - from.rot) * e;
  const k = Math.min(from.k + (to.k - from.k) * e, limit(rot, strict, area, b));
  return { rot, k };
}

const DEG = Math.PI / 180;
export const deg = (d: number): number => d * DEG;

/** 投影（design §14.4）。カメラは動かせる（setCam）。高さの表があれば丘の高さを見る */
export class BoardView {
  readonly area: Rect;
  readonly cols: number;
  readonly rows: number;
  /** true なら 180° 返す（1人用で陣営1から見るとき。対戦の場面はサーバーが返し済み） */
  readonly flipped: boolean;
  readonly hm: HeightMap | null;
  private _cam: Cam = { rot: 0, k: 1 };
  private c = 1;
  private s = 0;
  private cx = 0;
  private cy = 0;

  constructor(area: Rect, field: BoardSize, opts: { flipped?: boolean; hm?: HeightMap | null; cam?: Cam } = {}) {
    this.area = area;
    this.cols = field.width;
    this.rows = field.height;
    this.flipped = opts.flipped ?? false;
    this.hm = opts.hm ?? null;
    this.setCam(opts.cam ?? { rot: 0, k: 1 });
  }

  get cam(): Cam {
    return { ...this._cam };
  }

  /** カメラを変える（三角関数と、盤のまん中の画面の位置は、ここで 1 回だけ求める） */
  setCam(cam: Cam): void {
    this._cam = { rot: cam.rot, k: cam.k };
    this.c = Math.cos(cam.rot);
    this.s = Math.sin(cam.rot);
    const { ey } = extents(cam.rot, this);
    const H = this.area.h;
    const k = cam.k;
    this.cx = this.area.x + this.area.w / 2;
    this.cy = this.area.y + (H - (2 * ey + TOP_EXTRA) * k) / 2 + TOP_EXTRA * k + ey * k;
  }

  /** 盤の width・height（extents に渡すため） */
  get width(): number {
    return this.cols;
  }
  get height(): number {
    return this.rows;
  }

  /** 盤のまん中の画面の位置 */
  get center(): Point {
    return { x: this.cx, y: this.cy };
  }

  /** 戦場の座標（マス）→ 盤のまん中を原点にした盤の px（返した表示なら符号を返す） */
  private uv(x: number, y: number): [number, number] {
    const u = (x - this.cols / 2) * BOARD_CELL;
    const v = (y - this.rows / 2) * BOARD_CELL;
    return this.flipped ? [-u, -v] : [u, v];
  }

  /** 高さ h（盤の px）の点を画面に写す。depth は持ち上げる前の y（奥ほど小さい）＋ 0.0001 × 画面の x */
  project(x: number, y: number, h = 0): { x: number; y: number; depth: number } {
    const [u, v] = this.uv(x, y);
    const k = this._cam.k;
    const sx = this.cx + k * (u * this.c - v * this.s);
    const gy = this.cy + k * SQUASH * (u * this.s + v * this.c);
    return { x: sx, y: gy - k * h, depth: gy + 0.0001 * sx };
  }

  /** その点の丘の高さ（盤の px。丘のない戦場は 0） */
  ground(x: number, y: number): number {
    if (!this.hm) return 0;
    const u = (x - this.cols / 2) * BOARD_CELL;
    const v = (y - this.rows / 2) * BOARD_CELL;
    return heightAt(this.hm, u, v);
  }

  /** 部隊や兵の足もと（丘の高さのぶん持ち上げる） */
  toScreen(x: number, y: number): Point {
    const p = this.project(x, y, this.ground(x, y));
    return { x: p.x, y: p.y };
  }

  /** 画面 → 戦場。丘の高さを見ながら、くり返して地面の点を探す（高さの差が 0.01 未満か、12 回まで） */
  toField(sx: number, sy: number): Point {
    const k = this._cam.k;
    let h = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < 12; i++) {
      const rx = (sx - this.cx) / k;
      const ry = (sy + k * h - this.cy) / (k * SQUASH);
      let u = rx * this.c + ry * this.s;
      let v = -rx * this.s + ry * this.c;
      if (this.flipped) {
        u = -u;
        v = -v;
      }
      x = u / BOARD_CELL + this.cols / 2;
      y = v / BOARD_CELL + this.rows / 2;
      const nh = this.ground(x, y);
      if (Math.abs(nh - h) < 0.01) break;
      h = nh;
    }
    return { x, y };
  }

  depthOf(x: number, y: number): number {
    return this.project(x, y).depth;
  }

  /** マスの中心の画面の px（丘の高さを見る） */
  cellCenter(col: number, row: number): Point {
    return this.toScreen(col + 0.5, row + 0.5);
  }

  /** マスの 4 隅の画面の px（地面の高さ 0。左上・右上・右下・左下の順。戦場の座標で回った順） */
  cellQuad(col: number, row: number): [Point, Point, Point, Point] {
    const p = (x: number, y: number): Point => {
      const q = this.project(x, y);
      return { x: q.x, y: q.y };
    };
    return [p(col, row), p(col + 1, row), p(col + 1, row + 1), p(col, row + 1)];
  }

  /** マスの 4 隅を囲む矩形（回っていなければマスそのもの。回っているときは囲みでしかない） */
  cellRect(col: number, row: number): Rect {
    const q = this.cellQuad(col, row);
    const x0 = Math.round(Math.min(...q.map((p) => p.x)));
    const x1 = Math.round(Math.max(...q.map((p) => p.x)));
    const y0 = Math.round(Math.min(...q.map((p) => p.y)));
    const y1 = Math.round(Math.max(...q.map((p) => p.y)));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** マスの縁（内側に inset px 寄せる）を 1 辺 8 点ずつ、丘の高さに沿って写した点の並び */
  cellOutline(col: number, row: number, inset = 0): Point[] {
    const d = inset / BOARD_CELL;
    const x0 = col + d;
    const y0 = row + d;
    const x1 = col + 1 - d;
    const y1 = row + 1 - d;
    const edges: [number, number, number, number][] = [
      [x0, y0, x1, y0],
      [x1, y0, x1, y1],
      [x1, y1, x0, y1],
      [x0, y1, x0, y0],
    ];
    const out: Point[] = [];
    for (const [ax, ay, bx, by] of edges)
      for (let i = 0; i < 8; i++) {
        const x = ax + ((bx - ax) * i) / 8;
        const y = ay + ((by - ay) * i) / 8;
        const p = this.project(x, y, this.ground(x, y));
        out.push({ x: p.x, y: p.y });
      }
    return out;
  }

  /** 画面の px → マス。戦場の外なら null */
  cellAt(sx: number, sy: number): Cell | null {
    const p = this.toField(sx, sy);
    const col = Math.floor(p.x);
    const row = Math.floor(p.y);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return { col, row };
  }

  /**
   * 戦場の向き (fx, fy) を、焼いた絵の角度の番号に直す。番号 0 は画面の上を向いた絵。
   * 返した表示では向きも返す。n = ANGLES（既定は 36）
   */
  angleIndex(fx: number, fy: number, n = ANGLES): number {
    const ux = this.flipped ? -fx : fx;
    const uy = this.flipped ? -fy : fy;
    const a = Math.round((Math.atan2(uy, ux) + Math.PI / 2 + this._cam.rot) / ((Math.PI * 2) / n));
    return ((a % n) + n) % n;
  }

  /** 盤の向き（地面の絵の回転。返した表示は 180° 足す） */
  get groundRotation(): number {
    return this._cam.rot + (this.flipped ? Math.PI : 0);
  }

  /** いまのカメラで盤が占める、軸にそろった囲みの矩形 */
  get rect(): Rect {
    const pts = [this.project(0, 0), this.project(this.cols, 0), this.project(this.cols, this.rows), this.project(0, this.rows)];
    const x0 = Math.min(...pts.map((p) => p.x));
    const x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    const y1 = Math.max(...pts.map((p) => p.y));
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  }

  /** 旗・数字の箱・押せる範囲を止める矩形：描き場所そのもの（どの向きでも同じ） */
  uiBounds(area: Rect): Rect {
    return { ...area };
  }

  contains(sx: number, sy: number): boolean {
    const r = this.area;
    return sx >= r.x && sy >= r.y && sx < r.x + r.w && sy < r.y + r.h;
  }
}
