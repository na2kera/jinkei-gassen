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
}

/**
 * 絵の組と地形の種類から、絵の鍵と置き方を返す。真上（flat）の木・柵・城壁は、地形のタイルに描いてあるので null。
 * alt は森の木の位置の互い違い（隣のマスと交互）。stage は門の壊れ具合
 */
export function tallArt(art: ArtKind, kind: TallKind, opts: { alt?: boolean; stage?: 0 | 1 | 2 } = {}): TallArt | null {
  const stage = opts.stage ?? 0;
  if (art === 'flat') {
    // 真上の門は、マスに平たく敷く
    return kind === 'gate' ? { key: gateKey(stage), originX: 0, originY: 0, ax: 0, ay: 0, dx: 0, dy: 0, depthBias: 0 } : null;
  }
  switch (kind) {
    case 'tree':
      // 1マスに小さな木を1本、隣のマスと位置を互い違いにして立てる（森の中の部隊が木に隠れきらないように）。
      // 互い違いは画面の横の向き（斜めは 24px のマスの 6px と 18px の所、横からは 18px のマスの同じ割合の所）
      return { key: TALL_TREE, originX: 0.5, originY: 1, ax: opts.alt ? 0.75 : 0.25, ay: 1, dx: 0, dy: -2, depthBias: 0 };
    case 'fence':
      return { key: art === 'side' ? SIDE_FENCE : TALL_FENCE, originX: 0, originY: 1, ax: 0, ay: 1, dx: 0, dy: 0, depthBias: -1 };
    case 'wall':
      return { key: art === 'side' ? SIDE_WALL : TALL_WALL, originX: 0, originY: 1, ax: 0, ay: 1, dx: 0, dy: 0, depthBias: 0 };
    case 'gate':
      // 門は城壁と同じ高さで、マスの手前の端に下の端を合わせて立てる
      return { key: art === 'side' ? sideGateKey(stage) : tallGateKey(stage), originX: 0, originY: 1, ax: 0, ay: 1, dx: 0, dy: 0, depthBias: 0 };
  }
}

/** 絵を置く画面の位置（整数の px）と、並べる値。r はマスの矩形（FieldView.cellRect） */
export function placeTall(a: TallArt, r: Rect): { x: number; y: number; depth: number } {
  const x = Math.round(r.x + a.ax * r.w) + a.dx;
  const y = Math.round(r.y + a.ay * r.h) + a.dy;
  return { x, y, depth: y + a.depthBias };
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
