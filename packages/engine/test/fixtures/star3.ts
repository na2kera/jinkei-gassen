// 星3つの取れる配置（第2章・第3章）。stages-ch23.test.ts と stalemate.test.ts（K8）で使う
import type { Placement } from '../../src/index.ts';

// 見本を出発点に、部隊の位置・方針・号令を少しずつ変えて探した配置。Stage には入れない。[兵種, 列, 行, 方針]
export type Row = [Placement['kind'], number, number, Placement['stance']];
export type Ord = { atSec: number; target: 'all' | 'left' | 'center' | 'right'; kind: 'charge' | 'brace' | 'retreat' };
export const STAR3_FOUND: Record<string, { ps: Row[]; orders: Ord[] }> = {
  // 探索
  '2-1': { ps: [['hq', 6, 10, 'hold'], ['infantry', 7, 10, 'hold'], ['infantry', 1, 10, 'hold'], ['infantry', 2, 10, 'hold'], ['infantry', 4, 10, 'hold'], ['infantry', 2, 15, 'hunt'], ['infantry', 0, 10, 'hold'], ['shield', 3, 10, 'hold'], ['shield', 5, 10, 'hold'], ['archer', 1, 12, 'hold'], ['archer', 5, 11, 'hold']], orders: [{ atSec: 24, target: 'all', kind: 'brace' }, { atSec: 30, target: 'right', kind: 'charge' }, { atSec: 37, target: 'all', kind: 'brace' }] },
  // 探索
  '2-2': { ps: [['hq', 5, 15, 'hold'], ['infantry', 6, 10, 'hold'], ['infantry', 1, 11, 'hold'], ['infantry', 5, 10, 'hold'], ['infantry', 10, 10, 'hold'], ['infantry', 4, 10, 'hold'], ['infantry', 8, 10, 'hunt'], ['shield', 11, 13, 'hold'], ['shield', 0, 13, 'hold'], ['shield', 3, 10, 'hold'], ['archer', 4, 11, 'hold'], ['archer', 6, 11, 'advance'], ['archer', 5, 11, 'advance']], orders: [{ atSec: 10, target: 'left', kind: 'brace' }, { atSec: 23, target: 'all', kind: 'brace' }, { atSec: 26, target: 'right', kind: 'charge' }] },
  // 10×12 の盤で（2026-11-22）：見本の配置に、10 秒の全軍堅守と 30 秒の全軍突撃を足したもの
  '2-3': { ps: [['hq', 4, 10, 'hold'], ['infantry', 3, 8, 'hold'], ['infantry', 4, 8, 'hold'], ['infantry', 5, 8, 'hold'], ['infantry', 6, 8, 'hold'], ['shield', 1, 8, 'hold'], ['shield', 8, 8, 'hold'], ['archer', 3, 9, 'hold'], ['archer', 6, 9, 'hold']], orders: [{ atSec: 10, target: 'all', kind: 'brace' }, { atSec: 30, target: 'all', kind: 'charge' }] },
  // 10×12 の盤（幅 5）で探し直した（sim star 2-4 --rand 2。2026-11-22）。盾兵5で谷をふさぎ、堅守を3回。置く順を変えても星3つ
  '2-4': { ps: [['hq', 3, 10, 'hold'], ['shield', 1, 8, 'hold'], ['shield', 0, 8, 'hold'], ['shield', 3, 8, 'hold'], ['shield', 2, 8, 'hold'], ['shield', 4, 8, 'hold'], ['archer', 2, 9, 'advance'], ['archer', 3, 11, 'hunt']], orders: [{ atSec: 15, target: 'all', kind: 'brace' }, { atSec: 37, target: 'all', kind: 'brace' }, { atSec: 57, target: 'all', kind: 'brace' }] },
  // 10×12 の盤で（2026-11-22）：見本の配置で、号令を 10 秒の全軍堅守と 20 秒の全軍突撃にしたもの
  '2-5': { ps: [['hq', 4, 11, 'hold'], ['infantry', 3, 8, 'hold'], ['infantry', 4, 8, 'hold'], ['shield', 5, 8, 'hold'], ['archer', 3, 9, 'advance'], ['archer', 5, 9, 'hold'], ['cavalry', 1, 9, 'hold'], ['cavalry', 8, 10, 'hold']], orders: [{ atSec: 10, target: 'all', kind: 'brace' }, { atSec: 20, target: 'all', kind: 'charge' }] },
  // 10×12 の盤で探し直した（sim star 3-1 --rand 2。2026-11-22）。本陣を右の後ろに置いて右の端を受ける。置く順を変えても星3つ
  '3-1': { ps: [['hq', 8, 9, 'hold'], ['infantry', 4, 8, 'hold'], ['infantry', 3, 11, 'hold'], ['infantry', 3, 8, 'hold'], ['shield', 5, 8, 'hold'], ['shield', 2, 8, 'hold'], ['shield', 6, 8, 'hold'], ['archer', 3, 9, 'hold'], ['archer', 6, 9, 'flank']], orders: [{ atSec: 5, target: 'all', kind: 'brace' }, { atSec: 27, target: 'all', kind: 'brace' }, { atSec: 49, target: 'all', kind: 'brace' }] },
  // 探索（敵の弓兵を5にしたあと。置く順を変えても星3つ）
  '3-2': { ps: [['hq', 5, 14, 'hold'], ['shield', 4, 10, 'advance'], ['shield', 6, 15, 'advance'], ['shield', 5, 10, 'advance'], ['shield', 6, 10, 'advance'], ['infantry', 3, 10, 'advance'], ['infantry', 9, 12, 'advance'], ['archer', 4, 11, 'advance'], ['archer', 6, 12, 'advance'], ['archer', 5, 12, 'advance'], ['infantry', 7, 10, 'hold'], ['infantry', 4, 15, 'hold'], ['cavalry', 3, 13, 'flank'], ['cavalry', 9, 14, 'hold']], orders: [{ atSec: 20, target: 'center', kind: 'brace' }, { atSec: 36, target: 'all', kind: 'brace' }, { atSec: 52, target: 'all', kind: 'brace' }] },
  // 10×12 の盤で探し直した（sim star 3-3 --rand 1。見本から。2026-11-22）。両翼の歩兵を前へ出し、本陣は左の前。置く順を変えても星3つ
  '3-3': { ps: [['hq', 1, 8, 'hold'], ['shield', 7, 8, 'hold'], ['shield', 4, 10, 'hold'], ['shield', 5, 10, 'hold'], ['infantry', 7, 9, 'advance'], ['infantry', 2, 8, 'advance'], ['infantry', 2, 9, 'advance'], ['infantry', 7, 10, 'advance'], ['archer', 3, 10, 'hunt'], ['cavalry', 1, 9, 'advance'], ['cavalry', 8, 9, 'flank']], orders: [{ atSec: 52, target: 'center', kind: 'brace' }] },
  // 10×12 の盤（幅 5）で探し直した（sim star 3-4 --rand 2。2026-11-22）。柵の5マスを盾兵で埋め、本陣は丘の左の奥、堅守を約 22 秒おきに3回
  '3-4': { ps: [['hq', 1, 11, 'advance'], ['shield', 2, 8, 'hold'], ['shield', 1, 8, 'hold'], ['shield', 3, 8, 'hold'], ['shield', 0, 8, 'hold'], ['shield', 4, 8, 'hold']], orders: [{ atSec: 10, target: 'all', kind: 'brace' }, { atSec: 32, target: 'all', kind: 'brace' }, { atSec: 54, target: 'all', kind: 'brace' }] },
  // 10×12 の盤で探した（柵の盾兵とその後ろの歩兵を固めて、残りを山登り。2026-11-22）。置く順を変えても星3つ
  '3-5': { ps: [['shield', 8, 8, 'hold'], ['infantry', 8, 9, 'hold'], ['shield', 5, 8, 'hold'], ['hq', 3, 8, 'hold'], ['infantry', 4, 9, 'advance'], ['infantry', 7, 8, 'hold'], ['infantry', 4, 8, 'hold'], ['archer', 7, 10, 'hold'], ['archer', 4, 11, 'advance'], ['cavalry', 1, 9, 'flank'], ['cavalry', 2, 9, 'flank']], orders: [{ atSec: 9, target: 'center', kind: 'brace' }, { atSec: 10, target: 'right', kind: 'brace' }, { atSec: 20, target: 'center', kind: 'charge' }] },
};
