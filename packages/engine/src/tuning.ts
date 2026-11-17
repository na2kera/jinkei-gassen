// 調整できる数字（design §3.5・§3.6 の「初期値」）をここに集める。
// 決まり（順番・狙いの決め方・動き方）はこのファイルに置かない。数字を変えたら docs/balance.md に書く。

import type { Kind } from './types.ts';

/** 1刻みの秒数 */
export const DT = 0.1;

export interface KindStats {
  men: number;
  /** マス/秒 */
  speed: number;
  /** 近接の攻撃（毎秒） */
  melee: number;
  /** 回転（度/秒） */
  turn: number;
}

export const KIND_STATS: Record<Kind, KindStats> = {
  infantry: { men: 100, speed: 1.0, melee: 3.0, turn: 180 },
  shield: { men: 100, speed: 0.7, melee: 2.36, turn: 120 },
  cavalry: { men: 60, speed: 2.2, melee: 3.43, turn: 240 },
  archer: { men: 80, speed: 0.9, melee: 1.2, turn: 180 },
  hq: { men: 80, speed: 0.6, melee: 2.6, turn: 120 },
};

export const T = {
  /** 部隊どうしの中心がこれより近づかない */
  spacing: 0.9,
  /** 近接が届く距離（中心どうし） */
  meleeRange: 1.05,
  /** 戦場の端から中心までの最小の距離 */
  edgeMargin: 0.45,

  /** 弓 */
  archerRange: 5.6,
  arrowDamage: 3.46,

  /** 騎兵の突入 */
  impactDamage: 9.36,
  impactRunup: 2.0,
  /** この刻みに動いた距離がこれより小さければ「動かなかった」として、助走を 0 に戻す */
  runupStillDist: 0.001,
  impactShock: { front: 8, side: 14, rear: 20 },
  /** 盾兵の正面に当たった騎兵が失う兵数と士気 */
  impactBouncedMen: 9.21,
  impactBouncedMorale: 8,

  /** ばらつき（0.9〜1.1） */
  randomMin: 0.9,
  randomMax: 1.1,

  /** 向きの境目（度） */
  frontAngle: 50,
  rearAngle: 120,

  /** 受ける側：向き */
  facingMult: { front: 1.0, side: 1.36, rear: 1.7 },
  /** 盾兵の正面（向きの代わり） */
  shieldFrontMelee: 0.3,
  shieldFrontArrow: 0.4,
  shieldFrontImpact: 0.2,
  /** 受ける側：兵種 */
  hqTakenMult: 0.7,
  archerMeleeTakenMult: 1.3,
  /** 相性（攻める側） */
  cavalryVsArcher: 1.5,
  infantryVsArcher: 1.2,

  /** 号令 */
  maxOrders: 3,
  chargeTicks: 100,
  braceTicks: 100,
  retreatTicks: 60,
  chargeAttackMult: 1.3,
  chargeTakenMult: 1.2,
  chargeSpeedMult: 1.25,
  braceTakenMult: 0.7,
  braceMoraleMult: 0.6,
  chargeMoraleBonus: 5,
  braceMoraleBonus: 10,
  /** 後退で止まる、配置エリアのいちばん奥の行数 */
  retreatRows: 2,

  /** 膠着（§3.6.4）：静かな刻みがこの数だけ続いたら、時間切れと同じ決め方で終える */
  stalemateTicks: 100,

  /** 敗走 */
  routSpeedMult: 1.3,
  routTicks: 50,

  /** 方針 */
  homeTolerance: 0.1,
  holdWatchRange: 4,
  advanceSwitchMargin: 1.0,
  flankEdgeOffset: 0.5,
  flankDepth: 1.7,
  /** 迂回の①②で、着いたとみなす距離 */
  waypointTolerance: 0.1,
  /** 本陣狙いの「詰まった」の判定：この刻み数のあいだに動いた距離の合計が huntStuckDist に満たない */
  huntStuckTicks: 20,
  huntStuckDist: 0.3,
  /** 守備の味方の並びを回り込む（§3.6.6）：前へ進む動きで、この刻み数のあいだに動いた分の合計が detourStuckDist に満たなければ、ふさがれたとみなす */
  detourStuckTicks: 50,
  detourStuckDist: 0.3,
  /** 回り込みを打ち切る刻み数 */
  detourMaxTicks: 100,
  /** ふさいでいる守り手とみなす距離の、spacing への上乗せ */
  detourReach: 0.1,
  /** 出口の x を、並びの端の守り手から spacing + detourGap だけ外にする */
  detourGap: 0.05,
  /** 本陣狙い・迂回①②が戦う「進む向きの正面」（度） */
  passFrontAngle: 50,

  /** 士気 */
  moraleMax: 100,
  moraleLossScale: 170.75,
  moraleFacing: { front: 1.0, side: 1.5, rear: 2.18 },
  moraleArrowMult: 0.6,
  supportRange: 1.6,
  supportPerAlly: 0.26,
  supportMaxAllies: 2,
  hqSupportRange: 3.5,
  hqSupportMult: 0.7,
  surroundAngle: 100,
  surroundPerSec: 2,
  allyRoutedRange: 2.0,
  allyRoutedLoss: 11.5,
  allyDestroyedLoss: 6,
  targetBrokenGain: 8,
  enemyBrokenRange: 2.5,
  enemyBrokenGain: 3,
  recoverEnemyRange: 2.0,
  recoverQuietTicks: 20,
  recoverPerSec: 1.5,
  hqNearPerSec: 1,

  // 地形（design §3.8。ここから下は地形の数字で、条件を通すために変えてよい）
  /** 速さの倍率（いるマスの地形） */
  hillSpeedMult: 0.85,
  forestSpeedMult: 0.8,
  forestCavalrySpeedMult: 0.5,
  riverSpeedMult: 0.5,
  fenceSpeedMult: 0.4,
  /** 丘の上の弓兵の、届く距離の伸び */
  hillArcherRangeBonus: 1.5,
  /** 損害の倍率 */
  hillAttackMult: 1.2,
  hillDefendMult: 0.85,
  riverAttackMult: 0.7,
  riverTakenMult: 1.3,
  forestArrowTakenMult: 0.5,
  fenceMeleeMult: 0.55,
  fenceArrowMult: 0.5,
  /** 門の耐久 */
  gateMen: 150,
  /** 門を攻めるときだけの、近接が届く距離（門は大きな構えなので、横に並んだ部隊も打てる） */
  gateReach: 1.6,
  /** 部隊の中心を、城壁のマスからこれより内側に入れない */
  wallMargin: 0.45,
  /** 通り道の①（門の手前）を済んだとみなす、門のマスの中心からの x の差 */
  gateApproachTolerance: 0.3,
} as const;

/** 対戦の値段の初期値（assumptions S1）。予算の検査と armyCost の既定に使う */
export const DEFAULT_COSTS: Record<Kind, number> = {
  infantry: 2,
  shield: 3,
  archer: 3,
  cavalry: 4,
  hq: 0,
};

/** 1戦に出せる号令の回数（陣営ごと）。画面の残り回数の表示に使う */
export const MAX_ORDERS: number = T.maxOrders;

/** 敗走してから消えるまでの刻み数。画面の消え方の演出に使う */
export const ROUT_TICKS: number = T.routTicks;
