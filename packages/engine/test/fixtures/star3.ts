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
  // 見本そのまま
  '2-3': { ps: [['hq', 5, 14, 'hold'], ['infantry', 2, 10, 'hold'], ['infantry', 3, 10, 'hold'], ['infantry', 4, 10, 'hold'], ['infantry', 7, 10, 'hold'], ['infantry', 8, 10, 'hold'], ['infantry', 9, 10, 'hold'], ['shield', 5, 10, 'hold'], ['shield', 6, 10, 'hold'], ['archer', 4, 11, 'hold'], ['archer', 5, 11, 'hold'], ['archer', 6, 11, 'hold']], orders: [] },
  // 盾兵6で谷をふさぎ、弓兵2を1行あけた後ろ（行 12）の列 1・4 に散らす
  '2-4': { ps: [['hq', 2, 14, 'hold'], ['shield', 0, 10, 'hold'], ['shield', 1, 10, 'hold'], ['shield', 2, 10, 'hold'], ['shield', 3, 10, 'hold'], ['shield', 4, 10, 'hold'], ['shield', 5, 10, 'hold'], ['archer', 1, 12, 'hold'], ['archer', 4, 12, 'hold']], orders: [] },
  // 探索
  '2-5': { ps: [['hq', 8, 10, 'hold'], ['infantry', 7, 10, 'hold'], ['infantry', 11, 10, 'hold'], ['infantry', 4, 11, 'flank'], ['infantry', 0, 10, 'hold'], ['shield', 5, 10, 'hold'], ['shield', 6, 10, 'hold'], ['archer', 3, 12, 'hunt'], ['archer', 4, 13, 'hold'], ['cavalry', 8, 13, 'flank'], ['cavalry', 4, 10, 'hold']], orders: [{ atSec: 10, target: 'all', kind: 'brace' }, { atSec: 16, target: 'center', kind: 'brace' }, { atSec: 23, target: 'all', kind: 'charge' }] },
  // 探索
  '3-1': { ps: [['hq', 3, 10, 'hold'], ['infantry', 9, 10, 'hold'], ['infantry', 9, 12, 'hold'], ['infantry', 5, 10, 'hold'], ['infantry', 7, 10, 'hold'], ['infantry', 8, 10, 'hold'], ['infantry', 2, 10, 'hold'], ['shield', 4, 10, 'hold'], ['shield', 1, 11, 'hold'], ['shield', 6, 10, 'hold'], ['shield', 10, 11, 'hold'], ['archer', 6, 11, 'hold'], ['archer', 5, 11, 'hunt']], orders: [{ atSec: 22, target: 'all', kind: 'brace' }, { atSec: 28, target: 'right', kind: 'charge' }, { atSec: 58, target: 'all', kind: 'brace' }] },
  // 探索（敵の弓兵を5にしたあと。置く順を変えても星3つ）
  '3-2': { ps: [['hq', 5, 14, 'hold'], ['shield', 4, 10, 'advance'], ['shield', 6, 15, 'advance'], ['shield', 5, 10, 'advance'], ['shield', 6, 10, 'advance'], ['infantry', 3, 10, 'advance'], ['infantry', 9, 12, 'advance'], ['archer', 4, 11, 'advance'], ['archer', 6, 12, 'advance'], ['archer', 5, 12, 'advance'], ['infantry', 7, 10, 'hold'], ['infantry', 4, 15, 'hold'], ['cavalry', 3, 13, 'flank'], ['cavalry', 9, 14, 'hold']], orders: [{ atSec: 20, target: 'center', kind: 'brace' }, { atSec: 36, target: 'all', kind: 'brace' }, { atSec: 52, target: 'all', kind: 'brace' }] },
  // 10×12 の盤で探し直した（sim star 3-3 --rand 1。見本から。2026-11-22）。両翼の歩兵を前へ出し、本陣は左の前。置く順を変えても星3つ
  '3-3': { ps: [['hq', 1, 8, 'hold'], ['shield', 7, 8, 'hold'], ['shield', 4, 10, 'hold'], ['shield', 5, 10, 'hold'], ['infantry', 7, 9, 'advance'], ['infantry', 2, 8, 'advance'], ['infantry', 2, 9, 'advance'], ['infantry', 7, 10, 'advance'], ['archer', 3, 10, 'hunt'], ['cavalry', 1, 9, 'advance'], ['cavalry', 8, 9, 'flank']], orders: [{ atSec: 52, target: 'center', kind: 'brace' }] },
  // 探索（手持ちを直したあと。置く順を変えても12個以上で星3つ）
  '3-4': { ps: [['hq', 1, 10, 'hold'], ['shield', 6, 10, 'hold'], ['shield', 3, 10, 'hold'], ['shield', 4, 10, 'hold'], ['shield', 0, 10, 'hold'], ['shield', 5, 10, 'hold'], ['infantry', 2, 10, 'hold'], ['infantry', 5, 11, 'flank']], orders: [{ atSec: 5, target: 'all', kind: 'brace' }, { atSec: 27, target: 'all', kind: 'brace' }, { atSec: 51, target: 'all', kind: 'brace' }] },
  // 探索（置く順を変えても星3つ）
  '3-5': { ps: [['hq', 5, 10, 'hold'], ['shield', 9, 10, 'hold'], ['shield', 6, 10, 'hold'], ['infantry', 10, 12, 'hold'], ['infantry', 10, 10, 'hold'], ['infantry', 6, 11, 'hold'], ['infantry', 10, 13, 'flank'], ['archer', 7, 11, 'advance'], ['archer', 5, 11, 'hold'], ['archer', 4, 11, 'hold'], ['shield', 4, 10, 'hold'], ['infantry', 0, 12, 'flank'], ['cavalry', 0, 11, 'flank'], ['cavalry', 3, 10, 'flank'], ['cavalry', 1, 12, 'flank']], orders: [{ atSec: 8, target: 'right', kind: 'brace' }, { atSec: 22, target: 'right', kind: 'brace' }, { atSec: 41, target: 'all', kind: 'brace' }] },
};
