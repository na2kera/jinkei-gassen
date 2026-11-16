// 第1章〜第3章の面（design §3.10、§3.8「第2章・第3章の面」）。第1章の戦場は標準の平原。自軍は陣営0（下）、敵は陣営1（上）。
// 座標は戦場の座標（陣営0の配置エリアは行 10〜15、敵は行 0〜5）。

import { plainField } from './army.ts';
import { applyTemplate } from './templates.ts';
import type { Stage } from './stage.ts';
import type { Field, Kind, Placement, Stance, Terrain } from './types.ts';

/** cols の各列に、同じ兵種・方針で並べる */
function at(kind: Kind, stance: Stance, cols: number[], row: number): Placement[] {
  return cols.map((col) => ({ kind, stance, col, row }));
}

const hq = (col: number, row: number): Placement => ({ kind: 'hq', stance: 'hold', col, row });

/** 幅 width の戦場に、[地形, 列の一覧, 行の一覧] の長方形を順に塗る（配置エリアは標準の深さ） */
function terrainField(width: number, paint: [Terrain, number[], number[]][]): Field {
  const f = plainField(width);
  for (const [t, cols, rows] of paint) for (const r of rows) for (const c of cols) f.terrain[r * width + c] = t;
  return f;
}

/** a から b まで（両端を含む）の整数 */
const span = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

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
  // ---------------------------------------------------------------- 第2章（地形）。方針・ひな形・号令は、すべて使える
  {
    id: '2-1',
    chapter: 2,
    index: 1,
    name: '丘の上',
    hint: '高い所で待つと、どうなる？',
    // 幅 8。自軍の配置エリアの前の2行（行 10・11）が、端から端まで丘。兵数で勝る敵（1.23 倍）が前進してくる
    field: terrainField(8, [['hill', span(0, 7), [10, 11]]]),
    roster: { hq: 1, infantry: 6, shield: 2, archer: 2 },
    enemy: [hq(3, 0), ...at('infantry', 'advance', span(0, 7), 4), ...at('infantry', 'advance', [2, 5], 3), ...at('shield', 'advance', [3, 4], 3)],
    win: { type: 'defeat' },
    // 丘の前の行に横一列で守備（盾兵は中央）。弓兵は丘の後ろの行で守備（丘の上なので、届く距離が伸びる）。丘を下りて戦うと押し負ける
    solution: [hq(3, 13), ...at('infantry', 'hold', [0, 1, 2, 5, 6, 7], 10), ...at('shield', 'hold', [3, 4], 10), ...at('archer', 'hold', [2, 5], 11)],
  },
  {
    id: '2-2',
    chapter: 2,
    index: 2,
    name: '森の待ち伏せ',
    hint: '見えない敵は、どこを通ってくる？',
    // 自軍の配置エリアの両脇（左右2列 × 行 10〜13）が森。敵の両奥の角（左右3列 × 行 0〜3）が霧で、その中に迂回の騎兵が3つずつ。
    // 見えている敵は歩兵だけ（騎兵がいない）で、霧は両奥の角だけ。迂回の騎兵は端の列を下りてくるので、両脇の森を通る
    field: terrainField(12, [['forest', [0, 1], span(10, 13)], ['forest', [10, 11], span(10, 13)]]),
    roster: { hq: 1, infantry: 6, shield: 3, archer: 3 },
    enemy: [hq(5, 0), ...at('infantry', 'advance', span(3, 8), 4), ...at('cavalry', 'flank', [0, 1, 2], 2), ...at('cavalry', 'flank', [9, 10, 11], 2)],
    fog: [...span(0, 2), ...span(9, 11)].flatMap((col) => span(0, 3).map((row) => ({ col, row }))),
    win: { type: 'defeat' },
    // 両脇の森の中に歩兵2つずつを守備で置き、騎兵を森で受ける（突入が起きず、足も鈍る）。正面は盾兵と歩兵の守備、後ろに弓兵
    solution: [hq(5, 14), ...at('infantry', 'hold', [0, 1, 10, 11], 11), ...at('infantry', 'hold', [4, 7], 10), ...at('shield', 'hold', [5, 6, 3], 10), ...at('archer', 'hold', [4, 5, 6], 11)],
  },
  {
    id: '2-3',
    chapter: 2,
    index: 3,
    name: '川を渡る戦い',
    hint: '川の中で戦うのは、どちら？',
    // 行 8・9（自軍の配置エリアのすぐ手前）が、端から端まで川。兵数で勝る敵（1.32 倍）が渡ってくる
    field: terrainField(12, [['river', span(0, 11), [8, 9]]]),
    roster: { hq: 1, infantry: 6, shield: 2, archer: 3 },
    enemy: [hq(5, 0), ...at('infantry', 'advance', span(2, 9), 4), ...at('infantry', 'advance', [3, 4, 7, 8], 3), ...at('shield', 'advance', [5, 6], 3)],
    win: { type: 'defeat' },
    // 岸（行 10）で守備して、川の中にいる敵と戦う。前進させると、自分が川の中で戦うことになる
    solution: [hq(5, 14), ...at('infantry', 'hold', [2, 3, 4, 7, 8, 9], 10), ...at('shield', 'hold', [5, 6], 10), ...at('archer', 'hold', [4, 5, 6], 11)],
  },
  {
    id: '2-4',
    chapter: 2,
    index: 4,
    name: '谷の狭い道',
    hint: '狭い道なら、数の差は？',
    // 幅 6 の谷。敵は倍（2.08 倍）の歩兵
    field: plainField(6),
    roster: { hq: 1, shield: 6, archer: 1 },
    enemy: [hq(2, 0), ...at('infantry', 'advance', span(0, 5), 4), ...at('infantry', 'advance', span(0, 5), 3), ...at('infantry', 'advance', [1, 2, 3], 2)],
    win: { type: 'defeat' },
    // 盾兵6つで谷の幅いっぱいをふさぎ（守備）、その後ろから弓兵が撃つ。盾の正面からしか当たれないので、数の差が消える
    solution: [hq(2, 14), ...at('shield', 'hold', span(0, 5), 10), ...at('archer', 'hold', [2], 11)],
  },
  {
    id: '2-5',
    chapter: 2,
    index: 5,
    name: '寡兵の戦',
    hint: '敵の突撃を、どこで、どう受ける？',
    // 行 8・9 が川、その奥（自軍の前の2行）の中央8列が丘、両脇が森。敵は 1.54 倍で、12秒と30秒に全軍突撃してくる
    field: terrainField(12, [['river', span(0, 11), [8, 9]], ['hill', span(2, 9), [10, 11]], ['forest', [0, 1], span(10, 13)], ['forest', [10, 11], span(10, 13)]]),
    roster: { hq: 1, infantry: 4, shield: 2, cavalry: 2, archer: 2 },
    enemy: [hq(5, 0), ...at('infantry', 'advance', span(2, 9), 4), ...at('infantry', 'advance', [3, 5, 6, 8], 3), ...at('cavalry', 'flank', [1, 10], 3), ...at('archer', 'advance', [5], 2)],
    enemyOrders: [
      { atSec: 12, target: 'all', kind: 'charge' },
      { atSec: 30, target: 'all', kind: 'charge' },
    ],
    win: { type: 'defeat' },
    // 岸の上の丘に守備で並び（川から上がってくる敵を、丘の上から打つ）、騎兵は両脇の森で守備。
    // 敵の最初の突撃（12秒）に堅守を合わせて受け止め、24秒に全軍突撃で押し返す
    solution: [hq(5, 14), ...at('infantry', 'hold', [3, 4, 7, 8], 10), ...at('shield', 'hold', [5, 6], 10), ...at('archer', 'hold', [5, 6], 11), ...at('cavalry', 'hold', [1, 10], 11)],
    solutionOrders: [
      { atSec: 12, target: 'all', kind: 'brace' },
      { atSec: 24, target: 'all', kind: 'charge' },
    ],
  },
  // ---------------------------------------------------------------- 第3章
  {
    id: '3-1',
    chapter: 3,
    index: 1,
    name: '柵の守り',
    hint: '柵の外側を回ってくる敵は？',
    // 自軍の配置エリアのいちばん前の行（行 10）の中央8列が柵。敵は正面に盾兵と歩兵、両端に迂回の騎兵4。120秒守り切れば勝ち
    field: terrainField(12, [['fence', span(2, 9), [10]]]),
    roster: { hq: 1, shield: 4, infantry: 6, archer: 2 },
    enemy: [hq(5, 0), ...at('infantry', 'advance', [2, 3, 8, 9], 4), ...at('shield', 'advance', [4, 5, 6, 7], 4), ...at('infantry', 'advance', [4, 5, 6], 3), ...at('cavalry', 'flank', [0, 1, 10, 11], 3)],
    win: { type: 'survive' },
    seconds: 120,
    // 柵のマスに歩兵と盾兵を守備で並べ、柵の外の両端の内側（列 1・10）に盾兵を守備で置いて、端を回ってくる騎兵を正面で受ける
    solution: [hq(5, 13), ...at('infantry', 'hold', [2, 3, 4, 7, 8, 9], 10), ...at('shield', 'hold', [5, 6], 10), ...at('shield', 'hold', [1, 10], 11), ...at('archer', 'hold', [5, 6], 11)],
  },
  {
    id: '3-2',
    chapter: 3,
    index: 2,
    name: '砦攻め',
    hint: '門へ向かう間、本陣は誰が守る？',
    // 行 5 が城壁で、門は (5, 5)。城壁の内側に弓兵6・歩兵3と本陣。城壁の外の両端（行 7・8）に、本陣狙いの騎兵4と迂回の騎兵2
    field: terrainField(12, [['wall', [...span(0, 4), ...span(6, 11)], [5]]]),
    roster: { hq: 1, shield: 4, infantry: 4, archer: 3, cavalry: 2 },
    enemy: [
      hq(5, 1),
      ...at('archer', 'hold', [3, 4, 6, 7], 4),
      ...at('archer', 'hold', [4, 6], 3),
      ...at('infantry', 'hold', [3, 7], 2),
      ...at('infantry', 'hold', [5], 2),
      ...at('cavalry', 'hunt', [0, 1, 10, 11], 7),
      ...at('cavalry', 'flank', [0, 11], 8),
    ],
    win: { type: 'gate' },
    gate: { col: 5, row: 5 },
    seconds: 120,
    // 盾兵を先頭に門へ進み（矢を盾で受ける）、弓兵が後ろから内側の弓兵を削る。本陣のそばには歩兵2と騎兵2を守備で残し、
    // 開戦してすぐ本陣を狙ってくる騎兵を止める
    solution: [hq(5, 14), ...at('shield', 'advance', [4, 5, 6, 7], 10), ...at('infantry', 'advance', [3, 8], 10), ...at('archer', 'advance', [4, 5, 6], 11), ...at('infantry', 'hold', [4, 6], 15), ...at('cavalry', 'hold', [2, 9], 14)],
  },
  {
    id: '3-3',
    chapter: 3,
    index: 3,
    name: '挟み撃ち',
    hint: '横から来る騎兵は、どこで止める？',
    // 正面に歩兵8と盾兵2（前進）。中間地帯の両端（行 7）に騎兵2ずつ（前進）。開戦してすぐ、両脇から突っ込んでくる
    field: plainField(),
    roster: { hq: 1, infantry: 6, shield: 4, archer: 2, cavalry: 2 },
    enemy: [hq(5, 0), ...at('infantry', 'advance', span(2, 9), 4), ...at('shield', 'advance', [5, 6], 3), ...at('cavalry', 'advance', [0, 1], 7), ...at('cavalry', 'advance', [10, 11], 7)],
    win: { type: 'defeat' },
    // 両翼の歩兵3つずつを前へ出して、両脇の騎兵が助走をつける前にぶつかる（突入させない）。中央は盾兵4の守備で正面の敵を受け、
    // 弓兵がその後ろから撃つ。騎兵は両端から回り込む
    solution: [hq(5, 14), ...at('shield', 'hold', [4, 5, 6, 7], 12), ...at('infantry', 'advance', [0, 1, 2, 9, 10, 11], 10), ...at('archer', 'advance', [5, 6], 13), ...at('cavalry', 'flank', [0, 11], 11)],
  },
  {
    id: '3-4',
    chapter: 3,
    index: 4,
    name: '時を稼ぐ',
    hint: '柵と号令で、どこまで粘れる？',
    // 幅 7。自軍の配置エリアのいちばん前の行（行 10）が柵、いちばん奥の2行が丘。手持ちは8部隊で、敵は倍（2.08 倍）。90秒守り切れば勝ち
    field: terrainField(7, [['fence', span(0, 6), [10]], ['hill', span(0, 6), [14, 15]]]),
    roster: { hq: 1, shield: 5, infantry: 1, archer: 1 },
    enemy: [hq(3, 0), ...at('infantry', 'advance', span(0, 6), 4), ...at('infantry', 'advance', span(0, 6), 3), ...at('infantry', 'advance', [3], 2)],
    win: { type: 'survive' },
    seconds: 90,
    // 柵のマスに盾兵5と歩兵1を守備で並べ（盾の正面と柵の両方が効く）、弓兵はその後ろ。15秒ごとに堅守をかけ直して持ちこたえる
    solution: [hq(3, 13), ...at('shield', 'hold', [0, 1, 2, 4, 5], 10), ...at('infantry', 'hold', [6], 10), ...at('archer', 'hold', [3], 11)],
    solutionOrders: [
      { atSec: 15, target: 'all', kind: 'brace' },
      { atSec: 30, target: 'all', kind: 'brace' },
      { atSec: 45, target: 'all', kind: 'brace' },
    ],
  },
  {
    id: '3-5',
    chapter: 3,
    index: 5,
    name: '天下分け目',
    hint: '霧の奥と、三度の突撃に備えよ',
    // 行 7 が川。自軍の前の中央6列（行 10・11）が丘、左の3列（行 9〜12）が森、右の端3列のいちばん前の行が柵。
    // 敵の右奥（自軍から見て右の奥、列 9〜11 × 行 0〜2）が霧で、その中に迂回の騎兵3（見えている敵に騎兵はいない）。敵は 10・25・45 秒に全軍突撃
    field: terrainField(12, [['river', span(0, 11), [7]], ['hill', span(3, 8), [10, 11]], ['forest', [0, 1, 2], span(9, 12)], ['fence', [9, 10, 11], [10]]]),
    roster: { hq: 1, infantry: 5, shield: 3, cavalry: 3, archer: 3 },
    enemy: [hq(5, 0), ...at('infantry', 'advance', span(3, 8), 4), ...at('shield', 'advance', [4, 5, 6], 3), ...at('archer', 'advance', [4, 6], 2), ...at('cavalry', 'flank', [9, 10, 11], 1)],
    enemyOrders: [
      { atSec: 10, target: 'all', kind: 'charge' },
      { atSec: 25, target: 'all', kind: 'charge' },
      { atSec: 45, target: 'all', kind: 'charge' },
    ],
    fog: span(9, 11).flatMap((col) => span(0, 2).map((row) => ({ col, row }))),
    win: { type: 'defeat' },
    // 丘に守備で並び、弓兵は丘の上から撃つ。霧の騎兵が下りてくる右の端は、柵の盾兵とその後ろの歩兵で受ける。騎兵3は左の森の側から回り込む。
    // 敵の最初の突撃の直前（9秒）に全軍に堅守、28秒に全軍突撃で押し返す
    solution: [hq(5, 14), ...at('infantry', 'hold', [3, 4, 7, 8], 10), ...at('shield', 'hold', [5, 6], 10), ...at('shield', 'hold', [10], 10), ...at('infantry', 'hold', [9], 11), ...at('archer', 'hold', [4, 5, 6], 11), ...at('cavalry', 'flank', [0, 1, 2], 11)],
    solutionOrders: [
      { atSec: 9, target: 'all', kind: 'brace' },
      { atSec: 28, target: 'all', kind: 'charge' },
    ],
  },
];
