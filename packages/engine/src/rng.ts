// 状態の中に持つ乱数（design §3.1）。
// 方式: mulberry32。状態は 32 ビット符号なし整数 1 個なので、BattleState.rng にそのまま入り JSON に書き出せる。
// 状態を引数で受け取り、[値, 次の状態] を返す（state を書き換えるのは呼ぶ側）。

/** 種を 32 ビット符号なし整数に直す。種 0 でも列が偏らないよう、そのまま使う（mulberry32 は 0 でも動く）。 */
export function rngFromSeed(seed: number): number {
  return seed >>> 0;
}

/** 0 以上 1 未満の数と、次の状態を返す。 */
export function nextFloat(s: number): [number, number] {
  const next = (s + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [v, next];
}
