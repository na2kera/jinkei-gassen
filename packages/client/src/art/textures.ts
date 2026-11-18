// 兵と戦場のドット絵。並びを文字で書いたデータから、起動時にテクスチャを作る（design §5.3：画像ファイルを置かない）。
// 兵は真上からの見下ろしで、上が部隊の前。兵種は色ではなく形で見分ける：
//   歩兵＝前に突き出た槍、盾兵＝前一面の盾、弓兵＝前に張った弓と笠、騎兵＝縦に長い馬、本陣＝金の兜の将と護衛。

import type { Kind, Terrain } from '@jinkei/engine';
import type Phaser from 'phaser';
import { ART, COLOR, SIDE_COLOR } from './palette.ts';

/**
 * 文字 → 色。'a' 'b' 'd' は陣営の色（服）、ほかは陣営によらない。'.' は透明。
 * k 輪郭、h 鉄の兜、m 槍の穂先、w 柄、p 盾の表、q 盾の影、y 笠、l 弓、r 馬、R 馬の影、g 金、s 肌
 */
function colorsFor(team: 0 | 1): Record<string, number> {
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
  };
}

/** 兵の形。2コマ（歩くときに交互に出す）。足（いちばん下の行）だけを入れ替えて、わらわら歩いて見せる */
export type SoldierShape = 'infantry' | 'shield' | 'archer' | 'cavalry' | 'guard' | 'general';

const SHAPES: Record<SoldierShape, [string[], string[]]> = {
  // 5×6。右手の長い槍が、頭より前へ2点突き出る（いちばん下の行は足で、左右の端を空けて半径に収める）
  infantry: [
    ['...m.', '...m.', '.hhw.', 'ahhwa', 'daaad', '.d...'],
    ['...m.', '...m.', '.hhw.', 'ahhwa', 'daaad', '...d.'],
  ],
  // 5×5。前一面が盾（青銅）。前列が並ぶと壁に見える
  shield: [
    ['ppppp', 'qhhhq', 'ahhha', 'daaad', 'd..d.'],
    ['ppppp', 'qhhhq', 'ahhha', 'daaad', '.d..d'],
  ],
  // 5×5。前に弓を張り、鉄の兜ではなく笠をかぶる
  archer: [
    ['.lll.', 'l.m.l', 'ayyya', 'daaad', 'd..d.'],
    ['.lll.', 'l.m.l', 'ayyya', 'daaad', '.d..d'],
  ],
  // 5×8。馬に乗る。歩兵よりひと回り大きく、馬の茶色が目立つ
  cavalry: [
    ['..Rm.', '.rrw.', '.rrw.', 'rahar', 'raaar', '.rrr.', 'R.r.R', '..R..'],
    ['..Rm.', '.rrw.', '.rrw.', 'rahar', 'raaar', '.rrr.', '.RrR.', '..R..'],
  ],
  // 5×5。本陣の護衛。兜が金
  guard: [
    ['...m.', '.ggw.', 'aggwa', 'daaad', 'd..d.'],
    ['...m.', '.ggw.', 'aggwa', 'daaad', '.d..d'],
  ],
  // 7×7。将。金の兜飾りと鎧
  general: [
    ['..g.g..', '.ggggg.', 'aagkgaa', 'aaagaaa', 'daaaaad', '.ddddd.', '.d...d.'],
    ['..g.g..', '.ggggg.', 'aagkgaa', 'aaagaaa', 'daaaaad', '.ddddd.', '..d.d..'],
  ],
};

/** 4方向（0: 上、1: 右、2: 下、3: 左）。兵の絵は回さず、向きごとに作っておく（回すとドットが崩れるため） */
export type Dir4 = 0 | 1 | 2 | 3;

/** team は 0 が見ている人の自軍、1 が敵軍（palette の SIDE_COLOR と同じ） */
export function soldierKey(team: 0 | 1, shape: SoldierShape, dir: Dir4, frame: 0 | 1): string {
  return `soldier-${team}-${shape}-${dir}-${frame}`;
}

/** 兵種ごとの兵の形 */
export function shapeOf(kind: Kind): SoldierShape {
  return kind === 'hq' ? 'guard' : kind;
}

/** 並びを時計回りに dir × 90° 回す */
export function rotateRows(rows: string[], dir: Dir4): string[] {
  let r = rows;
  for (let i = 0; i < dir; i++) {
    const h = r.length;
    const w = r[0]?.length ?? 0;
    const next: string[] = [];
    for (let x = 0; x < w; x++) {
      let line = '';
      for (let y = h - 1; y >= 0; y--) line += r[y]?.[x] ?? '.';
      next.push(line);
    }
    r = next;
  }
  return r;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** 文字の並びを canvas に塗る */
export function paintRows(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  colors: Record<string, number>,
  ox = 0,
  oy = 0,
): void {
  rows.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const c = colors[line[x]!];
      if (c === undefined) continue;
      ctx.fillStyle = hex(c);
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

/** 文字の並びを Graphics に塗る（小さな印用。1文字 = 1px） */
export function drawRows(
  g: Phaser.GameObjects.Graphics,
  rows: readonly string[],
  x: number,
  y: number,
  colors: Record<string, number>,
): void {
  rows.forEach((line, ry) => {
    for (let rx = 0; rx < line.length; rx++) {
      const c = colors[line[rx]!];
      if (c === undefined) continue;
      g.fillStyle(c, 1);
      g.fillRect(x + rx, y + ry, 1, 1);
    }
  });
}

export function soldierSize(shape: SoldierShape, dir: Dir4): { w: number; h: number } {
  const rows = SHAPES[shape][0];
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  return dir % 2 === 0 ? { w, h } : { w: h, h: w };
}

/** 兵の絵の、中心からいちばん遠い塗った点までの距離（部隊が半径 10px に収まるかを確かめるため） */
export function soldierReach(shape: SoldierShape): number {
  let best = 0;
  for (const rows of SHAPES[shape]) {
    const h = rows.length;
    const w = rows[0]?.length ?? 0;
    rows.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) {
        if (line[x] === '.') continue;
        // 点の外側の角までの距離
        const dx = Math.max(Math.abs(x - w / 2), Math.abs(x + 1 - w / 2));
        const dy = Math.max(Math.abs(y - h / 2), Math.abs(y + 1 - h / 2));
        best = Math.max(best, Math.hypot(dx, dy));
      }
    });
  }
  return best;
}

// ---- 戦場のタイル（24 × 24） ----

export const TILE = 24;

/** 平地は4通りの模様を混ぜて、単調に見えないようにする */
export const PLAIN_VARIANTS = 4;

export function tileKey(terrain: Terrain, variant = 0): string {
  return terrain === 'plain' ? `tile-plain-${variant}` : `tile-${terrain}`;
}

/** 決まった種から 0〜1 を返す（タイルの模様を毎回同じにするため。ゲームの乱数とは別） */
function hash(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

function fill(ctx: CanvasRenderingContext2D, color: number, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = hex(color);
  ctx.fillRect(x, y, w, h);
}

/** 草地。2px 単位の草むらを散らす */
function paintGrass(ctx: CanvasRenderingContext2D, seed: number): void {
  fill(ctx, COLOR.grass1, 0, 0, TILE, TILE);
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(hash(seed * 31 + i) * 11) * 2;
    const y = Math.floor(hash(seed * 57 + i * 7) * 11) * 2;
    const dark = hash(seed * 13 + i * 3) < 0.6;
    fill(ctx, dark ? COLOR.grass2 : COLOR.grass3, x, y, 2, 2);
    if (dark) fill(ctx, COLOR.grass2, x + 2, y, 2, 2);
  }
}

function paintTerrain(ctx: CanvasRenderingContext2D, terrain: Terrain, variant: number): void {
  switch (terrain) {
    case 'plain':
      paintGrass(ctx, variant + 1);
      return;
    case 'hill': {
      // 丘：明るい草に、等高線の段
      // 草地との違いが小さな絵でも分かるよう、明るい黄緑にしている
      fill(ctx, 0x7d9a40, 0, 0, TILE, TILE);
      for (const [y, x0, x1] of [
        [4, 6, 18],
        [10, 2, 22],
        [16, 0, 24],
      ] as const) {
        fill(ctx, 0x9cb456, x0, y, x1 - x0, 2);
        fill(ctx, 0x5a7430, x0, y + 2, x1 - x0, 2);
      }
      return;
    }
    case 'forest': {
      // 森：草地に木の冠を3つ
      paintGrass(ctx, 9);
      for (const [cx, cy] of [
        [6, 6],
        [17, 9],
        [9, 17],
      ] as const) {
        // 木の冠は草地より暗いが、上に立つ部隊（藍・朱）が沈まない明るさにしている
        fill(ctx, 0x2a4418, cx - 4, cy - 2, 10, 8);
        fill(ctx, 0x3a5a22, cx - 4, cy - 4, 8, 8);
        fill(ctx, 0x3a5a22, cx - 2, cy - 6, 4, 2);
        fill(ctx, 0x4e7430, cx - 2, cy - 4, 4, 2);
      }
      return;
    }
    case 'river': {
      // 川：水面に短い波。藍の部隊と色が近づかないよう、明るい青緑にしている
      fill(ctx, 0x4a92ac, 0, 0, TILE, TILE);
      for (const [x, y] of [
        [2, 4],
        [14, 8],
        [6, 14],
        [16, 18],
      ] as const) {
        fill(ctx, 0x9ccfdc, x, y, 4, 2);
      }
      return;
    }
    case 'fence': {
      // 柵：草地に、横木と杭
      paintGrass(ctx, 5);
      fill(ctx, 0x3a2a14, 0, 12, TILE, 4);
      fill(ctx, ART.wood, 0, 10, TILE, 2);
      for (const x of [2, 12, 20]) {
        fill(ctx, 0x3a2a14, x, 6, 2, 12);
        fill(ctx, 0xb07a3a, x, 6, 2, 2);
      }
      return;
    }
    case 'wall': {
      // 城壁：石積み
      fill(ctx, 0x4a4640, 0, 0, TILE, TILE);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 === 0 ? 0 : 6;
        for (let col = -1; col < 3; col++) {
          const x = col * 12 + off;
          fill(ctx, 0x77736a, x + 2, row * 6 + 2, 8, 2);
          fill(ctx, 0x6a6660, x + 2, row * 6 + 4, 8, 2);
        }
      }
      return;
    }
  }
}

const TERRAINS: readonly Terrain[] = ['plain', 'hill', 'forest', 'river', 'fence', 'wall'];

function makeCanvasTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  paint(tex.getContext());
  tex.refresh();
}

export function buildTextures(scene: Phaser.Scene): void {
  for (const team of [0, 1] as const) {
    const colors = colorsFor(team);
    for (const shape of Object.keys(SHAPES) as SoldierShape[]) {
      for (const dir of [0, 1, 2, 3] as const) {
        for (const frame of [0, 1] as const) {
          const rows = rotateRows(SHAPES[shape][frame], dir);
          const w = rows[0]?.length ?? 0;
          makeCanvasTexture(scene, soldierKey(team, shape, dir, frame), w, rows.length, (ctx) => paintRows(ctx, rows, colors));
        }
      }
    }
  }
  for (const t of TERRAINS) {
    const n = t === 'plain' ? PLAIN_VARIANTS : 1;
    for (let v = 0; v < n; v++) makeCanvasTexture(scene, tileKey(t, v), TILE, TILE, (ctx) => paintTerrain(ctx, t, v));
  }
  buildStage4Textures(scene);
  buildStage5Textures(scene);
  buildSideTextures(scene);
}

/** 地形のタイルの見本を返す（段階4の確かめ用。開発用の口から使う） */
export function terrainList(): readonly Terrain[] {
  return TERRAINS;
}

// ---- 段階4の絵：瓦礫・岩壁・霧・門 ----

export const RUBBLE_KEY = 'tile-rubble';
export const ROCK_KEY = 'tile-rock';
export const FOG_KEY = 'tile-fog';
/** 門の絵（壊れ具合で3段階。0 が無傷） */
export function gateKey(stage: 0 | 1 | 2): string {
  return `gate-${stage}`;
}

/** 崩れた城壁（通れる）：土の地に、石のかけら。平地とは違う絵にして、門が破れた所だと分かるようにする */
function paintRubble(ctx: CanvasRenderingContext2D): void {
  fill(ctx, 0x6e6450, 0, 0, TILE, TILE);
  for (const [x, y, w] of [
    [2, 4, 6],
    [12, 2, 4],
    [16, 10, 6],
    [4, 14, 4],
    [10, 18, 6],
    [18, 18, 4],
  ] as const) {
    fill(ctx, 0x77736a, x, y, w, 2);
    fill(ctx, 0x4a4640, x, y + 2, w, 2);
  }
}

/** 岩壁（戦場の幅が狭い面で、戦場の外側に置く）：暗い岩の段 */
function paintRock(ctx: CanvasRenderingContext2D, seed: number): void {
  fill(ctx, 0x3a3428, 0, 0, TILE, TILE);
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(hash(seed * 17 + i) * 9) * 2;
    const y = Math.floor(hash(seed * 29 + i * 5) * 10) * 2;
    fill(ctx, 0x4e4636, x, y, 6, 2);
    fill(ctx, 0x2a251c, x, y + 2, 6, 2);
  }
}

/** 霧：灰色の点を市松に近い形で散らす（下の草地が少し透けて見え、「何かいるかもしれない」と分かる） */
function paintFog(ctx: CanvasRenderingContext2D): void {
  for (let y = 0; y < TILE; y += 2) {
    for (let x = 0; x < TILE; x += 2) {
      if (((x + y) / 2) % 2 === 0 || (x * 7 + y * 3) % 10 === 0) fill(ctx, 0xc8c8c0, x, y, 2, 2);
    }
  }
}

/** 門：木の扉に鉄の帯。壊れ具合 1 でひびと欠け、2 で大きく割れて傾く */
function paintGate(ctx: CanvasRenderingContext2D, stage: 0 | 1 | 2): void {
  fill(ctx, 0x2a1c0e, 0, 2, TILE, 22);
  fill(ctx, 0x8a5a2a, 2, 4, 20, 18);
  fill(ctx, 0x6e4620, 11, 4, 2, 18);
  for (const y of [6, 12, 18]) fill(ctx, 0x45464e, 2, y, 20, 2);
  for (const x of [4, 18]) for (const y of [6, 12, 18]) fill(ctx, 0xdcdcd2, x, y, 2, 2);
  if (stage >= 1) {
    // ひびと欠け（小さな絵でも分かるよう、板が1枚抜け、角が欠ける）
    fill(ctx, 0x2a1c0e, 4, 8, 6, 4);
    fill(ctx, 0x2a1c0e, 6, 12, 2, 4);
    fill(ctx, 0x2a1c0e, 14, 14, 6, 4);
    fill(ctx, 0x2a1c0e, 18, 4, 4, 2);
    fill(ctx, 0x6e6450, 2, 22, 4, 2);
  }
  if (stage >= 2) {
    // 大きく割れて、真ん中が抜けかける
    fill(ctx, 0x2a1c0e, 10, 4, 4, 10);
    fill(ctx, 0x2a1c0e, 8, 14, 8, 2);
    fill(ctx, 0x2a1c0e, 12, 16, 2, 6);
    fill(ctx, 0x6e6450, 2, 20, 6, 2);
    fill(ctx, 0x6e6450, 16, 20, 6, 2);
  }
}

export function buildStage4Textures(scene: Phaser.Scene): void {
  makeCanvasTexture(scene, RUBBLE_KEY, TILE, TILE, paintRubble);
  for (let v = 0; v < 3; v++) makeCanvasTexture(scene, `${ROCK_KEY}-${v}`, TILE, TILE, (ctx) => paintRock(ctx, v + 3));
  makeCanvasTexture(scene, FOG_KEY, TILE, TILE, paintFog);
  for (const s of [0, 1, 2] as const) makeCanvasTexture(scene, gateKey(s), TILE, TILE, (ctx) => paintGate(ctx, s));
}

// ---- 段階5：斜め見下ろしの絵（立った兵と、高さのある地形） ----
// 立った兵は、頭と体と足が見える絵。兵種の手がかりは真上と同じ（槍・盾・弓と笠・馬・金の兜）。
// 向きは S（こちら向き）・N（向こう向き）・W（左向き）を描き、E（右向き）は W を左右に返して作る。
// 歩きの2コマ目は、いちばん下の2行（足）を 1px ずらして作る。

const STAND: Record<SoldierShape, { S: string[]; N: string[]; W: string[] }> = {
  infantry: {
    S: ['......m', '..hh..w', '.hhhh.w', '.hssh.w', 'aaaaaaw', '.aaaa.w', '.aaaa.w', '.dddd.w', '.d..d..', '.k..k..'],
    N: ['m......', 'w..hh..', 'w.hhhh.', 'w.hhhh.', 'waaaaaa', 'w.aaaa.', 'w.aaaa.', 'w.dddd.', '..d..d.', '..k..k.'],
    W: ['.......', '...hh..', '..hhhh.', '..shhh.', 'mwwwaa.', '..aaaa.', '..aaaa.', '..dddd.', '..d..d.', '..k..k.'],
  },
  shield: {
    S: ['.......', '..hh...', '.hhhh..', '.hssh..', 'qpppppq', 'qpppppq', 'qpppppq', '.qpppq.', '.d..d..', '.k..k..'],
    N: ['.......', '...hh..', '..hhhh.', '..hhhh.', 'qaaaaaq', 'qaaaaaq', 'qaaaaaq', '.dddd..', '.d..d..', '.k..k..'],
    W: ['.......', '...hh..', '..hhhh.', '..shhh.', 'pqaaaa.', 'pqaaaa.', 'pqaaaa.', 'pqdddd.', '..d..d.', '..k..k.'],
  },
  archer: {
    S: ['.......', '..yyy..', '.yyyyy.', 'l.sss..', 'laaaaa.', 'l.aaa..', 'l.aaa..', '..ddd..', '..d.d..', '..k.k..'],
    N: ['.......', '..yyy..', '.yyyyy.', '..yyy.l', 'aaaaa.l', '.aaa..l', '.aaa..l', '.ddd...', '.d.d...', '.k.k...'],
    W: ['.......', '...yyy.', '..yyyyy', '.l.sy..', 'l..aaa.', 'l.maaa.', 'l..aaa.', '.l.ddd.', '...d.d.', '...k.k.'],
  },
  cavalry: {
    S: ['...hh....', '..hhhh...', '..hssh...', '.aaaaaa..', 'rraaaarr.', 'r.rRRr.r.', '..rRRr...', '..rRRr...', '..R..R...', '..k..k...'],
    N: ['...hh....', '..hhhh...', '..hhhh...', '.aaaaaa..', 'rraaaarr.', 'rrrrrrrr.', '.rrrrrr..', '.rrRRrr..', '.R....R..', '.k....k..'],
    W: ['....hh...', '...hhhh..', '...shhh..', 'rr.aaaa..', 'Rrraaaarr', '.rrrrrrrr', '.rrrrrrr.', '.R.R..R.R', '.R.R..R.R', '.k.k..k.k'],
  },
  guard: {
    S: ['......m', '..gg..w', '.gggg.w', '.gssg.w', 'aaaaaaw', '.aaaa.w', '.aaaa.w', '.dddd.w', '.d..d..', '.k..k..'],
    N: ['m......', 'w..gg..', 'w.gggg.', 'w.gggg.', 'waaaaaa', 'w.aaaa.', 'w.aaaa.', 'w.dddd.', '..d..d.', '..k..k.'],
    W: ['.......', '...gg..', '..gggg.', '..sggg.', 'mwwwaa.', '..aaaa.', '..aaaa.', '..dddd.', '..d..d.', '..k..k.'],
  },
  general: {
    S: ['...g...', '..ggg..', '.ggggg.', '..sss..', 'aaggaaa', 'aagggaa', 'aaaaaaa', '.aaaaa.', '.ddddd.', '.d...d.', '.k...k.'],
    N: ['...g...', '..ggg..', '.ggggg.', '..ggg..', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '.ddddd.', '.d...d.', '.k...k.'],
    W: ['..g....', '..ggg..', '.ggggg.', '.sgg...', '.aggaaa', '.aaggaa', 'aaaaaaa', 'aaaaaa.', '.ddddd.', '.d...d.', '.k...k.'],
  },
};

/** 立った兵の向き（0: 向こう向き、1: 右向き、2: こちら向き、3: 左向き）。真上の絵の向きと同じ番号 */
export function standKey(team: 0 | 1, shape: SoldierShape, dir: Dir4, frame: 0 | 1): string {
  return `stand-${team}-${shape}-${dir}-${frame}`;
}

function standRows(shape: SoldierShape, dir: Dir4, frame: 0 | 1): string[] {
  const s = STAND[shape];
  let rows = dir === 0 ? s.N : dir === 2 ? s.S : s.W;
  if (dir === 1) rows = rows.map((r) => [...r].reverse().join(''));
  if (frame === 1) {
    // 足（下の2行）を 1px ずらして、歩く2コマ目にする
    const n = rows.length;
    rows = rows.map((r, i) => (i >= n - 2 ? `.${r.slice(0, -1)}` : r));
  }
  return rows;
}

export function standSize(shape: SoldierShape): { w: number; h: number } {
  const rows = STAND[shape].S;
  return { w: rows[0]?.length ?? 0, h: rows.length };
}

/** 高さのある地形と門（斜めのときだけ使う）。下の端が、そのマスの手前の端に来るように置く */
export const TALL_TREE = 'tall-tree';
export const TALL_FENCE = 'tall-fence';
export const TALL_WALL = 'tall-wall';
export function tallGateKey(stage: 0 | 1 | 2): string {
  return `tall-gate-${stage}`;
}

function paintTallTree(ctx: CanvasRenderingContext2D): void {
  // 幹と、丸みのある冠（12 × 16）。森の中の部隊が隠れきらないよう、小さめにしている
  fill(ctx, 0x3a2a14, 5, 10, 2, 6);
  fill(ctx, 0x2a4418, 0, 4, 12, 8);
  fill(ctx, 0x3a5a22, 2, 0, 8, 10);
  fill(ctx, 0x3a5a22, 0, 4, 12, 4);
  fill(ctx, 0x4e7430, 4, 2, 2, 4);
}

function paintTallFence(ctx: CanvasRenderingContext2D): void {
  // 杭3本と横木2本（24 × 12）
  for (const x of [1, 11, 21]) {
    fill(ctx, 0x3a2a14, x, 0, 2, 12);
    fill(ctx, 0xb07a3a, x, 0, 2, 2);
  }
  fill(ctx, ART.wood, 0, 3, TILE, 2);
  fill(ctx, ART.wood, 0, 7, TILE, 2);
}

function paintTallWall(ctx: CanvasRenderingContext2D): void {
  // 上の面（明るい石）と、手前の面（石積み）。24 × 22
  fill(ctx, 0x8a867c, 0, 0, TILE, 8);
  fill(ctx, 0x77736a, 0, 6, TILE, 2);
  fill(ctx, 0x4a4640, 0, 8, TILE, 14);
  for (let row = 0; row < 3; row++) {
    const off = row % 2 === 0 ? 0 : 6;
    for (let col = -1; col < 3; col++) fill(ctx, 0x6a6660, col * 12 + off + 2, 10 + row * 4, 8, 2);
  }
}

function paintTallGate(ctx: CanvasRenderingContext2D, stage: 0 | 1 | 2): void {
  // 門：城壁と同じ高さの扉（24 × 22）
  fill(ctx, 0x2a1c0e, 0, 0, TILE, 22);
  fill(ctx, 0x8a5a2a, 2, 2, 20, 20);
  fill(ctx, 0x6e4620, 11, 2, 2, 20);
  for (const y of [5, 11, 17]) fill(ctx, 0x45464e, 2, y, 20, 2);
  if (stage >= 1) {
    fill(ctx, 0x2a1c0e, 4, 7, 6, 4);
    fill(ctx, 0x2a1c0e, 14, 13, 6, 4);
  }
  if (stage >= 2) {
    fill(ctx, 0x2a1c0e, 10, 2, 4, 12);
    fill(ctx, 0x2a1c0e, 8, 14, 8, 4);
  }
}

export function buildStage5Textures(scene: Phaser.Scene): void {
  for (const team of [0, 1] as const) {
    const colors = colorsFor(team);
    for (const shape of Object.keys(STAND) as SoldierShape[]) {
      for (const dir of [0, 1, 2, 3] as const) {
        for (const frame of [0, 1] as const) {
          const rows = standRows(shape, dir, frame);
          makeCanvasTexture(scene, standKey(team, shape, dir, frame), rows[0]?.length ?? 0, rows.length, (ctx) => paintRows(ctx, rows, colors));
        }
      }
    }
  }
  makeCanvasTexture(scene, TALL_TREE, 12, 16, paintTallTree);
  makeCanvasTexture(scene, TALL_FENCE, TILE, 12, paintTallFence);
  makeCanvasTexture(scene, TALL_WALL, TILE, 22, paintTallWall);
  for (const s of [0, 1, 2] as const) makeCanvasTexture(scene, tallGateKey(s), TILE, 22, (ctx) => paintTallGate(ctx, s));
}

// ---- 横からの視点の絵（design §5.8.4）：柵・城壁・門 ----
// 柵と城壁は、戦場では横（x の向き）に伸びるので、横からでは画面の縦（奥行き）に伸びる。
// 1マスぶんの絵（幅 18px）を、下の端をマスの手前の端に合わせて立て、奥のマスから順に描くと、1本につながって見える。
// 絵の上の 15 行が、高さぶん持ち上がった上の面、その下が手前に見える面（小口）。手前のマスの上の面が、奥のマスの小口を隠す。
// マスの縦は丸めで 14px と 15px が交じるので、上の面は 15 行にして、隙間を出さない。

export const SIDE_FENCE = 'side-fence';
export const SIDE_WALL = 'side-wall';
export function sideGateKey(stage: 0 | 1 | 2): string {
  return `side-gate-${stage}`;
}

/** 横から用の絵の色。T・t 城壁の上の面、f・j 城壁の手前の面、K・W・V・I・N 門、P・C・w 柵（どれも斜めの絵と同じ色） */
const SIDE_COLORS: Record<string, number> = {
  T: 0x8a867c,
  t: 0x77736a,
  f: 0x4a4640,
  j: 0x6a6660,
  K: 0x2a1c0e,
  W: 0x8a5a2a,
  V: 0x6e4620,
  I: 0x45464e,
  N: 0xdcdcd2,
  P: 0x3a2a14,
  C: 0xb07a3a,
  w: ART.wood,
};

/** 柵（18 × 18）：奥へ伸びる横木と、杭が1本。下の 3 行は空けて、柵の高さぶん持ち上げる */
const SIDE_FENCE_ROWS = [
  '........ww........',
  '........ww........',
  '........ww........',
  '.......CCCC.......',
  '.......PPPP.......',
  '.......PPPP.......',
  '.......PPPP.......',
  '.......PPPP.......',
  '.......PPPP.......',
  '.......PPPP.......',
  '.......PPPP.......',
  '........ww........',
  '........ww........',
  '........ww........',
  '........ww........',
  '..................',
  '..................',
  '..................',
];

/** 城壁（18 × 24）：上の面（明るい石、15 行）と、手前の面（石積み、9 行） */
const SIDE_WALL_ROWS = [
  'tTTTTTTTTTTTTTTTTt',
  'tTTTTTTTtTTTTTTTTt',
  'tTTTTTTTtTTTTTTTTt',
  'tTTTTTTTtTTTTTTTTt',
  'tttttttttttttttttt',
  'tTTTtTTTTTTTTtTTTt',
  'tTTTtTTTTTTTTtTTTt',
  'tTTTtTTTTTTTTtTTTt',
  'tTTTtTTTTTTTTtTTTt',
  'tttttttttttttttttt',
  'tTTTTTTTtTTTTTTTTt',
  'tTTTTTTTtTTTTTTTTt',
  'tTTTTTTTtTTTTTTTTt',
  'tTTTTTTTtTTTTTTTTt',
  'tttttttttttttttttt',
  'ffffffffffffffffff',
  'fjjjjjjjffjjjjjjjf',
  'ffffffffffffffffff',
  'ffffffffffffffffff',
  'jjjjffjjjjjjjffjjj',
  'ffffffffffffffffff',
  'ffffffffffffffffff',
  'fjjjjjjjffjjjjjjjf',
  'ffffffffffffffffff',
];

/** 門（18 × 24）：上の面は木の扉に鉄の帯（15 行）、手前の面は木の小口（9 行） */
const SIDE_GATE_ROWS = [
  'KKKKKKKKKKKKKKKKKK',
  'KWWWWWWWVWWWWWWWWK',
  'KWWWWWWWVWWWWWWWWK',
  'KINIIIIIIIIIIIINIK',
  'KWWWWWWWVWWWWWWWWK',
  'KWWWWWWWVWWWWWWWWK',
  'KWWWWWWWVWWWWWWWWK',
  'KINIIIIIIIIIIIINIK',
  'KWWWWWWWVWWWWWWWWK',
  'KWWWWWWWVWWWWWWWWK',
  'KWWWWWWWVWWWWWWWWK',
  'KINIIIIIIIIIIIINIK',
  'KWWWWWWWVWWWWWWWWK',
  'KWWWWWWWVWWWWWWWWK',
  'KKKKKKKKKKKKKKKKKK',
  'KVVVVVVVVVVVVVVVVK',
  'KVVVVVVVVVVVVVVVVK',
  'KVVVVVVVVVVVVVVVVK',
  'KVVVVVVVVVVVVVVVVK',
  'KVVVVVVVVVVVVVVVVK',
  'KVVVVVVVVVVVVVVVVK',
  'KVVVVVVVVVVVVVVVVK',
  'KVVVVVVVVVVVVVVVVK',
  'KKKKKKKKKKKKKKKKKK',
];

/** 門の壊れ具合で抜ける所（[x, y, 幅, 高さ]）。1 で板が抜けて角が欠け、2 で真ん中が大きく割れる */
const SIDE_GATE_HOLES: Record<1 | 2, readonly (readonly [number, number, number, number])[]> = {
  1: [
    [3, 4, 4, 3],
    [11, 8, 4, 2],
    [14, 1, 3, 1],
  ],
  2: [
    [7, 1, 3, 8],
    [5, 9, 8, 2],
    [8, 11, 2, 3],
  ],
};

/** 文字の並びの、矩形の所を ch で塗りかえる */
function carveRows(rows: readonly string[], holes: readonly (readonly [number, number, number, number])[], ch: string): string[] {
  const out = rows.map((r) => [...r]);
  for (const [x, y, w, h] of holes) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (out[j]?.[i] !== undefined) out[j]![i] = ch;
  }
  return out.map((r) => r.join(''));
}

/** 横から用の門の並び（壊れ具合ごと） */
function sideGateRows(stage: 0 | 1 | 2): string[] {
  let rows = [...SIDE_GATE_ROWS];
  if (stage >= 1) rows = carveRows(rows, SIDE_GATE_HOLES[1], 'K');
  if (stage >= 2) rows = carveRows(rows, SIDE_GATE_HOLES[2], 'K');
  return rows;
}

/** 横から用の絵の並び（確かめ用。どれも矩形で、知らない文字がないか） */
export function sideArtRows(): Record<string, readonly string[]> {
  return {
    [SIDE_FENCE]: SIDE_FENCE_ROWS,
    [SIDE_WALL]: SIDE_WALL_ROWS,
    [sideGateKey(0)]: sideGateRows(0),
    [sideGateKey(1)]: sideGateRows(1),
    [sideGateKey(2)]: sideGateRows(2),
  };
}

/** 横から用の絵の文字 → 色（確かめ用） */
export function sideArtColors(): Readonly<Record<string, number>> {
  return SIDE_COLORS;
}

export function buildSideTextures(scene: Phaser.Scene): void {
  for (const [key, rows] of Object.entries(sideArtRows())) {
    makeCanvasTexture(scene, key, rows[0]?.length ?? 0, rows.length, (ctx) => paintRows(ctx, rows, SIDE_COLORS));
  }
}
