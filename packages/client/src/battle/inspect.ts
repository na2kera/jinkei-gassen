// 部隊を押している間に出す数字の箱の、毎フレームの判定（design §5.8.3 補足8）。
// Phaser を使わない計算だけにして、画面なしで確かめられるようにする（BattleScene.render はこれを呼ぶだけ）。

import type { FieldView } from './FieldView.ts';

/** 押している指と、押した部隊 */
export interface Inspect {
  pointerId: number;
  unit: number;
}

/**
 * 押している部隊の数字の箱を、このフレームで出すか。units はいま描いている部隊（全滅して消えた部隊を除く。戦場の座標）。
 * 部隊が枠の外へ出たら（FieldView.visible が false。将軍だけ起きる）、押している状態ごと消す（inspect が null になる）。
 * 消したあとは、部隊が枠の中へ戻ってきても出し直さない（押し直すまで出さない）。
 * 押した部隊がいま描いている部隊にない（全滅した）ときは、押している状態は残し、箱だけ出さない（いままでどおり）
 */
export function followInspect<T extends { id: number; x: number; y: number }>(
  fv: FieldView,
  inspect: Inspect | null,
  units: readonly T[],
): { inspect: Inspect | null; shown: T | null } {
  if (!inspect) return { inspect: null, shown: null };
  const u = units.find((v) => v.id === inspect.unit);
  if (!u) return { inspect, shown: null };
  if (!fv.visible(u.x, u.y)) return { inspect: null, shown: null };
  return { inspect, shown: u };
}
