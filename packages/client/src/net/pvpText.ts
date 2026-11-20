// 対戦の画面に出す文のうち、届いた値から決まるもの（design §11）。
// Phaser を読まない関数にして、画面なしで確かめられるようにする。

import type { BattleSummary, Side } from '@jinkei/engine';
import { percent } from '../ui/labels.ts';

/**
 * 対戦の結果の「残った兵」の1行（design §11.3）。自軍・敵軍とも remaining（時間切れの勝ち負けを決める数え方。
 * 呼ばなかった遊軍を数に入れない）を出す。2人の画面で同じ数字になり、勝ち負けと必ず合う。
 * 1人用の結果の画面は星の条件と同じ数え方（remainingShown）のままで、ここは使わない
 */
export function pvpRemainingText(s: Pick<BattleSummary, 'remaining'>, you: Side): string {
  const enemy: Side = you === 0 ? 1 : 0;
  return `残った兵 自軍${percent(s.remaining[you])} 敵軍${percent(s.remaining[enemy])}`;
}
