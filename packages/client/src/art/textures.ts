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
      fill(ctx, 0x6f8a3a, 0, 0, TILE, TILE);
      for (const [y, x0, x1] of [
        [4, 6, 18],
        [10, 2, 22],
        [16, 0, 24],
      ] as const) {
        fill(ctx, 0x86a046, x0, y, x1 - x0, 2);
        fill(ctx, 0x56702c, x0, y + 2, x1 - x0, 2);
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
        fill(ctx, 0x1e3212, cx - 4, cy - 2, 10, 8);
        fill(ctx, 0x2f4a1e, cx - 4, cy - 4, 8, 8);
        fill(ctx, 0x2f4a1e, cx - 2, cy - 6, 4, 2);
        fill(ctx, 0x3f6026, cx - 2, cy - 4, 4, 2);
      }
      return;
    }
    case 'river': {
      // 川：水面に短い波
      fill(ctx, 0x2f5f8a, 0, 0, TILE, TILE);
      for (const [x, y] of [
        [2, 4],
        [14, 8],
        [6, 14],
        [16, 18],
      ] as const) {
        fill(ctx, 0x5f8fba, x, y, 4, 2);
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
}

/** 地形のタイルの見本を返す（段階4の確かめ用。開発用の口から使う） */
export function terrainList(): readonly Terrain[] {
  return TERRAINS;
}
