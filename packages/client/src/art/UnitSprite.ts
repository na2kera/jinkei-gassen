// 部隊の絵（design §5.3）。兵種ごとの兵を並べ、兵数に応じて後ろから減らす。
// 兵の並びは部隊の向きに合わせて回し（前列が敵を向く）、兵1人の絵は4方向から選ぶ（回すとドットが崩れるため）。
// 部隊の絵は中心から半径 10px の円に収める。部隊どうしの中心は 0.9 マス（21.6px）まで近づくので、
// これを超えると、隣の部隊と重なって見える（devCheckReach で確かめる）。
// engine の型は読まず、画面の座標に直した値（UnitLook）だけを受け取る。配置・戦闘・斜め視点で同じ絵を使い回すため。

import type { Kind, OrderKind, Stance } from '@jinkei/engine';
import Phaser from 'phaser';
import type { Rect } from '../layout.ts';
import { drawOrderIcon, drawStanceIcon } from './icons.ts';
import { ART, COLOR, SIDE_COLOR } from './palette.ts';
import { shapeOf, soldierKey, soldierReach, soldierSize, type Dir4, type SoldierShape } from './textures.ts';

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
  /** 敗走の進み具合。0 は敗走していない、0〜1 で散らばりながら兵が減っていく */
  rout: number;
  /** 号令の相手として選ばれている */
  highlight: boolean;
  /** 動いている（歩く2コマを出す） */
  moving?: boolean;
  /** 近接で戦っている（前列が小さく前後に動く） */
  fighting?: boolean;
  /** いまの時刻（ミリ秒）。歩く・突くの動きの拍に使う */
  time?: number;
  /** かかっている号令（印を出す） */
  order?: OrderKind | null;
  /** 方針（配置の画面の自軍だけ印を出す） */
  stance?: Stance | null;
  /** 号令がかかった直後で、旗がはためく */
  wave?: boolean;
  /** 旗がはみ出さないようにする範囲（戦場の矩形） */
  bounds?: Rect;
}

interface Slot {
  lx: number;
  ly: number;
  shape: SoldierShape;
}

/** 歩兵・盾兵・弓兵：3×3。並びの順は前の列から（兵が減るときは後ろから消す） */
const FOOT: { lx: number; ly: number }[] = [];
for (const ly of [-4, 0, 4]) for (const lx of [-5, 0, 5]) FOOT.push({ lx, ly });
/** 騎兵：馬が大きいので 2×2 */
const CAVALRY = [
  { lx: -3, ly: -4 },
  { lx: 3, ly: -4 },
  { lx: -3, ly: 4 },
  { lx: 3, ly: 4 },
];
/** 本陣：まん中に将、四隅に護衛 */
const HQ_GUARDS = [
  { lx: -5, ly: -4 },
  { lx: 5, ly: -4 },
  { lx: -5, ly: 4 },
  { lx: 5, ly: 4 },
];

function slotsOf(kind: Kind): Slot[] {
  if (kind === 'hq') {
    return [{ lx: 0, ly: 0, shape: 'general' }, ...HQ_GUARDS.map((o) => ({ ...o, shape: 'guard' as const }))];
  }
  const shape = shapeOf(kind);
  return (kind === 'cavalry' ? CAVALRY : FOOT).map((o) => ({ ...o, shape }));
}

/** 敗走で散らばるときの、兵ごとのずれ（毎回同じになるよう固定の値） */
const SCATTER = Array.from({ length: 9 }, (_, i) => ({ x: ((i * 37) % 11) / 10 - 0.5, y: ((i * 53) % 13) / 12 - 0.5 }));

export function dirOf(dx: number, dy: number): Dir4 {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy < 0 ? 0 : 2;
}

/** 部隊の絵が中心からどこまで届くか（並びを回しても、この値を超えない） */
export function unitReach(kind: Kind): number {
  return Math.max(...slotsOf(kind).map((s) => Math.hypot(s.lx, s.ly) + soldierReach(s.shape)));
}

export class UnitSprite {
  private readonly slots: Slot[];
  private readonly soldiers: Phaser.GameObjects.Image[] = [];
  private readonly keys: string[] = [];
  private readonly marks: Phaser.GameObjects.Graphics;
  private marksKey = '';
  private readonly seed: number;

  constructor(
    scene: Phaser.Scene,
    /** 色と旗の形の組。0 は見ている人の自軍（藍）、1 は敵軍（朱）。engine の陣営ではない */
    readonly team: 0 | 1,
    readonly kind: Kind,
    /** 部隊ごとに歩く拍をずらすための数（部隊の id など） */
    seed: number,
    soldierLayer: Phaser.GameObjects.Container,
    markLayer: Phaser.GameObjects.Container,
  ) {
    this.seed = seed;
    this.slots = slotsOf(kind);
    for (const s of this.slots) {
      const key = soldierKey(team, s.shape, 0, 0);
      const img = scene.add.image(0, 0, key).setOrigin(0, 0);
      soldierLayer.add(img);
      this.soldiers.push(img);
      this.keys.push(key);
    }
    this.marks = scene.add.graphics();
    markLayer.add(this.marks);
  }

  /** 兵数の割合から、描く兵の数（本陣の将は生きている限り描く） */
  private countOf(menRatio: number): number {
    if (!(menRatio > 0)) return 0;
    if (this.kind === 'hq') return 1 + Math.min(4, Math.ceil(menRatio * 4));
    return Math.min(this.slots.length, Math.ceil(menRatio * this.slots.length));
  }

  apply(look: UnitLook): void {
    const dir = dirOf(look.dx, look.dy);
    const time = look.time ?? 0;
    // 並びの「右」は前を時計回りに 90° 回した向き
    const rx = -look.dy;
    const ry = look.dx;
    let count = this.countOf(look.menRatio);
    // 敗走中は散らばりながら、兵が1人ずつ消えていく（半透明にはしない）
    if (look.rout > 0) count = Math.ceil(count * (1 - look.rout));
    const spread = 1 + 1.2 * look.rout;
    const jitter = 8 * look.rout;
    const beat = Math.floor(time / 200);
    const jab = Math.floor(time / 160);
    this.soldiers.forEach((img, i) => {
      if (i >= count) {
        img.setVisible(false);
        return;
      }
      const slot = this.slots[i]!;
      // 歩いている・敗走しているときは、兵ごとに拍をずらして2コマを交互に出す
      const walking = look.moving || look.rout > 0;
      const frame = (walking ? (beat + this.seed + i) % 2 : 0) as 0 | 1;
      const key = soldierKey(this.team, slot.shape, dir, frame);
      if (key !== this.keys[i]) {
        this.keys[i] = key;
        img.setTexture(key);
      }
      // 近接で戦っている前列は、拍に合わせて 1px 前へ突く
      const forward = look.fighting && slot.ly < 0 && (jab + i + this.seed) % 3 === 0 ? 1 : 0;
      const sc = SCATTER[i % SCATTER.length]!;
      const lx = slot.lx * spread + sc.x * jitter;
      const ly = slot.ly * spread + sc.y * jitter - forward;
      const wx = look.x + lx * rx - ly * look.dx;
      const wy = look.y + lx * ry - ly * look.dy;
      const size = soldierSize(slot.shape, dir);
      // 整数の px に揃えてドットが崩れないようにする
      img.setPosition(Math.round(wx - size.w / 2), Math.round(wy - size.h / 2));
      img.setVisible(true);
    });
    this.drawMarks(look, count > 0, time);
  }

  /** いま見えている兵の中心（全滅したときに、その場に倒れた兵を描くため） */
  soldierCenters(): { x: number; y: number; w: number; h: number }[] {
    return this.soldiers
      .filter((s) => s.visible)
      .map((s) => ({ x: s.x + s.width / 2, y: s.y + s.height / 2, w: s.width, h: s.height }));
  }

  /**
   * 旗（士気）・号令の印・方針の印・号令の相手の枠。
   * 形は部隊の中心を原点にして描き、毎フレームは位置だけを動かす。描き直すのは、表示する値が変わったときだけ。
   */
  private drawMarks(look: UnitLook, alive: boolean, time: number): void {
    const g = this.marks;
    const hq = this.kind === 'hq';
    const cx = Math.round(look.x);
    const cy = Math.round(look.y);
    const flagW = hq ? 10 : 6;
    const flagH = hq ? 8 : 4;
    const poleH = hq ? 24 : 20;
    let poleTop = hq ? -22 : -18;
    // 戦場の右端からはみ出すなら、旗を竿の左に付け替える。上端からはみ出すなら、竿ごと下げる
    let mirror = false;
    const b = look.bounds;
    if (b) {
      if (cx + 11 + flagW > b.x + b.w) mirror = true;
      if (cy + poleTop < b.y) poleTop = b.y - cy;
    }
    const m = Math.max(0, Math.min(100, look.morale)) / 100;
    // 旗の位置は 2px 単位に揃える。士気が下がるほど旗が下がる
    const fy = poleTop + Math.round(((1 - m) * (poleH - flagH)) / 2) * 2;
    const wave = look.wave ? Math.floor(time / 120) % 2 : 0;
    const key = alive
      ? [look.highlight ? 1 : 0, look.rout > 0 ? 1 : 0, fy, poleTop, mirror ? 1 : 0, wave, look.order ?? '', look.stance ?? ''].join('|')
      : 'dead';
    g.setPosition(cx, cy);
    if (key === this.marksKey) return;
    this.marksKey = key;
    g.clear();
    if (!alive) return;
    if (look.highlight) {
      g.fillStyle(COLOR.highlight, 1);
      g.fillRect(-12, -12, 24, 2);
      g.fillRect(-12, 10, 24, 2);
      g.fillRect(-12, -10, 2, 20);
      g.fillRect(10, -10, 2, 20);
    }
    if (look.rout > 0) return;
    // 旗竿は画面の上下に立てる（部隊の向きでは回さない）
    const poleX = mirror ? -12 : 10;
    g.fillStyle(COLOR.pole, 1);
    g.fillRect(poleX, poleTop, 2, poleH);
    const color = SIDE_COLOR[this.team];
    const x0 = mirror ? poleX - flagW : poleX + 2;
    // はためくときは、旗の下半分を 1px ずらす
    const shift = wave ? (mirror ? -1 : 1) : 0;
    if (hq) {
      // 本陣の大きな旗：金の地に陣営の色の縁
      g.fillStyle(color.main, 1);
      g.fillRect(x0, fy, flagW, flagH);
      g.fillStyle(ART.gold, 1);
      g.fillRect(x0 + 2, fy + 2, flagW - 4, flagH / 2 - 2);
      g.fillRect(x0 + 2 + shift, fy + flagH / 2, flagW - 4, flagH / 2 - 2);
    } else if (this.team === 0) {
      // 自軍は四角い旗
      g.fillStyle(color.light, 1);
      g.fillRect(x0, fy, flagW, flagH / 2);
      g.fillRect(x0 + shift, fy + flagH / 2, flagW, flagH / 2);
    } else {
      // 敵軍は段々の三角の旗（色だけに頼らず形でも分ける。assumptions S11）。竿から離れるほど細くなる
      g.fillStyle(color.light, 1);
      for (let i = 0; i < flagH / 2; i++) {
        const w = flagW - i * 2;
        g.fillRect((mirror ? poleX - w : poleX + 2) + (i > 0 ? shift : 0), fy + i * 2, w, 2);
      }
    }
    if (look.order) drawOrderIcon(g, look.order, -12, -12);
    if (look.stance) drawStanceIcon(g, look.stance, -12, 5);
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
