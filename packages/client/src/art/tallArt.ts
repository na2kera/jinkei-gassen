// 高さのある地形（森の木・柵・城壁）と門の絵を、視点の絵の組（FieldView.art）から選ぶ（design §5.8.1、§5.8.4）。
// どの絵を使うか・絵のどこをマスのどこに合わせるか・並べる値をここで決め、シーンと GateSprite はこれを呼ぶだけにする
// （シーンの側で視点の名前を見て分けない）。Phaser を使わない計算だけにして、画面なしで確かめられるようにする。

import type { Terrain } from '@jinkei/engine';
import type { ArtKind, FieldView } from '../battle/FieldView.ts';
import type { Rect } from '../layout.ts';
import { gateKey, SIDE_ART_W, SIDE_FENCE, SIDE_WALL, sideGateKey, TALL_ART_W, TALL_FENCE, TALL_TREE, TALL_WALL, tallGateKey } from './textures.ts';

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
   * マスの幅に合わせて伸ばすか（design §13.8）。none は原画のまま、width は横だけをマスの幅に、
   * both は縦横同じ倍率（マスの幅 ÷ 原画の幅）で伸ばす。fitW は原画の幅（px）
   */
  fit: 'none' | 'width' | 'both';
  fitW: number;
}

/**
 * 絵の組と地形の種類から、絵の鍵と置き方を返す。真上（flat）の木・柵・城壁は、地形のタイルに描いてあるので null。
 * alt は森の木の位置の互い違い（隣のマスと交互）。stage は門の壊れ具合
 */
export function tallArt(art: ArtKind, kind: TallKind, opts: { alt?: boolean; stage?: 0 | 1 | 2 } = {}): TallArt | null {
  const stage = opts.stage ?? 0;
  if (art === 'flat') {
    // 真上の門は、マスに平たく敷く
    // 真上の門は地面のタイルと同じ 32px で描いてあるので、伸ばさない
    return kind === 'gate' ? { key: gateKey(stage), originX: 0, originY: 0, ax: 0, ay: 0, dx: 0, dy: 0, depthBias: 0, fit: 'none', fitW: 0 } : null;
  }
  // 柵・城壁・門は、マスの幅に合わせて伸ばす。斜めは横だけ（原画の幅 24px）、
  // 横からは全体を同じ倍率で（原画の幅 18px。縦に伸びる部分も伸ばさないと、隣のマスとのあいだに切れ目ができるため）
  const fit = art === 'side' ? ({ fit: 'both', fitW: SIDE_ART_W } as const) : ({ fit: 'width', fitW: TALL_ART_W } as const);
  switch (kind) {
    case 'tree':
      // 1マスに小さな木を1本、隣のマスと位置を互い違いにして立てる（森の中の部隊が木に隠れきらないように）。
      // 互い違いは画面の横の向き（斜めは 32px のマスの 8px と 24px の所、横からは 24px のマスの同じ割合の所）。木は伸ばさない
      return { key: TALL_TREE, originX: 0.5, originY: 1, ax: opts.alt ? 0.75 : 0.25, ay: 1, dx: 0, dy: -2, depthBias: 0, fit: 'none', fitW: 0 };
    case 'fence':
      return { key: art === 'side' ? SIDE_FENCE : TALL_FENCE, originX: 0, originY: 1, ax: 0, ay: 1, dx: 0, dy: 0, depthBias: -1, ...fit };
    case 'wall':
      return { key: art === 'side' ? SIDE_WALL : TALL_WALL, originX: 0, originY: 1, ax: 0, ay: 1, dx: 0, dy: 0, depthBias: 0, ...fit };
    case 'gate':
      // 門は城壁と同じ高さで、マスの手前の端に下の端を合わせて立てる
      return { key: art === 'side' ? sideGateKey(stage) : tallGateKey(stage), originX: 0, originY: 1, ax: 0, ay: 1, dx: 0, dy: 0, depthBias: 0, ...fit };
  }
}

/** 絵を置く画面の位置（整数の px）と、並べる値。r はマスの矩形（FieldView.cellRect） */
export function placeTall(a: TallArt, r: Rect): { x: number; y: number; depth: number } {
  const x = Math.round(r.x + a.ax * r.w) + a.dx;
  const y = Math.round(r.y + a.ay * r.h) + a.dy;
  return { x, y, depth: y + a.depthBias };
}

/** 絵の倍率（横 sx・縦 sy）。r はマスの矩形。fit が none なら 1 のまま */
export function tallScale(a: TallArt, r: Rect): { sx: number; sy: number } {
  if (a.fit === 'none' || !(a.fitW > 0)) return { sx: 1, sy: 1 };
  const s = r.w / a.fitW;
  return a.fit === 'both' ? { sx: s, sy: s } : { sx: s, sy: 1 };
}

/** マス (col, row) の絵の倍率（tallScale(a, fv.cellRect)） */
export function tallScaleCell(a: TallArt, fv: FieldView, col: number, row: number): { sx: number; sy: number } {
  return tallScale(a, fv.cellRect(col, row));
}

/** マス (col, row) に、高さのある絵を置く位置と並べる値（placeTall(a, fv.cellRect)） */
export function placeTallCell(a: TallArt, fv: FieldView, col: number, row: number): { x: number; y: number; depth: number } {
  return placeTall(a, fv.cellRect(col, row));
}

/**
 * マスに敷く地形のタイルの種類。横からでは、柵のマスに平地の草を敷く
 * （柵のタイルには横木と杭が描いてあり、回さずに敷くと、立てた柵と向きが食い違うため）
 */
export function groundTerrain(art: ArtKind, terrain: Terrain): Terrain {
  return art === 'side' && terrain === 'fence' ? 'plain' : terrain;
}
