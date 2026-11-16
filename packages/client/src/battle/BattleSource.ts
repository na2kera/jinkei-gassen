// 戦闘の画面が見る唯一の窓口（design §5.2）。戦闘の画面は engine の状態を直接読まず、ここから届く場面だけを描く。
// 1人用は LocalBattleSource、対戦は RemoteBattleSource（段階3）が同じ形で場面を流す。

import type { BattleEvent, BattleSummary, BattleView, OrderKind, OrderTarget } from '@jinkei/engine';

export interface BattleFrame {
  tick: number;
  view: BattleView;
  /** 前の場面のあとに起きた出来事をまとめたもの */
  events: BattleEvent[];
}

export interface BattleSource {
  /** 購読した時点で、いまの場面を1つすぐ渡す */
  onFrame(cb: (frame: BattleFrame) => void): void;
  /**
   * 決着したときの振り返り。design §5.2 にはない口で、client 側で足した。
   * summarize は engine の状態が要るので、戦闘の画面からは呼べないため。対戦ではサーバーの結果を渡す。
   */
  onEnd(cb: (summary: BattleSummary) => void): void;
  order(target: OrderTarget, kind: OrderKind): void;
  /**
   * いまその号令を受け付けられるか。design §5.2 にはない口で、client 側で足した。
   * engine の canOrder は状態が要るので、戦闘の画面からは呼べないため。
   * まだ step に渡していない号令のぶんも数に入れる。
   */
  canOrder(target: OrderTarget, kind: OrderKind): boolean;
  /** 1人用だけ。画面のボタンは 1 と 2 だけを渡す（開発用の口は大きな倍率も渡す） */
  setSpeed?(mult: number): void;
  dispose(): void;
}
