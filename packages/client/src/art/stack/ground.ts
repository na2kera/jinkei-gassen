// 立体の画面の地面（design §14.7）：下地（市松の草地・川・森の点・柵や城壁のタイル）と丘の層、森の木、門の描き直し、霧の入れ物。
// 地面は盤と同じ大きさの絵を、盤と一緒に回して縦をつぶして置く（入れ物を 2 つ重ね、外側に位置と拡大、内側に回転）。
// 地面の絵はシーンが終わるとき・作り直すときに捨てる（destroy でテクスチャごと消す）。試作（proto17v2/main.js）の paintBase・buildGround を写した。

import type { Field } from '@jinkei/engine';
import Phaser from 'phaser';
import { BOARD_CELL, type BoardView } from '../../battle/BoardView.ts';
import { COLOR, TERRAIN, css } from '../palette.ts';
import { FOG_KEY, gateKey, RUBBLE_KEY, tileKey } from '../textures.ts';
import { abgr, ANGLES } from './bake.ts';
import { HILL_MAX } from './height.ts';
import { treeFrameName, TREE_SCALES } from './jobs.ts';
import { stackTextures } from './stackTextures.ts';
import type { TreeId } from './parts.ts';

/** 決まった乱数（試作と同じ） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 門の様子 */
export interface GateLook {
  col: number;
  row: number;
}

let serial = 0;

/** いま作ってある地面の絵の、画素 1 枚ぶんの量の合計（バイト。開発用の口に出す） */
export const groundStats = { bytes: 0 };

interface Layer {
  z: number;
  outer: Phaser.GameObjects.Container;
  inner: Phaser.GameObjects.Container;
}

/** 地面（下地と丘の層）と霧の入れ物 */
export class Ground {
  private readonly scene: Phaser.Scene;
  private readonly bv: BoardView;
  private readonly field: Field;
  private readonly layers: Layer[] = [];
  private readonly keys: string[] = [];
  private readonly baseKey: string;
  private readonly fogOuter: Phaser.GameObjects.Container;
  private readonly fogInner: Phaser.GameObjects.Container;
  private readonly gate: GateLook | null;
  private gateStage: 0 | 1 | 2 = 0;
  private gateBroken = false;
  /** 画素 1 枚ぶんの量の合計（バイト。開発用の口に出す） */
  readonly bytes: number;

  constructor(scene: Phaser.Scene, bv: BoardView, field: Field, groundLayer: Phaser.GameObjects.Container, fogLayer: Phaser.GameObjects.Container, gate: GateLook | null = null) {
    this.scene = scene;
    this.bv = bv;
    this.field = field;
    this.gate = gate;
    const w = field.width * BOARD_CELL;
    const h = field.height * BOARD_CELL;
    const id = serial++;
    // 下地（Canvas。門の描き直しで書き直す）
    this.baseKey = `ground-${id}-0`;
    const tex = scene.textures.createCanvas(this.baseKey, w, h)!;
    this.keys.push(this.baseKey);
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    this.paintBase(ctx);
    let bytes = w * h * 4;
    const hm = bv.hm;
    if (hm) {
      // 丘の面の色（傾きの向きで明暗。光は左上から）。高さ 0.6 以上の点だけ
      const img = ctx.getImageData(0, 0, w, h);
      const base = new Uint32Array(img.data.buffer);
      const d = hm.data;
      const hi = abgr(TERRAIN.hillHi);
      const mid = abgr(TERRAIN.hill);
      const lo = abgr(TERRAIN.hillLo);
      let x0 = w;
      let y0 = h;
      let x1 = -1;
      let y1 = -1;
      for (let py = 0; py < h; py++)
        for (let px = 0; px < w; px++) {
          const i = py * w + px;
          if (d[i]! < 0.6) continue;
          const gx = (d[py * w + Math.min(w - 1, px + 1)]! - d[py * w + Math.max(0, px - 1)]!) / 2;
          const gy = (d[Math.min(h - 1, py + 1) * w + px]! - d[Math.max(0, py - 1) * w + px]!) / 2;
          const s = (gx + gy) / Math.SQRT2;
          base[i] = s < -0.12 ? hi : s > 0.12 ? lo : mid;
          if (d[i]! >= 1) {
            x0 = Math.min(x0, px);
            y0 = Math.min(y0, py);
            x1 = Math.max(x1, px);
            y1 = Math.max(y1, py);
          }
        }
      ctx.putImageData(img, 0, 0);
      // 1 番目から上の層は、丘のある所を囲む矩形（8px の余白つき）だけの大きさで作る
      if (x1 >= 0) {
        x0 = Math.max(0, x0 - 8);
        y0 = Math.max(0, y0 - 8);
        x1 = Math.min(w - 1, x1 + 8);
        y1 = Math.min(h - 1, y1 + 8);
        const cw = x1 - x0 + 1;
        const ch = y1 - y0 + 1;
        const nz = Math.ceil(HILL_MAX);
        for (let z = 1; z <= nz; z++) {
          const key = `ground-${id}-${z}`;
          const lt = scene.textures.createCanvas(key, cw, ch)!;
          const lctx = lt.getContext();
          const li = lctx.createImageData(cw, ch);
          const lb = new Uint32Array(li.data.buffer);
          let any = false;
          for (let py = 0; py < ch; py++)
            for (let px = 0; px < cw; px++) {
              const i = (py + y0) * w + px + x0;
              if (d[i]! < z) continue;
              // 上の層に隠れる所は、段の縁（丘の暗い色）
              lb[py * cw + px] = d[i]! >= z + 1 ? lo : base[i]!;
              any = true;
            }
          if (!any) {
            scene.textures.remove(key);
            continue;
          }
          lctx.putImageData(li, 0, 0);
          lt.refresh();
          this.keys.push(key);
          bytes += cw * ch * 4;
          this.addLayer(z, key, x0 - w / 2, y0 - h / 2, groundLayer);
        }
      }
    }
    tex.refresh();
    // 下地は 0 層目（いちばん下）
    this.addLayer(0, this.baseKey, -w / 2, -h / 2, groundLayer, true);
    this.bytes = bytes;
    groundStats.bytes += bytes;
    // 霧の入れ物（地面と同じ変換。兵の層の上に置く）
    this.fogOuter = scene.add.container(0, 0);
    this.fogInner = scene.add.container(0, 0);
    this.fogOuter.add(this.fogInner);
    fogLayer.add(this.fogOuter);
    this.update();
  }

  private addLayer(z: number, key: string, x: number, y: number, parent: Phaser.GameObjects.Container, bottom = false): void {
    const outer = this.scene.add.container(0, 0);
    const inner = this.scene.add.container(0, 0);
    outer.add(inner);
    inner.add(this.scene.add.image(x, y, key).setOrigin(0, 0));
    if (bottom) parent.addAt(outer, 0);
    else parent.add(outer);
    this.layers.push({ z, outer, inner });
  }

  /** カメラが変わったら呼ぶ（位置・縮み・つぶし・回転） */
  update(): void {
    const { k } = this.bv.cam;
    const c = this.bv.center;
    const rot = this.bv.groundRotation;
    for (const L of this.layers) {
      L.outer.setPosition(c.x, c.y - L.z * k).setScale(k, k * 0.75);
      L.inner.setRotation(rot);
    }
    this.fogOuter.setPosition(c.x, c.y).setScale(k, k * 0.75);
    this.fogInner.setRotation(rot);
  }

  /** 霧のマスの絵を置く（盤の px の位置に 32 × 32）。戻り値は置いた絵（晴れる演出で消す） */
  addFog(cells: readonly { col: number; row: number }[]): Phaser.GameObjects.Image[] {
    const w = this.field.width * BOARD_CELL;
    const h = this.field.height * BOARD_CELL;
    return cells.map((c) => {
      const img = this.scene.add.image(c.col * BOARD_CELL - w / 2, c.row * BOARD_CELL - h / 2, FOG_KEY).setOrigin(0, 0).setDisplaySize(BOARD_CELL, BOARD_CELL);
      this.fogInner.add(img);
      return img;
    });
  }

  /** 門の様子（傷み具合の段と、破れたか）。門のマスと両隣の城壁のマスだけを描き直す。戻り値は描き直したマス */
  setGate(stage: 0 | 1 | 2, broken: boolean): { col: number; row: number }[] {
    const g = this.gate;
    if (!g || (stage === this.gateStage && broken === this.gateBroken)) return [];
    this.gateStage = stage;
    this.gateBroken = broken;
    const tex = this.scene.textures.get(this.baseKey) as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    const cells: { col: number; row: number }[] = [];
    for (const c of [g.col - 1, g.col, g.col + 1]) {
      if (c < 0 || c >= this.field.width) continue;
      const t = this.field.terrain[g.row * this.field.width + c];
      // 門のマスと、両隣のうち城壁のマスだけ（field は開戦時のものなので、崩れる前の城壁が入っている）
      if (c !== g.col && t !== 'wall') continue;
      const key = broken ? RUBBLE_KEY : c === g.col ? gateKey(stage) : tileKey('wall');
      this.drawTile(ctx, key, c, g.row);
      cells.push({ col: c, row: g.row });
    }
    tex.refresh();
    return cells;
  }

  private drawTile(ctx: CanvasRenderingContext2D, key: string, col: number, row: number): void {
    if (!this.scene.textures.exists(key)) return;
    const src = this.scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
    ctx.drawImage(src, col * BOARD_CELL, row * BOARD_CELL, BOARD_CELL, BOARD_CELL);
  }

  /** 平地・川・森の地面・柵や城壁や門のタイル・外枠（試作の paintBase と同じ。点の位置は決まった乱数（種 7）） */
  private paintBase(ctx: CanvasRenderingContext2D): void {
    const f = this.field;
    const C = BOARD_CELL;
    const w = f.width * C;
    const h = f.height * C;
    const fill = (c: number, x: number, y: number, ww: number, hh: number): void => {
      ctx.fillStyle = css(c);
      ctx.fillRect(x, y, ww, hh);
    };
    const T = (c: number, r: number): string | undefined => (r >= 0 && r < f.height && c >= 0 && c < f.width ? f.terrain[r * f.width + c] : undefined);
    const R = rng(7);
    for (let r = 0; r < f.height; r++)
      for (let c = 0; c < f.width; c++) {
        const x = c * C;
        const y = r * C;
        const t = T(c, r);
        if (t === 'river') {
          fill(TERRAIN.water, x, y, C, C);
          for (let i = 0; i < 5; i++) fill(TERRAIN.waterHi, x + 2 + Math.floor((R() * (C - 8)) / 2) * 2, y + 2 + Math.floor((R() * (C - 6)) / 2) * 2, 4, 2);
          continue;
        }
        fill((r + c) % 2 ? COLOR.grass2 : COLOR.grass1, x, y, C, C);
        const sp = (C - 6) / 2;
        for (let i = 0; i < 4; i++) fill(COLOR.grass3, x + 2 + Math.floor(R() * sp) * 2, y + 2 + Math.floor(R() * sp) * 2, 2, 2);
        if (t === 'forest') for (let i = 0; i < 6; i++) fill(TERRAIN.leafLo, x + 2 + Math.floor(R() * sp) * 2, y + 2 + Math.floor(R() * sp) * 2, 4, 2);
      }
    // 川の岸：川と陸の境に 2px の暗い縁
    for (let r = 0; r < f.height; r++)
      for (let c = 0; c < f.width; c++) {
        if (T(c, r) !== 'river') continue;
        const x = c * C;
        const y = r * C;
        const land = (cc: number, rr: number): boolean => T(cc, rr) !== undefined && T(cc, rr) !== 'river';
        if (land(c, r - 1)) fill(TERRAIN.hillLo, x, y, C, 2);
        if (land(c, r + 1)) fill(TERRAIN.hillLo, x, y + C - 2, C, 2);
        if (land(c - 1, r)) fill(TERRAIN.hillLo, x, y, 2, C);
        if (land(c + 1, r)) fill(TERRAIN.hillLo, x + C - 2, y, 2, C);
      }
    // 柵・城壁（あとに回すもの）：いまの 32px のタイルを、地面にそのまま描く
    for (let r = 0; r < f.height; r++)
      for (let c = 0; c < f.width; c++) {
        const t = T(c, r);
        if (t === 'fence' || t === 'wall') this.drawTile(ctx, tileKey(t), c, r);
      }
    if (this.gate) this.drawTile(ctx, gateKey(0), this.gate.col, this.gate.row);
    // 盤のまわりに、輪郭の色の線を 2px
    fill(COLOR.outline, 0, 0, w, 2);
    fill(COLOR.outline, 0, h - 2, w, 2);
    fill(COLOR.outline, 0, 0, 2, h);
    fill(COLOR.outline, w - 2, 0, 2, h);
  }

  destroy(): void {
    if (this.layers.length > 0) groundStats.bytes -= this.bytes;
    for (const L of this.layers) L.outer.destroy();
    this.layers.length = 0;
    this.fogOuter.destroy();
    for (const k of this.keys) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
  }
}

// ---- 森の木 ----

/** 木の位置（マスのまん中から。盤の px。試作の値 × 32/36 を丸めたもの）と種 */
const TREE_SPOTS: readonly (readonly [number, number, TreeId])[] = [
  [-11, -11, 0],
  [11, -9, 1],
  [-10, 10, 1],
  [12, 11, 0],
];

interface Tree {
  x: number;
  y: number;
  tree: TreeId;
  orient: number;
  img: Phaser.GameObjects.Image;
  key: string;
}

/**
 * 森のマスに木を 3 本（四すみ寄りの 4 か所から、決まった乱数で 1 か所を抜く）。兵の層に入れ、depth の順に重ねる。
 * 木は地形なので盤と同じ縮みで描く：止まった縮みで焼いた揃いがあれば使い、なければ大きさ 1 の揃いを k 倍
 */
export class Forest {
  private readonly bv: BoardView;
  private readonly trees: Tree[] = [];

  constructor(scene: Phaser.Scene, bv: BoardView, field: Field, layer: Phaser.GameObjects.Container) {
    this.bv = bv;
    for (let r = 0; r < field.height; r++)
      for (let c = 0; c < field.width; c++) {
        if (field.terrain[r * field.width + c] !== 'forest') continue;
        const R = rng(c * 31 + r * 7);
        const skip = Math.floor(R() * 4);
        TREE_SPOTS.forEach(([du, dv, tree], i) => {
          if (i === skip) return;
          const img = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
          layer.add(img);
          this.trees.push({ x: c + 0.5 + du / BOARD_CELL, y: r + 0.5 + dv / BOARD_CELL, tree, orient: Math.floor(R() * ANGLES), img, key: '' });
        });
      }
    this.update();
  }

  get count(): number {
    return this.trees.length;
  }

  /** カメラが変わったとき・絵が届いたときに呼ぶ */
  update(): void {
    if (this.trees.length === 0) return;
    const k = this.bv.cam.k;
    // 止まった縮みで焼いた揃いがあれば、それを伸び縮みさせずに使う
    let scale = 1;
    let display = k;
    for (const s of TREE_SCALES) {
      if (Math.abs(k - s) < 0.006 && stackTextures.tree(s, 0, 0)) {
        scale = s;
        display = k / s;
        break;
      }
    }
    const up = this.bv.angleIndex(0, -1);
    for (const t of this.trees) {
      const a = (t.orient + up) % ANGLES;
      const ref = stackTextures.tree(scale, t.tree, a);
      if (!ref) {
        t.img.setVisible(false);
        continue;
      }
      // 取り込み直した絵（同じ鍵の新しいテクスチャ）にも切り替わるよう、取り込んだ時刻も見る
      const key = `${ref.key}|${ref.frame}|${ref.sheet.readyAt}`;
      if (key !== t.key) {
        t.img.setTexture(ref.key, treeFrameName(t.tree, a)).setOrigin(ref.sheet.g.ax / ref.sheet.g.fw, ref.sheet.g.ay / ref.sheet.g.fh);
        t.key = key;
      }
      const p = this.bv.project(t.x, t.y, this.bv.ground(t.x, t.y));
      t.img.setVisible(true).setPosition(Math.round(p.x), Math.round(p.y)).setScale(display).setDepth(p.depth);
    }
  }

  destroy(): void {
    for (const t of this.trees) t.img.destroy();
    this.trees.length = 0;
  }
}

/** マスの縁を、丘の高さに沿って線で描く（選んだマス・置けるマスの枠。太さ 2px） */
export function strokeCell(g: Phaser.GameObjects.Graphics, bv: BoardView, col: number, row: number, color: number): void {
  const pts = bv.cellOutline(col, row, 1).map((p) => new Phaser.Math.Vector2(Math.round(p.x), Math.round(p.y)));
  g.lineStyle(2, color, 1);
  g.strokePoints(pts, true, true);
}
