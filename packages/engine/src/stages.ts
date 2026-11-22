// 第1章〜第3章の面（design §3.10、§3.8「第2章・第3章の面」、§13.5）。第1章の戦場は標準の平原。自軍は陣営0（下）、敵は陣営1（上）。
// 座標は戦場の座標。標準の盤は 10×12 で、列 0 と列 9 は通り道（誰も置けない）、配置エリアは列 1〜8。
// 陣営0の配置エリアは行 8〜11、敵は行 0〜3、あいだは行 4〜7。狭い面（2-1 は幅 6、2-4・3-4 は幅 5）は通り道なしで、配置エリアは幅いっぱい。
//
// 2026-11-22 に、12×16 の盤の面から機械的に置き直した（design §13.5、decisions §22・§25）。難しさと星の条件は、まだ確かめていない
// （公開のあとに合わせる）。置き直しの決まり：
// - 手持ちと敵の数は、design §13.5 の計画表のとおり（両軍とも本陣を含めて 11 部隊まで）。減らす部隊は、面の学びに関わらないものから選んだ。
// - 行：敵とあいだの行は「いまの行 − 2」（0 より小さければ 0）。自軍の行 10・11 → 8・9、12・13 → 10、14・15 → 11。
//   1-2 と 3-2 の敵は、§13.5 の指定どおりにした（1-2 は騎兵を行 2・歩兵を行 1・本陣を行 0、3-2 は城壁の内側の弓兵を行 2・歩兵を行 1・本陣を行 0）。
// - 列：戦場のまん中からの距離を、配置できる幅の比（標準の盤は 8/12）で縮めて丸める。ちょうど半分のときは、まん中へ寄せる。
//   配置できる列（通り道の外）に収める。
// - 重なり：まん中に近い部隊から順に置き、埋まっていれば同じ行のいちばん近い空きマスへ（同じ近さなら、まん中から外、次に左）。
//   同じ行に空きがなければ、近い行へ（同じ近さなら自陣の奥）。
// - 地形と霧：いまのマスが平地でない部隊（森の中の歩兵、柵の上の盾兵など）は、写した先も同じ地形のマスにする。
//   霧の中の敵は、写した先も霧のマスにする。
// - 地形・霧・門は、design §13.5 の「面ごとの計画（戦場と地形）」のとおり。

import { plainField } from './army.ts';
import { applyTemplate } from './templates.ts';
import type { Stage } from './stage.ts';
import type { Field, Kind, Placement, Stance, Terrain } from './types.ts';

/** cols の各列に、同じ兵種・方針で並べる */
function at(kind: Kind, stance: Stance, cols: number[], row: number): Placement[] {
  return cols.map((col) => ({ kind, stance, col, row }));
}

const hq = (col: number, row: number): Placement => ({ kind: 'hq', stance: 'hold', col, row });

/** 幅 width の戦場に、[地形, 列の一覧, 行の一覧] の長方形を順に塗る（配置エリアは標準の深さ。標準の幅なら通り道つき） */
function terrainField(width: number, paint: [Terrain, number[], number[]][]): Field {
  const f = plainField(width);
  for (const [t, cols, rows] of paint) for (const r of rows) for (const c of cols) f.terrain[r * width + c] = t;
  return f;
}

/** a から b まで（両端を含む）の整数 */
const span = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** cols × rows のマス */
const cells = (cols: number[], rows: number[]): { col: number; row: number }[] => cols.flatMap((col) => rows.map((row) => ({ col, row })));

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
    enemy: [hq(4, 0), ...at('infantry', 'advance', [3, 4, 5], 2), ...at('infantry', 'advance', [4, 5], 1)],
    win: { type: 'defeat' },
    allow: BASIC,
    solution: [hq(4, 11), ...at('infantry', 'advance', [1, 2, 3, 4, 5, 6, 7], 8)],
  },
  {
    id: '1-2',
    chapter: 1,
    index: 2,
    name: '盾の壁',
    hint: '敵の騎兵は、どこを通る？',
    field: plainField(),
    roster: { hq: 1, infantry: 5, shield: 3 },
    // 騎兵3（列 2〜4、行 2）が先に当たり、歩兵4（列 3〜6、行 1）があとから来る。どちらも前進（2026-11-17 に作り直した。design §3.10）
    enemy: [hq(4, 0), ...at('cavalry', 'advance', [2, 3, 4], 2), ...at('infantry', 'advance', [3, 4, 5, 6], 1)],
    win: { type: 'defeat' },
    allow: BASIC,
    solution: [hq(4, 11), ...at('shield', 'hold', [2, 3, 4], 8), ...at('infantry', 'advance', [1, 2, 5, 6, 7], 9)],
  },
  {
    id: '1-3',
    chapter: 1,
    index: 3,
    name: '矢の雨',
    hint: '弓は、何の後ろに置く？',
    field: plainField(),
    roster: { hq: 1, infantry: 2, shield: 3, archer: 4 },
    enemy: [hq(4, 0), ...at('infantry', 'advance', [1, 2, 3, 4, 5, 6, 7, 8], 2)],
    win: { type: 'defeat' },
    allow: BASIC,
    // 盾兵3の後ろに弓兵4。歩兵2は左の端の後ろ（列 1、行 10・11）。盾兵の真後ろに歩兵を置くと、盾兵にふさがれて回り込みを始め、残りが減る（2026-11-22）
    solution: [hq(4, 10), ...at('shield', 'hold', [3, 4, 5], 8), ...at('archer', 'advance', [3, 4, 5, 6], 9), ...at('infantry', 'advance', [1], 10), ...at('infantry', 'advance', [1], 11)],
  },
  {
    id: '1-4',
    chapter: 1,
    index: 4,
    name: '両翼の騎馬',
    hint: '固い正面の、横と後ろは？',
    field: plainField(),
    roster: { hq: 1, infantry: 3, shield: 2, cavalry: 3, archer: 2 },
    // 盾兵5（列 1〜5、行 2）が固い正面になって前進し、その後ろから歩兵5（列 2〜6、行 1）が来る（2026-11-22 に合わせ直した）。
    // 盾兵6（列 2〜7）・歩兵4 のままでは、横陣（騎兵を両端で迂回させる形）がそのまま勝ち、見本は負けた。
    // 騎兵の方針を迂回から前進・守備・本陣狙いに替えると、見本の配置でも勝てない
    enemy: [hq(4, 0), ...at('shield', 'advance', [1, 2, 3, 4, 5], 2), ...at('infantry', 'advance', [2, 3, 4, 5, 6], 1)],
    win: { type: 'defeat' },
    allow: { orders: false },
    // 正面は守備で受け止め（盾兵を中央、歩兵を両脇）、弓兵は前進して撃ち、騎兵3つを右の端からまとめて回り込ませる（通り道を走る）
    solution: [
      hq(4, 11),
      ...at('shield', 'hold', [3, 4], 9),
      ...at('infantry', 'hold', [1, 2, 5], 9),
      ...at('archer', 'advance', [4, 5], 10),
      ...at('cavalry', 'flank', [7, 8, 6], 8),
    ],
  },
  {
    id: '1-5',
    chapter: 1,
    index: 5,
    name: '平原の決戦',
    hint: '鶴の真ん中は薄い。突撃はどう受ける？',
    field: plainField(),
    roster: { hq: 1, infantry: 4, shield: 2, cavalry: 2, archer: 2 },
    // 敵は鶴翼（10部隊）。10秒と30秒に全軍突撃してくる。
    // 鶴翼のひな形で並べ、弓兵の方針だけ前進にする（2026-11-17 にひな形の弓兵を守備に替える前と同じ並び・同じ方針。design §3.6.6）。
    // 敵の弓兵が守備だと、盾兵と弓兵が動かず、こちらの攻め手が尽きたあと時間切れまで何も起きない
    enemy: applyTemplate('crane', { hq: 1, infantry: 4, shield: 2, cavalry: 2, archer: 1 }, plainField().zones[1], 1).map((p) => (p.kind === 'archer' ? { ...p, stance: 'advance' as const } : p)),
    enemyOrders: [
      { atSec: 10, target: 'all', kind: 'charge' },
      { atSec: 30, target: 'all', kind: 'charge' },
    ],
    win: { type: 'defeat' },
    // 歩兵を楔にして鶴翼の薄い中央へ向け、盾兵で楔の両脇を固め、弓兵はその後ろで守備。騎兵2つは左の端からまとめて回り込む。
    // 敵の最初の突撃（10秒）に合わせて全軍に堅守をかけ、受け止めてから押し返す
    solution: [
      hq(4, 11),
      ...at('infantry', 'advance', [4, 5], 8),
      ...at('infantry', 'advance', [3, 4], 9),
      ...at('shield', 'advance', [2, 5], 9),
      ...at('archer', 'hold', [4, 5], 10),
      ...at('cavalry', 'flank', [1, 2], 10),
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
    // 幅 6（通り道なし）。自軍の配置エリアの前の2行（行 8・9）が、端から端まで丘。兵数で勝る敵（1.29 倍）が来る。
    // 前の行（行 3）の歩兵6は本陣狙い、後ろの行（行 2）の歩兵2・盾兵2は前進。全部前進で1行奥（置き直したまま）では、
    // 横陣（丘を下りて前進する形）が 20 勝した（2026-11-22）
    field: terrainField(6, [['hill', span(0, 5), [8, 9]]]),
    roster: { hq: 1, infantry: 4, shield: 2, archer: 2 },
    enemy: [hq(2, 0), ...at('infantry', 'hunt', span(0, 5), 3), ...at('infantry', 'advance', [1, 4], 2), ...at('shield', 'advance', [2, 3], 2)],
    win: { type: 'defeat' },
    // 丘の前の行に横一列で守備（盾兵は中央）。弓兵は丘の後ろの行で守備（丘の上なので、届く距離が伸びる）。丘を下りて戦うと押し負ける
    solution: [hq(2, 10), ...at('infantry', 'hold', [0, 1, 4, 5], 8), ...at('shield', 'hold', [2, 3], 8), ...at('archer', 'hold', [1, 4], 9)],
  },
  {
    id: '2-2',
    chapter: 2,
    index: 2,
    name: '森の待ち伏せ',
    hint: '見えない敵は、どこを通ってくる？',
    // 自軍の配置エリアの両脇（列 0・1 と列 8・9 × 行 8〜11。通り道を含む）が森。敵の両奥の角（列 0〜2 と列 7〜9 × 行 0〜3）が霧で、
    // その中に迂回の騎兵が3つずつ。見えている敵は歩兵だけ（騎兵がいない）。迂回の騎兵は通り道を下りてくるので、両脇の森を通る
    field: terrainField(10, [['forest', [0, 1], span(8, 11)], ['forest', [8, 9], span(8, 11)]]),
    roster: { hq: 1, infantry: 5, shield: 2, archer: 2 },
    enemy: [hq(4, 0), ...at('infantry', 'advance', [3, 4, 5, 6], 2), ...at('cavalry', 'flank', [1], 1), ...at('cavalry', 'flank', [1, 2, 7, 8], 0), ...at('cavalry', 'flank', [8], 1)],
    fog: cells([...span(0, 2), ...span(7, 9)], span(0, 3)),
    win: { type: 'defeat' },
    // 両脇の森の中（部隊を置けるのは列 1 と列 8）に歩兵2つずつを守備で置き、騎兵を森で受ける（突入が起きず、足も鈍る）。
    // 正面は盾兵と歩兵の守備、後ろに弓兵
    solution: [
      hq(4, 11),
      ...at('infantry', 'hold', [1], 10),
      ...at('infantry', 'hold', [1, 8], 9),
      ...at('infantry', 'hold', [8], 10),
      ...at('infantry', 'hold', [3], 8),
      ...at('shield', 'hold', [4, 5], 8),
      ...at('archer', 'hold', [3, 4], 9),
    ],
  },
  {
    id: '2-3',
    chapter: 2,
    index: 3,
    name: '川を渡る戦い',
    hint: '川の中で戦うのは、どちら？',
    // 行 6・7（自軍の配置エリアのすぐ手前）が、端から端まで川（通り道を含む）。兵数で勝る敵（1.29 倍）が渡ってくる
    field: terrainField(10, [['river', span(0, 9), [6, 7]]]),
    roster: { hq: 1, infantry: 4, shield: 2, archer: 2 },
    enemy: [hq(4, 0), ...at('infantry', 'advance', span(1, 8), 2), ...at('shield', 'advance', [4, 5], 1)],
    win: { type: 'defeat' },
    // 岸（行 8）に横一列で守備して、川の中にいる敵と戦う（盾兵は両端、歩兵4は中央）。前進させると、自分が川の中で戦うことになる。
    // 盾兵を中央に置く形（置き直したまま）は、20 勝するが星 1（残り 0.41）だった（2026-11-22）
    solution: [hq(4, 10), ...at('infantry', 'hold', [3, 4, 5, 6], 8), ...at('shield', 'hold', [1, 8], 8), ...at('archer', 'hold', [3, 6], 9)],
  },
  {
    id: '2-4',
    chapter: 2,
    index: 4,
    name: '谷の狭い道',
    hint: '狭い道なら、数の差は？',
    // 幅 5 の谷（通り道なし）。敵は盾兵5（行 3、本陣狙い）と歩兵5（行 2、前進）で、自軍の 1.46 倍（敵は11部隊が上限なので、いまの面の 1.88 倍は保てない。decisions §22）。
    // 歩兵10（置き直したまま）では、横陣（盾兵が前進）がそのまま 20 勝した。本陣狙いの盾兵は、盾兵の列にすき間ができると本陣へ抜けてくる（2026-11-22）
    field: plainField(5),
    roster: { hq: 1, shield: 5, archer: 2 },
    enemy: [hq(2, 0), ...at('shield', 'hunt', span(0, 4), 3), ...at('infantry', 'advance', span(0, 4), 2)],
    win: { type: 'defeat' },
    // 盾兵5つで谷の幅いっぱいをふさぎ（守備）、その後ろから弓兵が撃つ。盾の正面からしか当たれないので、数の差が消える
    solution: [hq(2, 11), ...at('shield', 'hold', span(0, 4), 8), ...at('archer', 'hold', [2, 1], 9)],
  },
  {
    id: '2-5',
    chapter: 2,
    index: 5,
    name: '寡兵の戦',
    hint: '敵の突撃を、どこで、どう受ける？',
    // 行 6・7 が川（端から端まで）、その奥（自軍の前の2行）の列 2〜7 が丘、両脇（列 0・1 と列 8・9 × 行 8〜11）が森。
    // 敵は歩兵8・迂回の騎兵2（1.52 倍）で、12秒と30秒に全軍突撃してくる。歩兵6が行 2（列 2〜7）、残りの歩兵2は行 1 の中央、
    // 騎兵は行 1 の両端（列 1・8）。公開のときは歩兵を6に減らしていた（1.21 倍）が、見本を作り直して計画表の数に戻した（2026-11-22）
    field: terrainField(10, [['river', span(0, 9), [6, 7]], ['hill', span(2, 7), [8, 9]], ['forest', [0, 1], span(8, 11)], ['forest', [8, 9], span(8, 11)]]),
    roster: { hq: 1, infantry: 2, shield: 1, cavalry: 2, archer: 2 },
    enemy: [hq(4, 0), ...at('infantry', 'advance', span(2, 7), 2), ...at('cavalry', 'flank', [1, 8], 1), ...at('infantry', 'advance', [4, 5], 1)],
    enemyOrders: [
      { atSec: 12, target: 'all', kind: 'charge' },
      { atSec: 30, target: 'all', kind: 'charge' },
    ],
    win: { type: 'defeat' },
    // 岸の上の丘に守備で並び（川から上がってくる敵を、丘の上から打つ）、騎兵は両脇の森で守備（迂回の騎兵を森で受ける）。
    // 敵の最初の突撃（12秒）に堅守を合わせて受け止め、24秒に全軍突撃で押し返す。号令なしでは星 1
    solution: [hq(4, 11), ...at('infantry', 'hold', [3, 4], 8), ...at('shield', 'hold', [5], 8), ...at('archer', 'advance', [3], 9), ...at('archer', 'hold', [5], 9), ...at('cavalry', 'hold', [1], 9), ...at('cavalry', 'hold', [8], 10)],
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
    // 自軍の配置エリアのいちばん前の行（行 8）の中央4列（列 3〜6）が柵。敵は正面に盾兵と歩兵、両端に迂回の騎兵2。120秒守り切れば勝ち。
    // 公開のときに外した正面の右端の歩兵（列 6、行 2）を、見本を作り直して戻した（敵11部隊、比 1.19。2026-11-22）
    field: terrainField(10, [['fence', span(3, 6), [8]]]),
    roster: { hq: 1, shield: 3, infantry: 3, archer: 2 },
    enemy: [hq(4, 0), ...at('infantry', 'advance', [2, 6], 2), ...at('shield', 'advance', [3, 4, 5], 2), ...at('infantry', 'advance', [3, 4, 5], 1), ...at('cavalry', 'flank', [2, 7], 1)],
    win: { type: 'survive' },
    seconds: 120,
    // 柵の4マスに歩兵2と盾兵2を守備で並べ、柵の外の左（列 2、行 8）に盾兵、右の後ろ（列 7、行 9）に予備の歩兵を置いて、
    // 端を回ってくる騎兵を受ける。約 22 秒おきに全軍に堅守（5・27・49 秒）。号令なしでは勝てない。
    // 柵を平地に替えると、20 勝 → 14 勝（残り 0.66 → 0.31）
    solution: [hq(4, 10), ...at('infantry', 'hold', [4], 8), ...at('infantry', 'hold', [7], 9), ...at('infantry', 'hold', [3], 8), ...at('shield', 'hold', [5, 2, 6], 8), ...at('archer', 'hold', [3, 6], 9)],
    solutionOrders: [
      { atSec: 5, target: 'all', kind: 'brace' },
      { atSec: 27, target: 'all', kind: 'brace' },
      { atSec: 49, target: 'all', kind: 'brace' },
    ],
  },
  {
    id: '3-2',
    chapter: 3,
    index: 2,
    name: '砦攻め',
    hint: '門へ向かう間、本陣は誰が守る？',
    // 行 3 が城壁（列 0〜9。通り道にも）で、門は (4, 3)。城壁の内側に弓兵4・歩兵2と本陣。城壁の外（行 5・6）に、本陣狙いの騎兵2と迂回の騎兵2
    field: terrainField(10, [['wall', [...span(0, 3), ...span(5, 9)], [3]]]),
    roster: { hq: 1, shield: 3, infantry: 3, archer: 2, cavalry: 2 },
    enemy: [
      hq(4, 0),
      ...at('archer', 'hold', [3, 4, 5, 6], 2),
      ...at('infantry', 'hold', [3, 5], 1),
      ...at('cavalry', 'hunt', [2, 7], 5),
      ...at('cavalry', 'flank', [1, 8], 6),
    ],
    win: { type: 'gate' },
    gate: { col: 4, row: 3 },
    seconds: 120,
    // 盾兵を先頭に門へ進み（矢を盾で受ける）、弓兵が後ろから内側の弓兵を削る。本陣のそばには歩兵2と騎兵2を守備で残し、
    // 開戦してすぐ本陣を狙ってくる騎兵を止める
    solution: [hq(4, 11), ...at('shield', 'advance', [3, 4, 5], 8), ...at('infantry', 'advance', [2], 8), ...at('archer', 'advance', [3, 4], 9), ...at('infantry', 'hold', [3, 5], 11), ...at('cavalry', 'hold', [2, 7], 11)],
  },
  {
    id: '3-3',
    chapter: 3,
    index: 3,
    name: '挟み撃ち',
    hint: '横から来る騎兵は、どこで止める？',
    // 正面に歩兵4と盾兵2（前進）。両脇の列 1 と列 8 の行 3・4 に騎兵2ずつ縦に並ぶ（前進）。開戦してすぐ、両脇から突っ込んでくる。4秒に全軍突撃。
    // 騎兵を行 5 の列 1・2 と列 7・8 に置いた形（置き直したまま）では、横陣が 20 勝し、見本は 0 勝だった（2026-11-22 に合わせ直した）。
    // 見本の両翼の歩兵を守備にすると 0 勝、1 行下げると星 1 になる（両翼を前へ出すのが効く）
    field: plainField(),
    roster: { hq: 1, infantry: 4, shield: 3, archer: 1, cavalry: 2 },
    enemy: [hq(4, 0), ...at('infantry', 'advance', [3, 4, 5, 6], 2), ...at('shield', 'advance', [4, 5], 1), ...at('cavalry', 'advance', [1, 8], 4), ...at('cavalry', 'advance', [1, 8], 3)],
    enemyOrders: [{ atSec: 4, target: 'all', kind: 'charge' }],
    win: { type: 'defeat' },
    // 両翼の歩兵2つずつを前へ出して、両脇の騎兵が助走をつける前にぶつかる（突入させない）。中央は盾兵3の守備で正面の敵を受け、
    // 弓兵がその後ろから撃つ。騎兵は両端から回り込む
    solution: [hq(4, 11), ...at('shield', 'hold', [2, 4, 5], 10), ...at('infantry', 'advance', [1, 2, 7, 8], 8), ...at('archer', 'advance', [3], 10), ...at('cavalry', 'flank', [1, 8], 9)],
  },
  {
    id: '3-4',
    chapter: 3,
    index: 4,
    name: '時を稼ぐ',
    hint: '柵と号令で、どこまで粘れる？',
    // 幅 5（通り道なし）。自軍の配置エリアのいちばん前の行（行 8）が柵、いちばん奥の2行（行 10・11）が丘。
    // 手持ちは6部隊（柵の幅と同じ盾兵5と本陣）で、敵は 1.86 倍（いまの面の 2.03 倍は、敵の11部隊の上限で保てない。decisions §22）。90秒守り切れば勝ち
    field: terrainField(5, [['fence', span(0, 4), [8]], ['hill', span(0, 4), [10, 11]]]),
    roster: { hq: 1, shield: 5 },
    // 前の行（行 2）の歩兵5は本陣狙い、後ろの行（行 1）の歩兵5は前進。全部前進（置き直したまま）では、横陣（盾兵が前進）が
    // そのまま守り切った。本陣狙いの歩兵は、柵の盾兵の列にすき間ができると本陣へ抜けてくる（2026-11-22）
    enemy: [hq(2, 0), ...at('infantry', 'hunt', span(0, 4), 2), ...at('infantry', 'advance', span(0, 4), 1)],
    win: { type: 'survive' },
    seconds: 90,
    // 柵の5マスを、盾兵5の守備ですき間なく埋め（盾の正面と柵の両方が効く）、15秒ごとに堅守をかけ直して持ちこたえる。
    // 柵の列にすき間があると、そこへ入った敵が両隣のどちらを攻めるかが置く順で変わり、勝ち負けが置く順で変わる
    solution: [hq(2, 10), ...at('shield', 'hold', span(0, 4), 8)],
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
    // 行 5 が川（端から端まで）。自軍の前の中央4列（列 3〜6 × 行 8・9）が丘、左の3列（列 0〜2 × 行 7〜10）が森、右の端の行 8 の列 7・8 が柵。
    // 敵の右奥（自軍から見て右の奥、列 7〜9 × 行 0〜2）が霧で、その中に迂回の騎兵2（見えている敵に騎兵はいない）。敵は 10・25・45 秒に全軍突撃。
    // 敵の盾兵2は右の前（列 7・8、行 3。霧の外）で、突撃のたびに右の端の柵へ正面から当たる。歩兵4は行 2 の中央（2026-11-22 に合わせ直した。
    // 置き直したままの、盾兵が歩兵の後ろの中央にいる形では、横陣が 20 勝し、見本は 3 勝だった）
    field: terrainField(10, [['river', span(0, 9), [5]], ['hill', span(3, 6), [8, 9]], ['forest', [0, 1, 2], span(7, 10)], ['fence', [7, 8], [8]]]),
    roster: { hq: 1, infantry: 4, shield: 2, cavalry: 2, archer: 2 },
    enemy: [hq(4, 0), ...at('infantry', 'advance', [3, 4, 5, 6], 2), ...at('shield', 'advance', [7, 8], 3), ...at('archer', 'advance', [3, 5], 0), ...at('cavalry', 'flank', [7, 8], 1)],
    enemyOrders: [
      { atSec: 10, target: 'all', kind: 'charge' },
      { atSec: 25, target: 'all', kind: 'charge' },
      { atSec: 45, target: 'all', kind: 'charge' },
    ],
    fog: cells(span(7, 9), span(0, 2)),
    win: { type: 'defeat' },
    // 丘に守備で並び（歩兵2・盾兵1）、弓兵2は丘の上から撃つ。右の端は、柵の2マス（列 7・8）に歩兵と盾兵を守備で置き、盾兵の後ろ（列 8、行 9）に歩兵。
    // 霧の騎兵は通り道を下りてきて、まず柵の後ろの歩兵に当たる。敵の右の盾兵は、柵の正面に当たる。騎兵2は左の森の側から回り込む。
    // 敵の最初の突撃の直前（9秒）に中央に堅守、10秒に右翼に堅守、20秒に中央の突撃で押し返す
    solution: [
      ...at('shield', 'hold', [8], 8),
      ...at('infantry', 'hold', [8], 9),
      ...at('shield', 'hold', [6], 8),
      hq(4, 11),
      ...at('infantry', 'hold', [3, 4, 7], 8),
      ...at('archer', 'hold', [4, 5], 9),
      ...at('cavalry', 'flank', [1, 2], 9),
    ],
    solutionOrders: [
      { atSec: 9, target: 'center', kind: 'brace' },
      { atSec: 10, target: 'right', kind: 'brace' },
      { atSec: 20, target: 'center', kind: 'charge' },
    ],
  },
];
