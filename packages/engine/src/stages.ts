// 第1章の5面（design §3.10）。戦場はどれも標準の平原。自軍は陣営0（下）、敵は陣営1（上）。
// 座標は戦場の座標（陣営0の配置エリアは行 10〜15、敵は行 0〜5）。

import { plainField } from './army.ts';
import { applyTemplate } from './templates.ts';
import type { Stage } from './stage.ts';
import type { Kind, Placement, Stance } from './types.ts';

/** cols の各列に、同じ兵種・方針で並べる */
function at(kind: Kind, stance: Stance, cols: number[], row: number): Placement[] {
  return cols.map((col) => ({ kind, stance, col, row }));
}

const hq = (col: number, row: number): Placement => ({ kind: 'hq', stance: 'hold', col, row });

/** 方針の切り替え・ひな形・号令をまだ出さない面 */
const BASIC = { stances: [] as Stance[], orders: false, templates: false };

export const STAGES: Stage[] = [
  {
    id: '1-1',
    chapter: 1,
    index: 1,
    name: '初陣',
    hint: '敵の横に回れる並べ方は？',
    field: plainField(),
    roster: { hq: 1, infantry: 7 },
    enemy: [hq(5, 1), ...at('infantry', 'advance', [4, 5, 6], 4), ...at('infantry', 'advance', [5, 6], 3)],
    win: { type: 'defeat' },
    allow: BASIC,
    solution: [hq(5, 14), ...at('infantry', 'advance', [2, 3, 4, 5, 6, 7, 8], 10)],
  },
  {
    id: '1-2',
    chapter: 1,
    index: 2,
    name: '盾の壁',
    hint: '敵の騎兵は、どこを通る？',
    field: plainField(),
    roster: { hq: 1, infantry: 5, shield: 3 },
    enemy: [hq(5, 0), ...at('cavalry', 'advance', [3, 4, 5, 6], 4), ...at('infantry', 'hold', [3, 4, 5, 6], 2)],
    win: { type: 'defeat' },
    allow: BASIC,
    solution: [hq(5, 14), ...at('shield', 'hold', [3, 4, 5], 10), ...at('infantry', 'advance', [1, 2, 6, 7, 8], 11)],
  },
  {
    id: '1-3',
    chapter: 1,
    index: 3,
    name: '矢の雨',
    hint: '弓は、何の後ろに置く？',
    field: plainField(),
    roster: { hq: 1, infantry: 3, shield: 4, archer: 4 },
    enemy: [hq(5, 0), ...at('infantry', 'advance', [2, 3, 4, 5, 6, 7, 8, 9], 4), ...at('infantry', 'advance', [5, 6], 3)],
    win: { type: 'defeat' },
    allow: BASIC,
    solution: [hq(5, 13), ...at('shield', 'hold', [4, 5, 6, 7], 10), ...at('archer', 'advance', [4, 5, 6, 7], 11), ...at('infantry', 'advance', [4, 5, 6], 12)],
  },
  {
    id: '1-4',
    chapter: 1,
    index: 4,
    name: '両翼の騎馬',
    hint: '固い正面の、横と後ろは？',
    field: plainField(),
    roster: { hq: 1, infantry: 4, shield: 3, cavalry: 3, archer: 2 },
    enemy: [hq(5, 0), ...at('shield', 'advance', [2, 3, 4, 5, 6, 7, 8, 9], 5), ...at('infantry', 'advance', [4, 5, 6, 7], 4)],
    win: { type: 'defeat' },
    allow: { orders: false },
    // 正面は守備で受け止め（盾兵を中央、歩兵を両脇）、弓兵は前進して撃ち、騎兵3つを右の端からまとめて回り込ませる
    solution: [
      hq(5, 14),
      ...at('shield', 'hold', [4, 5, 6], 11),
      ...at('infantry', 'hold', [2, 3, 7, 8], 11),
      ...at('archer', 'advance', [5, 6], 12),
      ...at('cavalry', 'flank', [9, 10, 11], 10),
    ],
  },
  {
    id: '1-5',
    chapter: 1,
    index: 5,
    name: '平原の決戦',
    hint: '鶴の真ん中は薄い。突撃はどう受ける？',
    field: plainField(),
    roster: { hq: 1, infantry: 5, shield: 3, cavalry: 3, archer: 3 },
    // 敵は鶴翼（14部隊）。10秒と30秒に全軍突撃してくる
    enemy: applyTemplate('crane', { hq: 1, infantry: 5, shield: 3, cavalry: 3, archer: 2 }, plainField().zones[1], 1),
    enemyOrders: [
      { atSec: 10, target: 'all', kind: 'charge' },
      { atSec: 30, target: 'all', kind: 'charge' },
    ],
    win: { type: 'defeat' },
    // 歩兵を楔にして鶴翼の薄い中央へ向け、盾兵で楔の両脇を固め、弓兵はその後ろで守備。騎兵3つは左の端からまとめて回り込む。
    // 敵の最初の突撃（10秒）に合わせて全軍に堅守をかけ、受け止めてから押し返す
    solution: [
      hq(5, 14),
      ...at('infantry', 'advance', [5, 6], 10),
      ...at('infantry', 'advance', [4, 7, 5], 11),
      ...at('shield', 'advance', [3, 8, 6], 11),
      ...at('archer', 'hold', [4, 5, 6], 12),
      ...at('cavalry', 'flank', [0, 1, 2], 12),
    ],
    solutionOrders: [{ atSec: 10, target: 'all', kind: 'brace' }],
  },
];
