// 「戦場の座標 → 画面の座標」（投影）と、その逆の変換を閉じ込める唯一の場所（design §5.2、§5.7、§5.8）。
// 視点（真上・斜め・横から・将軍）の違いと、対戦で上下左右を返す表示の違いは、すべてここで吸収する。
// シーンや絵の側で (x - originX) / CELL のような計算を書かないこと。視点の名前（mode）を見て分けないこと
// （standing、depthSorted、art などの値と、vecToScreen などの口を使う）。
//
// 斜め見下ろしは、遠近をつけない平行な投影：横はそのまま、縦を 0.6 倍に縮める（1マスが 24 × 14.4px）。
// 横からは、戦場の右の辺の外から左を向いて少し見下ろす：戦場の y（奥行き）を画面の横に 0.75 倍、
// 戦場の x を画面の縦に 0.6 倍で写す（1マスが 18 × 14.4px。自軍が左、敵軍が右。鏡写しにはならない）。
// 縮んで空いた分は、戦場を描き場所の中央に寄せる（centeredFieldView）。
//
// 将軍は、自分の本陣の位置から低く敵の方を見る、遠近つきの投影（design §5.8.3）：手前の辺からの奥行き d マスで
// 倍率 s = 3 / (1 + 2d / rows)、画面の横 = cx + (x − cols/2) × CELL × s、画面の縦 = 地平線 + 96 × s。
// 手前は本陣のまわり 4 列ぶんだけが枠に入り、奥は 12 列ぜんぶが入る。マスは台形になるので、
// 地形・霧・瓦礫のタイルは走査線（画面の横の1行）ごとに敷く（scanSpans）。

import type { Rect } from '../layout.ts';
import { CELL, FIELD_COLS, FIELD_ROWS } from '../layout.ts';
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
/** 将軍：地平線から、倍率 1 の所（戦場の奥の辺）までの px。倍率 s の所は地平線から GENERAL_H × s */
export const GENERAL_H = 96;
/** 将軍：手前の辺の倍率 */
const GENERAL_NEAR = 3;
/** 将軍：兵の絵の倍率の境目（2.5・1.5）の、式の丸めの誤差を見込む幅 */
const SCALE_EPS = 1e-9;

/** 将軍：走査線の上で、1つのマスにあたる横の区間（design §5.8.3 補足2） */
export interface ScanSpan {
  /** 画面の横の左端（含む）と右端（含まない）。整数の px */
  x0: number;
  x1: number;
  /** 表示の側の列と行（flipped を返したあと。戦場の外の仮のマスは 0 未満か cols・rows 以上） */
  dcol: number;
  drow: number;
  /** タイルの絵の、使う行（0〜tile−1） */
  tileRow: number;
  /**
   * タイルの絵の、使う横の範囲 [tx0, tx1)（px。小数のことがある）。ふつうは [0, tile)。
   * 枠の端をまたぐマスでは、枠の外に出る分を、描く先と同じ割合で切り落とした範囲
   */
  tx0: number;
  tx1: number;
}

export class FieldView {
  /** 戦場を描く画面の矩形（投影したあとの大きさ） */
  readonly rect: Rect;
  readonly cols: number;
  readonly rows: number;
  /** true なら上下左右を返す（1人用で陣営1から見るとき。対戦の場面はサーバーが返し済み） */
  readonly flipped: boolean;
  readonly mode: ViewMode;

  constructor(rect: Rect, cols: number, rows: number, flipped = false, mode: ViewMode = 'top') {
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

  /** 戦場の絵・兵・演出の層を、描き場所の矩形で切り抜くか（将軍だけ true。描き場所の外を板で覆う） */
  get masked(): boolean {
    return this.mode === 'general';
  }

  /** 遠近つきか（将軍だけ true）。マスが台形になるので、地形・霧・瓦礫は走査線で敷き、壁はマスの手前の辺の幅に合わせる */
  get perspective(): boolean {
    return this.mode === 'general';
  }

  /** 将軍：描き場所（12列×16行ぶん）。rect は描き場所の下半分なので、そこから戻す */
  private get genArea(): Rect {
    return { x: this.rect.x, y: this.rect.y - this.rect.h, w: this.rect.w, h: this.rect.h * 2 };
  }

  /** 将軍：画面の横の中央 */
  private get genCx(): number {
    return this.rect.x + this.rect.w / 2;
  }

  /** 将軍：地平線の画面の縦 */
  get horizonY(): number {
    return this.rect.y - GENERAL_H;
  }

  /** 将軍：表示の側の y（自軍が大きい側）での倍率 */
  private scaleAtDisplay(fy: number): number {
    const d = this.rows - fy;
    return GENERAL_NEAR / (1 + (d * 2) / this.rows);
  }

  /** 将軍：表示の側の x を、倍率 s の走査線の上の画面の横に直す */
  private scanX(dx: number, s: number): number {
    return this.genCx + (dx - this.cols / 2) * CELL * s;
  }

  /**
   * 旗と号令の印を、実際に描く矩形（旗のはためく 1px を含む）が uiBounds に収まるよう寄せるか。
   * 真上と斜めは false（§5.8 の前の判定のまま。旗が 1px はみ出すことがあるのも、そのまま残す）
   */
  get fitMarks(): boolean {
    return this.mode !== 'top' && this.mode !== 'oblique';
  }

  /** 高さのある地形の絵の組（art/tallArt.ts で、絵の鍵と置き方を選ぶ） */
  get art(): ArtKind {
    return this.mode === 'top' ? 'flat' : this.mode === 'side' ? 'side' : 'oblique';
  }

  /** 真上・斜めの縦の縮み（真上は 1） */
  private get yScale(): number {
    return this.mode === 'oblique' ? OBLIQUE_Y : 1;
  }

  /**
   * 兵の絵の倍率（整数。将軍の視点だけ 1 以外になる）。将軍では s を四捨五入した値
   * （s ≥ 2.5 で 3、1.5 ≤ s < 2.5 で 2、それ未満で 1。境目は、式の丸めの誤差 1e-9 までを境目ちょうどとみなす）
   */
  spriteScale(_x: number, y: number): number {
    if (this.mode !== 'general') return 1;
    const s = this.scaleAtDisplay(this.flipped ? this.rows - y : y);
    return s >= 2.5 - SCALE_EPS ? 3 : s >= 1.5 - SCALE_EPS ? 2 : 1;
  }

  /** 戦場の座標（マス単位、連続値）→ 画面の px */
  toScreen(x: number, y: number): Point {
    const fx = this.flipped ? this.cols - x : x;
    const fy = this.flipped ? this.rows - y : y;
    if (this.mode === 'side') {
      return { x: this.rect.x + (this.rows - fy) * CELL * SIDE_X, y: this.rect.y + fx * CELL * SIDE_Y };
    }
    if (this.mode === 'general') {
      const s = this.scaleAtDisplay(fy);
      return { x: this.scanX(fx, s), y: this.horizonY + GENERAL_H * s };
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
    } else if (this.mode === 'general') {
      // 地平線より上を押しても、有限の値（戦場のずっと奥）を返す
      const s = Math.max((sy - this.horizonY) / GENERAL_H, 1 / 64);
      y = this.rows - (GENERAL_NEAR / s - 1) * (this.rows / 2);
      x = this.cols / 2 + (sx - this.genCx) / (CELL * s);
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
  vecToScreen(x: number, y: number, vx: number, vy: number): Point {
    if (this.mode === 'general') {
      // 遠近つきでは場所で変わるので、両端を toScreen に通した差
      const a = this.toScreen(x, y);
      const b = this.toScreen(x + vx, y + vy);
      return { x: b.x - a.x, y: b.y - a.y };
    }
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
   * 縮みを除くのは、斜めで縦を縮めた向きから選ぶと、斜めを向いた部隊の絵が変わってしまうため（design §5.8.1）。
   * 将軍は真上と同じ値（返すだけ）。消える点へ寄る傾きは、絵の向きには入れない（design §5.8.3 補足1）
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

  /**
   * 将軍：画面の整数の行 sy（中心 sy + 0.5 で測る）の上の、表示の側の y と倍率 s。地平線とその上は null
   * （design §5.8.3 補足2）。ほかの視点では使わない（null）
   */
  scanline(sy: number): { y: number; s: number } | null {
    if (this.mode !== 'general') return null;
    const s = (sy + 0.5 - this.horizonY) / GENERAL_H;
    if (s <= 0) return null;
    return { y: this.rows - (GENERAL_NEAR / s - 1) * (this.rows / 2), s };
  }

  /** 将軍：画面の縦 sy（連続値）での倍率 s。ほかの視点では 1 */
  scaleAtScreenY(sy: number): number {
    return this.mode === 'general' ? (sy - this.horizonY) / GENERAL_H : 1;
  }

  /** 表示の側の座標（flipped を返したあと）→ 実際の列と行（flipped を戻す）。戦場の外の値もそのまま返す */
  cellOfDisplay(x: number, y: number): Cell {
    const c = Math.floor(x);
    const r = Math.floor(y);
    return this.flipped ? { col: this.cols - 1 - c, row: this.rows - 1 - r } : { col: c, row: r };
  }

  /**
   * 将軍：走査線 sy の上で、画面の横 [bx0, bx1) にかかるマスの区間（左から順）。列の境目は、左右の端をそれぞれ
   * 四捨五入した値を隣のマスと共有し、左を含み右を含まない（隙間も重なりも出さない）。戦場の外の仮のマスも含む。
   * tile はタイルの絵の大きさ（px）。地平線より上は空。
   * 枠の端をまたぐマスは、描く先を枠の中へ切り落とし、タイルの絵の側も同じ割合で切り落とす（tx0・tx1。
   * 絵を縮めて押し込まない。マスの本来の投影の幅を保つ）
   */
  scanSpans(sy: number, bx0: number, bx1: number, tile: number): ScanSpan[] {
    const sl = this.scanline(sy);
    if (!sl) return [];
    const drow = Math.floor(sl.y);
    const tileRow = Math.min(tile - 1, Math.max(0, Math.floor((sl.y - drow) * tile)));
    const unit = CELL * sl.s;
    const c0 = Math.floor(this.cols / 2 + (bx0 - this.genCx) / unit) - 1;
    const c1 = Math.ceil(this.cols / 2 + (bx1 - this.genCx) / unit) + 1;
    const out: ScanSpan[] = [];
    for (let c = c0; c < c1; c++) {
      // マスの本来の区間（丸めたあと）と、そのうち枠の中に入る部分
      const a = Math.round(this.scanX(c, sl.s));
      const b = Math.round(this.scanX(c + 1, sl.s));
      const x0 = Math.max(bx0, a);
      const x1 = Math.min(bx1, b);
      if (x1 <= x0) continue;
      const tx0 = x0 === a ? 0 : ((x0 - a) / (b - a)) * tile;
      const tx1 = x1 === b ? tile : ((x1 - a) / (b - a)) * tile;
      out.push({ x0, x1, dcol: c, drow, tileRow, tx0, tx1 });
    }
    return out;
  }

  /**
   * 部隊が見えているか：足もとの画面の点が、描き場所の矩形の中（左と上を含み、右と下を含まない）にあること。
   * 真上・斜め・横からは、いつも true（design §5.8.3 補足8）
   */
  visible(x: number, y: number): boolean {
    if (this.mode !== 'general') return true;
    const p = this.toScreen(x, y);
    const a = this.genArea;
    return p.x >= a.x && p.y >= a.y && p.x < a.x + a.w && p.y < a.y + a.h;
  }

  /** 号令の知らせと決着の文字を置く基準の矩形。将軍は描き場所（uiBounds）、ほかの視点はいままでどおり rect */
  noticeBounds(area: Rect): Rect {
    return this.mode === 'general' ? this.uiBounds(area) : this.rect;
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
   * 横から・将軍は、画面の上で、体のまん中から pickRadius 以内でいちばん近い部隊。同じ離れなら、手前（depthOf が大きい）の部隊。
   * 枠の外の部隊（visible が false）は選ばない
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
      // 枠の外の部隊は選ばない（将軍。ほかの視点ではいつも見えている）
      if (!this.visible(u.x, u.y)) continue;
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
  if (mode === 'general') {
    // 将軍の rect は、戦場の大きさによらず描き場所の下半分（奥の辺が描き場所の縦の中央、手前の辺が下の端。
    // 戦場の中央の列が画面の中央。手前の左右は枠の外へはみ出す）
    const gh = (FIELD_ROWS * CELL) / 2;
    return new FieldView({ x: area.x, y: area.y + area.h - gh, w: FIELD_COLS * CELL, h: gh }, field.width, field.height, flipped, mode);
  }
  const { w, h } = projectedSize(field, mode);
  // 幅が奇数の戦場は、半マスずらしてちょうど中央に置く（2px 単位に揃える）。外側の岩壁は描き場所の格子で先に全体に敷き、
  // その上に戦場のマスを重ねるので、半マスずれても切れ目は出ない（art/field.ts）
  const x = area.x + Math.round((area.w - w) / 4) * 2;
  const y = area.y + Math.round((area.h - h) / 4) * 2;
  return new FieldView({ x, y, w, h }, field.width, field.height, flipped, mode);
}
