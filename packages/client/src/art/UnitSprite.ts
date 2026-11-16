// 部隊の仮の絵（design §5.3）。兵数に応じて最大16人（4×4）の兵を並べ、兵種は兵の形、向きは兵の前の印と並びの回転、
// 士気は旗の高さで示す。engine の型は読まず、画面の座標に直した値（UnitLook）だけを受け取る。
// これにより、配置の画面でも戦闘の画面でも、斜め視点でも同じ絵の組を使い回せる。

import type { Kind, Side } from '@jinkei/engine';
import Phaser from 'phaser';
import { COLOR, SIDE_COLOR } from './palette.ts';
import { soldierKey, soldierSize, type Dir4 } from './textures.ts';

export const MAX_SOLDIERS = 16;
const PITCH = 6;

export interface UnitLook {
  /** 部隊の中心（画面の px） */
  x: number;
  y: number;
  /** 画面の上での向き（単位ベクトル） */
  dx: number;
  dy: number;
  /** 兵の残りの割合 0〜1 */
  menRatio: number;
  /** 士気 0〜100 */
  morale: number;
  /** 敗走の進み具合。0 は敗走していない、0〜1 で散らばって薄くなる */
  rout: number;
  highlight: boolean;
}

/** 並びの順：前の列から後ろへ。兵が減るときは後ろから消す */
const OFFSETS: { lx: number; ly: number }[] = [];
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 4; c++) OFFSETS.push({ lx: (c - 1.5) * PITCH, ly: (r - 1.5) * PITCH });
}

/** 敗走で散らばるときの、兵ごとのずれ（毎回同じになるよう固定の値） */
const SCATTER = OFFSETS.map((_, i) => ({ x: ((i * 37) % 11) / 10 - 0.5, y: ((i * 53) % 13) / 12 - 0.5 }));

export function dirOf(dx: number, dy: number): Dir4 {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy < 0 ? 0 : 2;
}

export function soldierCount(menRatio: number): number {
  if (!(menRatio > 0)) return 0;
  return Math.min(MAX_SOLDIERS, Math.ceil(menRatio * MAX_SOLDIERS));
}

export class UnitSprite {
  private readonly soldiers: Phaser.GameObjects.Image[] = [];
  private readonly marks: Phaser.GameObjects.Graphics;
  private dir: Dir4 = 0;
  private marksKey = '';

  constructor(
    scene: Phaser.Scene,
    /** 色と旗の形の組。0 は見ている人の自軍（藍）、1 は敵軍（朱）。engine の陣営ではない */
    readonly team: Side,
    readonly kind: Kind,
    soldierLayer: Phaser.GameObjects.Container,
    markLayer: Phaser.GameObjects.Container,
  ) {
    for (let i = 0; i < MAX_SOLDIERS; i++) {
      const img = scene.add.image(0, 0, soldierKey(team, kind, 0)).setOrigin(0, 0);
      soldierLayer.add(img);
      this.soldiers.push(img);
    }
    this.marks = scene.add.graphics();
    markLayer.add(this.marks);
  }

  apply(look: UnitLook): void {
    const dir = dirOf(look.dx, look.dy);
    if (dir !== this.dir) {
      this.dir = dir;
      for (const s of this.soldiers) s.setTexture(soldierKey(this.team, this.kind, dir));
    }
    const size = soldierSize(this.kind, dir);
    // 並びの「右」は前を時計回りに 90° 回した向き
    const rx = -look.dy;
    const ry = look.dx;
    const count = soldierCount(look.menRatio);
    const spread = 1 + 1.5 * look.rout;
    const jitter = 10 * look.rout;
    // 薄くなるのは4段階に区切る（なめらかな半透明の飾りにしないため）
    const alpha = look.rout <= 0 ? 1 : look.rout < 0.25 ? 0.75 : look.rout < 0.5 ? 0.5 : 0.25;
    this.soldiers.forEach((s, i) => {
      if (i >= count) {
        s.setVisible(false);
        return;
      }
      const o = OFFSETS[i]!;
      const sc = SCATTER[i]!;
      const wx = look.x + (o.lx * rx - o.ly * look.dx) * spread + sc.x * jitter;
      const wy = look.y + (o.lx * ry - o.ly * look.dy) * spread + sc.y * jitter;
      // 整数の px に揃えてドットが崩れないようにする
      s.setPosition(Math.round(wx - size.w / 2), Math.round(wy - size.h / 2));
      s.setAlpha(alpha);
      s.setVisible(true);
    });
    this.drawMarks(look, count > 0);
  }

  /**
   * 旗（士気）と、号令の相手として選ばれたときの枠。
   * 形は部隊の中心を原点にして描き、毎フレームは位置だけを動かす。描き直すのは、旗の高さ・枠・敗走が変わったときだけ。
   */
  private drawMarks(look: UnitLook, alive: boolean): void {
    const g = this.marks;
    const hq = this.kind === 'hq';
    const poleTop = -18;
    const poleH = 20;
    const flagH = hq ? 6 : 4;
    const m = Math.max(0, Math.min(100, look.morale)) / 100;
    // 旗の位置は 2px 単位に揃える。士気が下がるほど旗が下がる
    const fy = poleTop + Math.round(((1 - m) * (poleH - flagH)) / 2) * 2;
    const key = alive ? `${look.highlight ? 1 : 0}|${look.rout > 0 ? 1 : 0}|${fy}` : 'dead';
    g.setPosition(Math.round(look.x), Math.round(look.y));
    if (key === this.marksKey) return;
    this.marksKey = key;
    g.clear();
    if (!alive) return;
    if (look.highlight) {
      g.fillStyle(COLOR.highlight, 1);
      g.fillRect(-14, -14, 28, 2);
      g.fillRect(-14, 12, 28, 2);
      g.fillRect(-14, -12, 2, 24);
      g.fillRect(12, -12, 2, 24);
    }
    if (look.rout > 0) return;
    // 旗竿は画面の上下に立てる（部隊の向きでは回さない）
    const poleX = 10;
    g.fillStyle(COLOR.pole, 1);
    g.fillRect(poleX, poleTop, 2, poleH);
    g.fillStyle(hq ? COLOR.hqFlag : SIDE_COLOR[this.team].light, 1);
    const fw = hq ? 8 : 6;
    if (this.team === 0) {
      // 自軍は四角い旗
      g.fillRect(poleX + 2, fy, fw, flagH);
    } else {
      // 敵軍は段々の三角の旗（色だけに頼らず形でも分ける。assumptions S11）
      for (let i = 0; i < flagH / 2; i++) g.fillRect(poleX + 2, fy + i * 2, fw - i * 2, 2);
    }
  }

  hide(): void {
    for (const s of this.soldiers) s.setVisible(false);
    this.marksKey = 'hidden';
    this.marks.clear();
  }

  destroy(): void {
    for (const s of this.soldiers) s.destroy();
    this.marks.destroy();
  }
}
