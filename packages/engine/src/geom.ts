// 平面の小さな計算。座標は y が下向き（陣営0は下側にいて、前は y が減る向き）。

export interface Vec {
  x: number;
  y: number;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

/** 長さ 1 にする。長さが 0 なら null */
export function normalize(x: number, y: number): Vec | null {
  const l = Math.hypot(x, y);
  if (l < 1e-12) return null;
  return { x: x / l, y: y / l };
}

/** 2つのベクトルのなす角（度、0〜180）。どちらかが長さ 0 なら 0 */
export function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-12 || lb < 1e-12) return 0;
  let c = (ax * bx + ay * by) / (la * lb);
  if (c > 1) c = 1;
  if (c < -1) c = -1;
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * 向き (dx, dy) に立った人から見た「左」の単位ベクトル。
 * y が下向きの座標なので、(0, -1)（上向き）の左は (-1, 0) になる。
 */
export function leftOf(dx: number, dy: number): Vec {
  return { x: dy, y: -dx };
}

/** 外積の z 成分。正なら b は a の「左」側（leftOf と同じ向き） */
export function sideSign(ax: number, ay: number, bx: number, by: number): number {
  const l = leftOf(ax, ay);
  return l.x * bx + l.y * by;
}

/** 向き (fx, fy) を、目標の向き (tx, ty) へ最大 maxDeg 度だけ回した単位ベクトル */
export function rotateToward(fx: number, fy: number, tx: number, ty: number, maxDeg: number): Vec {
  const t = normalize(tx, ty);
  if (!t) return { x: fx, y: fy };
  const cur = Math.atan2(fy, fx);
  const goal = Math.atan2(t.y, t.x);
  let diff = goal - cur;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  // ちょうど真後ろへ向くときは、どちらの陣営でも同じ回り方（正の向き）にする。
  // -π と +π が陣営で分かれると、鏡写しの戦いで陣営の有利不利が生まれるため。
  if (Math.abs(Math.abs(diff) - Math.PI) < 1e-9) diff = Math.PI;
  const maxRad = (maxDeg * Math.PI) / 180;
  // + 0 で -0 を 0 にする（JSON に書くと -0 は 0 になり、戻した状態で atan2 の結果が変わるため）
  if (Math.abs(diff) <= maxRad) return { x: t.x + 0, y: t.y + 0 };
  const a = cur + Math.sign(diff) * maxRad;
  return { x: Math.cos(a) + 0, y: Math.sin(a) + 0 };
}
