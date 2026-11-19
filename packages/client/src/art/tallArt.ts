// 高さのある地形（森の木・柵・城壁）と門の絵を、視点の絵の組（FieldView.art）から選ぶ（design §5.8.1、§5.8.4）。
// どの絵を使うか・絵のどこをマスのどこに合わせるか・並べる値をここで決め、シーンと GateSprite はこれを呼ぶだけにする
// （シーンの側で視点の名前を見て分けない）。Phaser を使わない計算だけにして、画面なしで確かめられるようにする。

import type { Terrain } from '@jinkei/engine';
import type { ArtKind, FieldView } from '../battle/FieldView.ts';
import type { Rect } from '../layout.ts';
import { gateKey, SIDE_FENCE, SIDE_WALL, sideGateKey, TALL_FENCE, TALL_TREE, TALL_WALL, tallGateKey } from './textures.ts';

export type TallKind = 'tree' | 'fence' | 'wall' | 'gate';

/** 絵の鍵と置き方 */
export interface TallArt {
  key: string;
  /** 絵の原点（0〜1） */
  originX: number;
  originY: number;
  /** 原点を合わせる所：マスの矩形の中の割合（0〜1）に、px のずれを足す */
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  /** 並べる値の、置いた位置（画面の縦）からのずれ。同じマスの部隊より奥・手前のどちらに描くかを決める */
  depthBias: number;
  /**
   * 遠近つきの視点（将軍）で、マスの手前の辺の幅に合わせて伸び縮みさせるか（柵・城壁・門）。
   * false なら、兵と同じ整数倍（森の木）。遠近のない視点では使わない
   */
  stretch: boolean;
}

/** 置く位置と並べる値、絵の倍率（遠近のない視点では、倍率はいつも 1） */
export interface TallPlace {
  x: number;
  y: number;
  depth: number;
  scaleX: number;
  scaleY: number;
}

/**
 * 絵の組と地形の種類から、絵の鍵と置き方を返す。真上（flat）の木・柵・城壁は、地形のタイルに描いてあるので null。
 * alt は森の木の位置の互い違い（隣のマスと交互）。stage は門の壊れ具合
 */
export function tallArt(art: ArtKind, kind: TallKind, opts: { alt?: boolean; stage?: 0 | 1 | 2 } = {}): TallArt | null {
  const stage = opts.stage ?? 0;
  if (art === 'flat') {
    // 真上の門は、マスに平たく敷く
    return kind === 'gate' ? { key: gateKey(stage), originX: 0, originY: 0, ax: 0, ay: 0, dx: 0, dy: 0, depthBias: 0, stretch: false } : null;
  }
  switch (kind) {
    case 'tree':
      // 1マスに小さな木を1本、隣のマスと位置を互い違いにして立てる（森の中の部隊が木に隠れきらないように）。
      // 互い違いは画面の横の向き（斜めは 24px のマスの 6px と 18px の所、横からは 18px のマスの同じ割合の所）
      return { key: TALL_TREE, originX: 0.5, originY: 1, ax: opts.alt ? 0.75 : 0.25, ay: 1, dx: 0, dy: -2, depthBias: 0, stretch: false };
    case 'fence':
      return { key: art === 'side' ? SIDE_FENCE : TALL_FENCE, originX: 0, originY: 1, ax: 0, ay: 1, dx: 0, dy: 0, depthBias: -1, stretch: true };
    case 'wall':
      return { key: art === 'side' ? SIDE_WALL : TALL_WALL, originX: 0, originY: 1, ax: 0, ay: 1, dx: 0, dy: 0, depthBias: 0, stretch: true };
    case 'gate':
      // 門は城壁と同じ高さで、マスの手前の端に下の端を合わせて立てる
      return { key: art === 'side' ? sideGateKey(stage) : tallGateKey(stage), originX: 0, originY: 1, ax: 0, ay: 1, dx: 0, dy: 0, depthBias: 0, stretch: true };
  }
}

/** 絵を置く画面の位置（整数の px）と、並べる値。r はマスの矩形（FieldView.cellRect） */
export function placeTall(a: TallArt, r: Rect): { x: number; y: number; depth: number } {
  const x = Math.round(r.x + a.ax * r.w) + a.dx;
  const y = Math.round(r.y + a.ay * r.h) + a.dy;
  return { x, y, depth: y + a.depthBias };
}

/**
 * 柵・城壁・門を、横の区間に合わせて置く（将軍。design §5.8.3 補足6）。left・width は置く左端と幅（整数の px）、
 * ground は下の端（接地の画面の縦。整数）、scaleY は縦の倍率（その行で共通）。size は絵の大きさ。
 * 高さは round(絵の高さ × scaleY)。並べる値は接地の位置から決める
 */
export function placeTallSpan(a: TallArt, left: number, width: number, ground: number, scaleY: number, size: { w: number; h: number }): TallPlace {
  const h = Math.round(size.h * scaleY);
  return { x: left, y: ground, depth: ground + a.depthBias, scaleX: width / size.w, scaleY: h / size.h };
}

/**
 * マス (col, row) に、高さのある絵を置く位置と倍率。遠近のない視点では placeTall(a, fv.cellRect) のまま（倍率 1）。
 * 遠近つき（将軍）では、柵・城壁・門は、マスの手前の辺（画面で縦が大きい辺）の左右の端をそれぞれ四捨五入して、
 * 左端と幅にする（隣のマスと端を共有する）。縦の倍率は手前の辺の s（行で共通）。森の木は、そのマスの spriteScale 倍
 */
export function placeTallCell(a: TallArt, fv: FieldView, col: number, row: number, size: { w: number; h: number }): TallPlace {
  const r = fv.cellRect(col, row);
  if (!fv.perspective) return { ...placeTall(a, r), scaleX: 1, scaleY: 1 };
  if (!a.stretch) {
    const k = fv.spriteScale(col + 0.5, row + 0.5);
    return { ...placeTall(a, r), scaleX: k, scaleY: k };
  }
  const q = fv.cellQuad(col, row);
  // 4隅は、戦場の座標の行 row の辺（0, 1）と row + 1 の辺（2, 3）。画面で縦が大きい方が手前
  const front = q[0].y > q[2].y ? [q[0], q[1]] : [q[2], q[3]];
  const x0 = Math.round(Math.min(front[0]!.x, front[1]!.x));
  const x1 = Math.round(Math.max(front[0]!.x, front[1]!.x));
  // 手前の辺の s。画面の縦は行だけで決まるので、同じ行のマスはどれもちょうど同じ値になる
  const s = fv.scaleAtScreenY(front[0]!.y);
  return placeTallSpan(a, x0, x1 - x0, Math.round(front[0]!.y), s, size);
}

/**
 * マスに敷く地形のタイルの種類。横からでは、柵のマスに平地の草を敷く
 * （柵のタイルには横木と杭が描いてあり、回さずに敷くと、立てた柵と向きが食い違うため）
 */
export function groundTerrain(art: ArtKind, terrain: Terrain): Terrain {
  return art === 'side' && terrain === 'fence' ? 'plain' : terrain;
}
