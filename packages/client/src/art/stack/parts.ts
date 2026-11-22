// 立体の兵と木の部品（design §14.2）。文字で書いた 4 方向の絵（上・横・前・後ろ）を、削り出し（carve.ts）で立体にする。
// 絵のデータは 2回目の試作（proto17v2/art.js）で仕上げたものを、そのまま写した（描き込みは試作で済んでいる。直すなら試作に戻す）。
// Phaser も DOM も読まない（画面なしのテストと、ワーカーの両方から使う）。

import { ART, COLOR, SIDE_COLOR, TERRAIN } from '../palette.ts';

/**
 * 部品（4方向の絵）。
 * 座標：x は左→右、y は前（敵の方）→後ろ、z は地面 0 → 上。
 * top: y の行 × x の列（真上から）。side: z の行（上から）× y の列（右の横から、列 0 が前）。
 * front / back: z の行（上から）× x の列（左右を返さずに x の順で書く）。back を省くと front と同じ。
 * round: 真上の形を、各層で前と横の幅から決まる楕円で切る（丸い物）。
 */
export interface Part {
  readonly top: readonly string[];
  readonly side: readonly string[];
  readonly front: readonly string[];
  readonly back?: readonly string[];
  readonly round?: boolean;
}

/** 部品と、型の中の置き場所（x, y, z） */
export type Entry = readonly [Part, number, number, number];

/** 型の箱の大きさ */
export interface Dims {
  readonly W: number;
  readonly D: number;
  readonly H: number;
}

const rep = (s: string, n: number): string[] => Array<string>(n).fill(s);

/** 中身がひと色の箱 */
function box(w: number, d: number, h: number, ch: string): Part {
  return { top: rep(ch.repeat(w), d), side: rep(ch.repeat(d), h), front: rep(ch.repeat(w), h) };
}

const banner: Part = {
  top: rep('bbbbbbb', 2),
  side: rep('bb', 16),
  front: ['bbbbbbb', 'baaaaab', 'baaaaab', 'baGGGab', 'bagggab', 'bagggab', 'baGGGab', 'baaaaab', 'baaaaab', 'baaaaab', 'baaaaab', 'baaaaab', 'baaaaab', 'bbbbbbb', 'b.b.b.b', 'b.b.b.b'],
};

/** 部品の一覧（試作の P と同じ中身） */
export const P = {
  // ---- 人（共通） ----
  // 脚：太もも（上の 2 層）とすね（下の 3 層、足は暗い）を分け、歩くときにすねを前後へずらす
  thigh: box(2, 2, 2, 'd'),
  thigh3: box(2, 2, 3, 'd'),
  shin: { top: ['dd', 'dd'], side: ['dd', 'dd', 'kk'], front: ['dd', 'dd', 'kk'] },
  // 腰の草摺り
  skirt: { top: rep('dddddd', 4), side: ['dddd', 'dddd'], front: ['dddddd', 'd.dd.d'], back: ['dddddd', 'd.dd.d'] },
  // 胴：肩が明るい、帯が木の色
  torso: {
    top: rep('bbbbbb', 4),
    side: ['bbbb', 'aaaa', 'aaaa', 'aaaa', 'wwww'],
    front: ['bbbbbb', 'aaaaaa', 'abaaba', 'aaaaaa', 'wwwwww'],
    back: ['bbbbbb', 'aaaaaa', 'aaaaaa', 'aaaaaa', 'wwwwww'],
  },
  // 腕（肩当て・袖・手）
  arm: { top: ['bb', 'bb'], side: ['bb', 'aa', 'aa', 'dd', 'ss'], front: ['bb', 'aa', 'aa', 'dd', 'ss'] },
  // 頭：前は顔（目）、後ろは髪
  head: { top: ['ssss', 'kkkk', 'kkkk', 'kkkk'], side: ['skkk', 'sssk', 'sssk'], front: ['ssss', 'ssss', 'ssss'], back: ['kkkk', 'kkkk', 'kkkk'] },
  // 鉄の兜（丸い鉢＋つば＋後ろの しころ）
  helm: {
    top: ['.hhhh.', 'hhhhhh', 'hhhhhh', 'hhhhhh', 'hhhhhh', '.hhhh.'],
    side: ['.hhhh.', 'hhhhhh', 'hhhhhh'],
    front: ['.hhhh.', 'hhhhhh', 'hhhhhh'],
    round: true,
  },
  neckGuard: box(6, 1, 3, 'h'),
  // 歩兵の兜：鉢の上に とがり
  spike: box(2, 2, 2, 'm'),
  // ---- 歩兵の槍：太さ 2×2、頭より高く立てる。穂先の下に陣営の色の房 ----
  spearShaft: box(2, 2, 22, 'w'),
  spearTassel: { top: rep('bbbb', 4), side: ['bbbb', 'aaaa', '.aa.'], front: ['bbbb', 'aaaa', '.aa.'], round: false },
  spearHead: { top: ['mm', 'mm'], side: ['.m', 'mm', 'mm', 'mm', 'mm'], front: ['mm', 'mm', 'mm', 'mm', 'mm'] },
  // ---- 盾兵の大盾（前は青銅に陣営の帯と鋲、後ろは木の板に鉄の帯） ----
  shield: {
    top: rep('qqqqqqqqqqqq', 2),
    side: rep('qq', 15),
    front: [
      'qqqqqqqqqqqq', 'qppppppppppq', 'qpaaaaaaaapq', 'qpaaaaaaaapq', 'qppppppppppq', 'qppppmmppppq', 'qpppmmmmpppq',
      'qppppmmppppq', 'qppppppppppq', 'qpaaaaaaaapq', 'qpaaaaaaaapq', 'qppppppppppq', 'qppppppppppq', 'qppppppppppq', 'qqqqqqqqqqqq',
    ],
    back: [
      'qqqqqqqqqqqq', 'qwwwwwwwwwwq', 'qwwwwwwwwwwq', 'qhhhhhhhhhhq', 'qwwwwwwwwwwq', 'qwwwwwwwwwwq', 'qwwwwwwwwwwq',
      'qwwwwwwwwwwq', 'qwwwwwwwwwwq', 'qwwwwwwwwwwq', 'qhhhhhhhhhhq', 'qwwwwwwwwwwq', 'qwwwwwwwwwwq', 'qwwwwwwwwwwq', 'qqqqqqqqqqqq',
    ],
  },
  // 盾兵の兜：前立ての小さな鉄板（兜を歩兵と変える）
  ridge: { top: ['hh', 'hh', 'hh', 'hh'], side: ['hhhh'], front: ['hh'] },
  // ---- 弓兵：笠（丸い）、弓（横から見て前へ反る）、背中の矢筒と矢羽 ----
  hat: {
    top: ['pppppppppp', 'pyyyyyyyyp', 'pyyyyyyyyp', 'pyyyyyyyyp', 'pyyyyyyyyp', 'pyyyyyyyyp', 'pyyyyyyyyp', 'pyyyyyyyyp', 'pyyyyyyyyp', 'pppppppppp'],
    side: ['....yy....', '...yyyy...', '.yyyyyyyy.', 'pppppppppp'],
    front: ['....yy....', '...yyyy...', '.yyyyyyyy.', 'pppppppppp'],
    round: true,
  },
  bow: {
    top: rep('ll', 5),
    side: ['...ll', '..ll.', '.ll..', '.ll..', 'll...', 'll...', 'll...', 'll...', 'll...', 'll...', 'll...', 'll...', 'll...', '.ll..', '.ll..', '..ll.', '...ll', '...ll'],
    front: rep('ll', 18),
  },
  quiver: { top: ['ww', 'ww'], side: ['mm', 'mm', 'll', 'll', 'll', 'll', 'll', 'll', 'll'], front: ['mm', 'mm', 'll', 'll', 'll', 'll', 'll', 'll', 'll'] },
  // ---- 本陣 ----
  helmGold: {
    top: ['.gggg.', 'gggggg', 'gggggg', 'gggggg', 'gggggg', '.gggg.'],
    side: ['.gggg.', 'gggggg', 'oooooo'],
    front: ['.gggg.', 'gggggg', 'oooooo'],
    round: true,
  },
  // 鍬形（V 字の前立て）：左右とも 2×2 の太さで、どの向きからも欠けないようにする
  crest: { top: rep('gggggggggggg', 2), side: rep('gg', 4), front: ['gg........gg', '.gg......gg.', '..gg....gg..', '...gggggg...'] },
  headTop: box(4, 4, 1, 'k'),
  cape: { top: rep('dddddddd', 2), side: ['gg', ...rep('dd', 7), 'oo'], front: ['gggggggg', ...rep('dddddddd', 7), 'oooooooo'] },
  chestGold: { top: ['gggg'], side: rep('g', 3), front: ['gggg', 'gGGg', 'gggg'] },
  // 旗竿と幟（のぼり）。幟は厚さ 2。前を向く幟（banner）と、横を向く幟（bannerSideL。前の絵と横の絵を入れ替えたもの）
  pole: box(2, 2, 29, 'w'),
  poleTop: box(2, 2, 2, 'g'),
  banner,
  bannerSideL: { top: rep('bb', 7), side: banner.front, front: rep('bb', 16) },
  // 指物（本陣が 1 体だけ残ったときの将の背中の小さな旗）。横から見ても欠けないよう、後ろへも 1 枚（十字）
  sashiPole: box(2, 2, 19, 'w'),
  sashi: { top: rep('bbbbb', 2), side: rep('bb', 9), front: ['bbbbb', 'baaab', 'bagab', 'bagab', 'baaab', 'baaab', 'baaab', 'bbbbb', 'b.b.b'] },
  sashiSide: { top: rep('bb', 4), side: ['bbbb', 'baab', 'bgab', 'baab', 'baab', 'baab', 'baab', 'bbbb', 'b.b.'], front: rep('bb', 9) },
  // ---- 馬 ----
  hBody: {
    top: ['.rrrrrr.', ...rep('rrrrrrrr', 10), '.rrrrrr.'],
    side: ['..rrrrrrrr..', '.rrrrrrrrrr.', 'rrrrrrrrrrrr', 'rrrrrrrrrrrr', '.RRRRRRRRRR.'],
    front: ['.rrrrrr.', 'rrrrrrrr', 'rrrrrrrr', 'rrrrrrrr', '.RRRRRR.'],
  },
  hThigh: box(2, 2, 3, 'r'),
  hShin: { top: ['rr', 'rr'], side: ['rr', 'rr', 'rr', 'RR'], front: ['rr', 'rr', 'rr', 'RR'] },
  hNeck: { top: rep('rrrr', 5), side: ['rr...', 'rrr..', 'rrrr.', '.rrrr', '.rrrr', '..rrr', '..rrr', '..rrr', '..rrr'], front: rep('rrrr', 9) },
  hMane: { top: rep('RR', 4), side: ['RR..', 'RRR.', '.RRR', '.RRR', '..RR', '..RR', '..RR'], front: rep('RR', 7) },
  hHead: { top: ['.rr.', 'rrrr', 'rrrr', 'rrrr', 'rrrr', 'rrrr'], side: ['...rrr', '..rrrr', '.rrrrr', 'rrrrr.', 'RRRr..'], front: ['rrrr', 'rmmr', 'rmmr', 'rrrr', 'RRRR'] },
  hEar: box(1, 2, 2, 'r'),
  hTail: { top: ['RR', 'RR', 'RR'], side: ['RR.', 'RRR', '.RR', '.RR', '.RR', '.RR', '..R'], front: rep('RR', 7) },
  // 鞍の布（陣営の色。馬の横腹を覆い、どの向きからも陣営が分かる）
  saddle: {
    top: rep('bbbbbbbbbb', 6),
    side: ['bbbbbb', 'aaaaaa', 'aaaaaa', 'aaaaaa', 'dddddd'],
    front: ['bbbbbbbbbb', 'aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaaaaaaa', 'dddddddddd'],
  },
  riderLeg: { top: ['dd', 'dd', 'dd'], side: ['ddd', 'ddd', 'ddd', 'kkk'], front: ['dd', 'dd', 'dd', 'kk'] },
  // 騎兵の槍：前へ倒して持つ（立てた歩兵の槍と見分ける）
  lance: {
    top: [...rep('mm', 2), ...rep('ww', 12)],
    side: [
      'mm............', 'mmm...........', '.mm...........', '.bbb..........', '..www.........', '..www.........', '...www........',
      '...www........', '....www.......', '....www.......', '.....www......', '.....www......', '......www.....', '.......www....',
      '.......www....', '........www...', '........www...', '.........www..', '..........www.', '...........www',
    ],
    front: [...rep('mm', 3), 'bb', ...rep('ww', 16)],
  },
  // ---- 木 ----
  treeTrunk: box(2, 2, 10, 'P'),
  treeCanopy: round(
    ['...FFFFFF...', '.FFFFFFFFFF.', '.FFFFFFFFFF.', ...rep('FFFFFFFFFFFF', 6), '.FFFFFFFFFF.', '.FFFFFFFFFF.', '...FFFFFF...'],
    ['...EEEEEE...', '.EEEEEEEEEE.', 'FFFFFFFFFFFF', 'FFFFFFFFFFFF', 'FFFFFFFFFFFF', 'FFFFFFFFFFFF', 'LLLLLLLLLLLL', '.LLLLLLLLLL.', '...LLLLLL...'],
  ),
  treeTop: round(
    ['..EEEE..', '.EEEEEE.', 'EEEEEEEE', 'EEEEEEEE', 'EEEEEEEE', 'EEEEEEEE', '.EEEEEE.', '..EEEE..'],
    ['...EE...', '.EEEEEE.', 'EEEEEEEE', 'FFFFFFFF'],
  ),
  treeCanopyS: round(
    ['..FFFFFF..', '.FFFFFFFF.', ...rep('FFFFFFFFFF', 6), '.FFFFFFFF.', '..FFFFFF..'],
    ['..EEEEEE..', 'EEEEEEEEEE', 'FFFFFFFFFF', 'FFFFFFFFFF', 'FFFFFFFFFF', 'LLLLLLLLLL', '.LLLLLLLL.', '..LLLLLL..'],
  ),
} satisfies Record<string, Part>;

/** 横と前が同じ、丸い部品（木の葉） */
function round(top: string[], side: string[]): Part {
  return { top, side, front: side, round: true };
}

// ---- 型の一覧 ----

/** 1 体ずつの絵の型（本陣は 将・幟の護衛 2 種・旗を背負った将） */
export const MODEL_IDS = ['infantry', 'shield', 'archer', 'cavalry', 'general', 'guardA', 'guardB', 'generalF'] as const;
export type ModelId = (typeof MODEL_IDS)[number];
export const WALK_FRAMES = 4;
export const HUMAN: Dims = { W: 20, D: 20, H: 33 };
export const HORSE: Dims = { W: 16, D: 26, H: 32 };
export const TREE_DIMS: Dims = { W: 16, D: 16, H: 26 };
export const TREE_IDS = [0, 1] as const;
export type TreeId = (typeof TREE_IDS)[number];

/** 型の箱の大きさ */
export function dimsOf(id: ModelId): Dims {
  return id === 'cavalry' ? HORSE : HUMAN;
}

/** 型を立てる中心（騎兵だけ、馬の胴のまん中に寄せる） */
export function centerOf(id: ModelId): { cx?: number; cy?: number } {
  return id === 'cavalry' ? { cy: 13 } : {};
}

/** 人の脚：歩くコマ f（0..3）。1 と 3 で すねを前後へ 2 ずらし、太ももは 1 */
function humanLegs(f: number, x0 = 7, x1 = 11, y = 9): Entry[] {
  const sh = [0, 2, 0, -2][f]!;
  const th = [0, 1, 0, -1][f]!;
  // 脚がそろうコマ（0・2）は体が 1 上がる（太ももを 1 長く）
  const thigh = f % 2 ? P.thigh : P.thigh3;
  return [
    [P.shin, x0, y - sh, 0],
    [thigh, x0, y - th, 3],
    [P.shin, x1, y + sh, 0],
    [thigh, x1, y + th, 3],
  ];
}

/** 歩くコマの上下（0・2 で 1 上がる） */
const BOB = [1, 0, 1, 0];

/** 人の上半身（腕は x 5..6 と 13..14） */
function humanBody(): Entry[] {
  return [
    [P.skirt, 7, 8, 5],
    [P.torso, 7, 8, 7],
    [P.head, 8, 8, 12],
    [P.arm, 5, 9, 7],
    [P.arm, 13, 9, 7],
  ];
}

/** 人の上半身と持ち物（脚は humanLegs） */
function humanParts(id: Exclude<ModelId, 'cavalry'>): Entry[] {
  switch (id) {
    case 'infantry':
      return [...humanBody(), [P.helm, 7, 7, 15], [P.neckGuard, 7, 12, 13], [P.spike, 9, 9, 18], [P.spearShaft, 15, 9, 3], [P.spearTassel, 14, 8, 22], [P.spearHead, 15, 9, 25]];
    case 'shield':
      return [...humanBody(), [P.helm, 7, 7, 15], [P.neckGuard, 7, 12, 13], [P.ridge, 9, 6, 17], [P.shield, 4, 5, 1]];
    case 'archer':
      return [...humanBody(), [P.headTop, 8, 8, 15], [P.headTop, 8, 8, 16], [P.hat, 5, 5, 17], [P.bow, 2, 6, 2], [P.quiver, 11, 12, 7]];
    case 'general':
      return [...humanBody(), [P.cape, 6, 12, 3], [P.chestGold, 8, 7, 8], [P.helmGold, 7, 7, 15], [P.neckGuard, 7, 12, 13], [P.crest, 4, 7, 17]];
    // 本陣が 1 体だけ残ったとき：将の背中に小さな旗（指物）。旗のない本陣にしないため
    case 'generalF':
      return [...humanParts('general'), [P.sashiPole, 9, 13, 8], [P.poleTop, 9, 13, 27], [P.sashi, 11, 13, 18], [P.sashiSide, 9, 15, 18]];
    case 'guardA':
      return [...humanBody(), [P.helm, 7, 7, 15], [P.neckGuard, 7, 12, 13], [P.pole, 9, 13, 1], [P.poleTop, 9, 13, 30], [P.banner, 11, 13, 14]];
    case 'guardB':
      return [...humanBody(), [P.helm, 7, 7, 15], [P.neckGuard, 7, 12, 13], [P.pole, 9, 12, 1], [P.poleTop, 9, 12, 30], [P.bannerSideL, 9, 13, 14]];
  }
}

/** 騎兵：馬の脚は、前の対と後ろの対を互い違いに出す */
function cavalryParts(f: number): Entry[] {
  const a = [0, 2, 0, -2][f]!;
  const b = [0, 1, 0, -1][f]!;
  const up = f % 2;
  return [
    [P.hShin, 4, 8 - a, 0],
    [P.hThigh, 4, 8 - b, 4],
    [P.hShin, 10, 8 + a, 0],
    [P.hThigh, 10, 8 + b, 4],
    [P.hShin, 4, 16 + a, 0],
    [P.hThigh, 4, 16 + b, 4],
    [P.hShin, 10, 16 - a, 0],
    [P.hThigh, 10, 16 - b, 4],
    [P.hBody, 4, 7, 6],
    [P.hNeck, 6, 3, 9],
    [P.hMane, 7, 4, 12],
    [P.hHead, 6, 0, 15 - up],
    [P.hEar, 6, 4, 20 - up],
    [P.hEar, 9, 4, 20 - up],
    [P.hTail, 7, 19, 4],
    [P.saddle, 3, 10, 8],
    [P.riderLeg, 2, 11, 9],
    [P.riderLeg, 12, 11, 9],
    [P.torso, 5, 11, 12],
    [P.arm, 3, 12, 12],
    [P.arm, 11, 12, 12],
    [P.head, 6, 11, 17],
    [P.helm, 5, 10, 20],
    [P.neckGuard, 5, 15, 18],
    [P.spike, 7, 12, 23],
    [P.lance, 14, 2, 8],
  ];
}

/** 型 id の、歩くコマ f の部品の並び */
export function modelParts(id: ModelId, f: number): Entry[] {
  if (id === 'cavalry') return cavalryParts(f);
  const legs = humanLegs(f);
  const up = humanParts(id).map(([p, x, y, z]): Entry => [p, x, y, z + BOB[f]!]);
  // 腕の振り：武器を持たない腕を、脚と逆に 1 前後へ
  const swing = [0, -1, 0, 1][f]!;
  const freeL = id !== 'archer';
  const freeR = id !== 'infantry';
  return [
    ...legs,
    ...up.map((e): Entry => {
      if (e[0] === P.arm && e[1] === 5 && freeL) return [e[0], e[1], e[2] + swing, e[3]];
      if (e[0] === P.arm && e[1] === 13 && freeR) return [e[0], e[1], e[2] - swing, e[3]];
      return e;
    }),
  ];
}

/** 木の部品の並び（2 種） */
export function treeParts(v: TreeId): Entry[] {
  return v === 0
    ? [[P.treeTrunk, 7, 7, 0], [P.treeCanopy, 2, 2, 9], [P.treeTop, 4, 4, 18]]
    : [[P.treeTrunk, 7, 7, 0], [P.treeCanopyS, 3, 3, 8], [P.treeTop, 4, 4, 15]];
}

// ---- 色 ----

/** 文字 → 色（陣営で変わるのは a b d だけ） */
export function colorsFor(team: 0 | 1): Record<string, number> {
  const c = SIDE_COLOR[team];
  return {
    a: c.main,
    b: c.light,
    d: c.dark,
    k: ART.outline,
    h: ART.iron,
    m: ART.metal,
    w: ART.wood,
    p: ART.bronze,
    q: ART.bronzeLo,
    y: ART.hat,
    l: ART.bow,
    r: ART.horse,
    R: ART.horseLo,
    g: ART.gold,
    s: ART.skin,
    G: COLOR.goldHi,
    o: COLOR.goldLo,
    // 地形（木）
    P: TERRAIN.stake,
    L: TERRAIN.leafLo,
    F: TERRAIN.leaf,
    E: TERRAIN.leafHi,
    // 地形（柵・城壁・城門。design §16.2。横木は兵の木の色 w）
    T: TERRAIN.stoneTop,
    t: TERRAIN.stone,
    f: TERRAIN.stoneFace,
    j: TERRAIN.stoneLine,
    K: TERRAIN.gateDark,
    W: TERRAIN.gateWood,
    V: TERRAIN.gateWoodLo,
    I: TERRAIN.gateIron,
    N: TERRAIN.gateStud,
    C: TERRAIN.stakeTop,
  };
}

/** 陣営で色が変わる文字（敵軍の絵は、自軍の絵のこの 3 色を置き換えた写し） */
export const TEAM_CHARS = ['a', 'b', 'd'] as const;

/** 面の明暗：[影の側, 上の面]。どれも同じ一覧の中の色（新しい色は作らない） */
export const SHADE: Readonly<Record<string, readonly [string, string]>> = {
  a: ['d', 'b'],
  b: ['a', 'b'],
  d: ['d', 'd'],
  h: ['h', 'm'],
  m: ['h', 'm'],
  w: ['l', 'w'],
  p: ['q', 'p'],
  q: ['R', 'q'],
  y: ['p', 'y'],
  l: ['R', 'l'],
  r: ['R', 'r'],
  R: ['R', 'R'],
  g: ['o', 'G'],
  s: ['p', 's'],
  k: ['k', 'k'],
  G: ['g', 'G'],
  o: ['o', 'o'],
  P: ['P', 'P'],
  L: ['L', 'L'],
  F: ['L', 'E'],
  E: ['F', 'E'],
  // 地形（柵・城壁・城門。試作の値のまま）
  T: ['t', 'T'],
  t: ['f', 't'],
  f: ['f', 'f'],
  j: ['f', 'j'],
  K: ['K', 'K'],
  W: ['V', 'W'],
  V: ['K', 'V'],
  I: ['I', 'I'],
  N: ['N', 'N'],
  C: ['P', 'C'],
};
