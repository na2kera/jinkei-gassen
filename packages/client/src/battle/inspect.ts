// 部隊を押している間に出す数字の箱の、毎フレームの判定。
// Phaser を使わない計算だけにして、画面なしで確かめられるようにする（BattleScene.render はこれを呼ぶだけ）。

/** 押している指と、押した部隊 */
export interface Inspect {
  pointerId: number;
  unit: number;
}

/**
 * 押している部隊の数字の箱を、このフレームで出すか。units はいま描いている部隊（全滅して消えた部隊を除く。戦場の座標）。
 * 押した部隊がいま描いている部隊にない（全滅した）ときは、押している状態は残し、箱だけ出さない（いままでどおり）
 */
export function followInspect<T extends { id: number; x: number; y: number }>(
  inspect: Inspect | null,
  units: readonly T[],
): { inspect: Inspect | null; shown: T | null } {
  if (!inspect) return { inspect: null, shown: null };
  const u = units.find((v) => v.id === inspect.unit);
  return { inspect, shown: u ?? null };
}
