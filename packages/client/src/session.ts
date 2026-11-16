// シーンをまたいで持つもの（配置と、直前の戦いの結果）。
// シーンは向きの切り替えで作り直すことがあるので、消えて困るものはシーンの中に持たない。

import {
  applyTemplate,
  MAX_UNITS,
  plainField,
  STANDARD_ROSTER,
  validateArmy,
  type BattleSetup,
  type BattleSummary,
  type Field,
  type Placement,
  type ScriptedOrder,
  type Side,
  type UnitView,
} from '@jinkei/engine';

/**
 * 今回の平原1面の決まり。ステージのデータ（design §3.10）は段階2なので、仮にここで持つ。
 * - timeout: decisions §6 のとおり、ふつうの面は時間切れなら負け（side0_loses）。
 *   引き分けなどを確かめるときは、開発用の口（__jg.stage）で timeout と maxTicks を変える。
 * - 敵の号令は1つだけ入れる（20秒で全軍に突撃）。敵の号令の表示を確かめるためで、面のデータができたら差し替える。
 */
export const PLAIN_STAGE: {
  timeout: BattleSetup['timeout'];
  maxTicks: number;
  enemyTemplate: 'crane';
  scriptedOrders: ScriptedOrder[];
} = {
  timeout: 'side0_loses',
  maxTicks: 1800,
  enemyTemplate: 'crane',
  scriptedOrders: [{ tick: 200, side: 1, target: 'all', kind: 'charge' }],
};

export const ROSTER = STANDARD_ROSTER;

export interface ResultData {
  summary: BattleSummary;
  /** 見ていた陣営（勝ち負けと、自軍・敵軍の振り分けに使う） */
  viewer: Side;
  /** 最後の場面の部隊（振り返りで翼と兵種を引くため） */
  units: UnitView[];
}

interface Session {
  field: Field;
  placements: Placement[];
  enemy: Placement[];
  result: ResultData | null;
}

const field = plainField();

export const session: Session = {
  field,
  placements: [],
  enemy: applyTemplate(PLAIN_STAGE.enemyTemplate, ROSTER, field.zones[1], 1),
  result: null,
};

export function armyErrors(placements: readonly Placement[]): ReturnType<typeof validateArmy> {
  // 全部隊を置かなくても、本陣と1部隊以上あれば開戦できる（validateArmy の既定の minUnits は 1）
  return validateArmy(placements, session.field.zones[0], { maxUnits: MAX_UNITS });
}

export function battleSetup(): BattleSetup {
  return {
    field: session.field,
    armies: [session.placements.map((p) => ({ ...p })), session.enemy.map((p) => ({ ...p }))],
    // 種は client が毎回決める（engine は乱数の元を持たない）。同じ配置でも戦いごとに少し違う展開になる
    seed: (Math.random() * 0x100000000) >>> 0,
    maxTicks: PLAIN_STAGE.maxTicks,
    timeout: PLAIN_STAGE.timeout,
    scriptedOrders: PLAIN_STAGE.scriptedOrders.map((o) => ({ ...o })),
  };
}
