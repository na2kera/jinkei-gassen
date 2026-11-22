// 立体の部隊の絵（design §14.8）。焼いた兵の絵を 1〜3 体並べ、向き・歩く動き・敗走・兵の残りの棒・印を描く。
// 口は古い UnitSprite と同じ（apply・hide・destroy・soldierCenters）に、押せる範囲を返す hitBoxes を足した。
// 体の数・並び・型の選び方は squad.ts（画面なしで確かめられる）。投影は BoardView だけを通す。

import type { Kind, OrderKind, Stance } from '@jinkei/engine';
import Phaser from 'phaser';
import type { BoardView } from '../../battle/BoardView.ts';
import type { HitBox } from '../../battle/pick.ts';
import type { Rect } from '../../layout.ts';
import { drawOrderIcon, drawStanceIcon } from '../icons.ts';
import { markLayout } from '../marks.ts';
import { COLOR, SIDE_COLOR } from '../palette.ts';
import { ANGLES, SQUASH } from './bake.ts';
import type { FrameRef } from './stackTextures.ts';
import { stackTextures } from './stackTextures.ts';
import { barLength, countFor, modelFor, slotOffset, WalkTracker, walkFrame } from './squad.ts';

/**
 * 部隊ごとの旗（士気の旗）を出すか（decisions §24：立体の画面では出さない。本陣の幟は絵に入っている）。
 * 出すようにするときは、竿の高さを兵の背丈に合わせて決め直す（design §14.9）
 */
export const UNIT_FLAG = false;

/** 兵の残りの棒の高さ（decisions §24） */
const BAR_H = 2;

/** どの揃いの絵で描くか。配置・公開（大きさ 1）・戦闘（0.84。なければ配置の絵を 0.84 倍） */
export type SquadSet = 'deploy' | 'reveal' | 'battle';

export interface SquadLook {
  /** 部隊のまん中（戦場の座標。マス） */
  wx: number;
  wy: number;
  /** 部隊の向き（戦場の座標の単位ベクトル） */
  fx: number;
  fy: number;
  /** 兵の残りの割合 0〜1 */
  menRatio: number;
  /** 敗走の進み具合（0 は敗走していない） */
  rout: number;
  highlight: boolean;
  moving?: boolean;
  fighting?: boolean;
  /** いまの時刻（ミリ秒） */
  time?: number;
  order?: OrderKind | null;
  stance?: Stance | null;
  /** 印を寄せる範囲（BoardView.uiBounds） */
  bounds?: Rect;
  /** 表示の倍率（公開の回転の間は 1 − 0.16 × e。ふだんは 1） */
  display?: number;
  /** 兵の残りの棒を出すか（戦闘だけ） */
  bar?: boolean;
  /** 配置で引っぱっている：まん中を指の画面の位置に描く（歩かせない） */
  dragAt?: { x: number; y: number } | null;
}

interface Body {
  img: Phaser.GameObjects.Image;
  key: string;
  /** いまの絵の、足もとからの範囲（表示の倍率を掛けたあと）と足もとの画面の点・前後 */
  left: number;
  right: number;
  up: number;
  down: number;
  x: number;
  y: number;
  depth: number;
  /** 兵の大きさ（焼いた大きさ × 表示の倍率） */
  size: number;
}

export class SquadSprite {
  readonly team: 0 | 1;
  readonly kind: Kind;
  readonly id: number;
  private readonly seed: number;
  private readonly bodies: Body[] = [];
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly bar: Phaser.GameObjects.Graphics;
  private marksKey = '';
  private readonly walk = new WalkTracker();
  private lastTime: number | null = null;
  private visible = false;
  private set: SquadSet;
  private layer: Phaser.GameObjects.Container;
  /** 絵がまだ届いていなかった体の数（届いたら描き直すため） */
  missing = 0;

  constructor(
    scene: Phaser.Scene,
    team: 0 | 1,
    kind: Kind,
    /** 部隊の id（押した部隊の返り値と、歩く拍のずれに使う） */
    id: number,
    layer: Phaser.GameObjects.Container,
    markLayer: Phaser.GameObjects.Container,
    private readonly bv: BoardView,
    set: SquadSet,
  ) {
    this.team = team;
    this.kind = kind;
    this.id = id;
    this.seed = id;
    this.set = set;
    this.layer = layer;
    for (let i = 0; i < 3; i++) {
      const img = scene.add.image(0, 0, '__DEFAULT').setVisible(false);
      layer.add(img);
      this.bodies.push({ img, key: '', left: 0, right: 0, up: 0, down: 0, x: 0, y: 0, depth: 0, size: 1 });
    }
    this.bar = scene.add.graphics().setVisible(false);
    layer.add(this.bar);
    this.marks = scene.add.graphics();
    markLayer.add(this.marks);
  }

  /** 描く揃いを替える（公開の回転が終わったときなど） */
  setSet(set: SquadSet): void {
    this.set = set;
  }

  /** 兵を別の層に移す（配置で引っぱっている部隊を、いちばん手前の層へ） */
  moveTo(layer: Phaser.GameObjects.Container): void {
    if (layer === this.layer) return;
    for (const b of this.bodies) {
      this.layer.remove(b.img);
      layer.add(b.img);
    }
    this.layer.remove(this.bar);
    layer.add(this.bar);
    this.layer = layer;
  }

  /** 揃いから兵 1 体の絵を引く */
  private frameOf(model: ReturnType<typeof modelFor>, walk: number, angle: number): FrameRef | null {
    if (this.set === 'battle') return stackTextures.battle(model, this.team, walk, angle);
    if (this.set === 'reveal') {
      const r = stackTextures.soldier('reveal', model, this.team, 0, angle);
      if (r) return r;
    }
    // 配置の揃いは、自軍の上向きと敵軍の下向きだけ（公開の揃いがまだなら、向きを変えない 1 枚で）
    return stackTextures.soldier('deploy', model, this.team, 0, this.team === 0 ? 0 : ANGLES / 2);
  }

  apply(look: SquadLook): void {
    const bv = this.bv;
    const time = look.time ?? 0;
    const dt = this.lastTime === null ? 0 : time - this.lastTime;
    this.lastTime = time;
    const drag = look.dragAt ?? null;
    if (!this.visible || drag) this.walk.reset();
    this.visible = true;
    const dist = drag ? 0 : this.walk.update(look.wx, look.wy, dt, !!look.fighting);
    let n: number = countFor(look.menRatio);
    if (look.rout > 0) n = Math.ceil(n * (1 - look.rout));
    const spread = 1 + 1.2 * look.rout;
    const heading = Math.atan2(look.fy, look.fx);
    const angle = bv.angleIndex(look.fx, look.fy);
    const display = look.display ?? 1;
    const moving = !drag && (!!look.moving || !!look.fighting || look.rout > 0);
    const k = bv.cam.k;
    // 近接で戦っている間は、体を前後に ±1.4px（140 ミリ秒の拍の正弦）
    const fightBob = look.fighting && !drag ? 1.4 : 0;
    // 2 体の本陣：いまの向きで幟が広く見えるほうの護衛
    const pxA = stackTextures.sheet('stk-battle-guardA')?.teamPx;
    const pxB = stackTextures.sheet('stk-battle-guardB')?.teamPx;
    const guardAWider = !pxA || !pxB ? true : pxA[angle]! >= pxB[angle]!;
    const center = drag ?? bv.toScreen(look.wx, look.wy);
    let missing = 0;
    this.bodies.forEach((b, slot) => {
      const total = countFor(look.menRatio);
      const off = n > 0 && slot < n && total > 0 ? slotOffset(heading, slot, total as 1 | 2 | 3, spread) : null;
      if (!off) {
        b.img.setVisible(false);
        return;
      }
      const model = modelFor(this.kind, total as 1 | 2 | 3, slot, guardAWider);
      const ref = this.frameOf(model, walkFrame(dist, slot, this.seed, moving), angle);
      if (!ref) {
        missing++;
        b.img.setVisible(false);
        return;
      }
      // 取り込み直した絵（同じ鍵の新しいテクスチャ）にも切り替わるよう、取り込んだ時刻も見る
      const key = `${ref.key}|${ref.frame}|${ref.sheet.readyAt}`;
      if (key !== b.key) {
        b.img.setTexture(ref.key, ref.frame).setOrigin(ref.sheet.g.ax / ref.sheet.g.fw, ref.sheet.g.ay / ref.sheet.g.fh);
        b.key = key;
      }
      const sc = display * ref.display;
      const ph = slot * 1.7 + this.seed * 0.9;
      const fwd = fightBob ? Math.sin(time / 140 + ph) * fightBob : 0;
      // 盤の上のずれ（盤の px。前は部隊の向き）
      const du = off.u + Math.cos(heading) * fwd;
      const dv = off.v + Math.sin(heading) * fwd;
      let x: number;
      let y: number;
      let depth: number;
      if (drag) {
        // 引っぱっている部隊は、指の位置をまん中に、並びの間隔だけを写して描く
        const p0 = bv.project(0, 0);
        const p1 = bv.project(du / 32, dv / 32);
        x = drag.x + (p1.x - p0.x);
        y = drag.y + (p1.y - p0.y);
        depth = y;
      } else {
        const fx = look.wx + du / 32;
        const fy = look.wy + dv / 32;
        const p = bv.project(fx, fy, bv.ground(fx, fy));
        x = p.x;
        y = p.y;
        depth = p.depth;
      }
      const ext = ref.info.ext;
      b.left = ext.left * sc;
      b.right = ext.right * sc;
      b.up = ext.up * sc;
      b.down = ext.down * sc;
      b.x = Math.round(x);
      b.y = Math.round(y);
      b.depth = depth;
      b.size = ref.sheet.scale * sc;
      b.img.setVisible(true).setPosition(b.x, b.y).setScale(sc).setDepth(depth);
    });
    this.missing = missing;
    this.drawBar(look, n, k);
    this.drawMarks(look, n > 0 && missing < 3, time, center);
  }

  /** 兵の残りの棒：減った部隊だけ。いちばん手前の兵の足もとの 2px 下、画面の上で水平 */
  private drawBar(look: SquadLook, n: number, k: number): void {
    const g = this.bar;
    const r = look.menRatio;
    if (!look.bar || look.rout > 0 || n <= 0 || r >= 1 || r <= 0) {
      g.setVisible(false);
      return;
    }
    const shown = this.bodies.filter((b) => b.img.visible);
    if (shown.length === 0) {
      g.setVisible(false);
      return;
    }
    // 兵の大きさ（焼いた大きさ × 表示の倍率）
    const { len, fill } = barLength(shown[0]!.size, r);
    const foot = Math.max(...shown.map((b) => b.y));
    const front = Math.max(...shown.map((b) => b.depth));
    const base = this.bv.project(look.wx, look.wy, 0);
    const x0 = Math.round(base.x - len / 2);
    g.clear();
    g.fillStyle(COLOR.outline, 1);
    g.fillRect(0, 0, len, BAR_H);
    g.fillStyle(SIDE_COLOR[this.team].light, 1);
    g.fillRect(0, 0, fill, BAR_H);
    // 戦うときの前後の動きで、兵が棒より手前に来ないよう、その分だけ手前に
    g.setVisible(true).setPosition(x0, foot + 2).setDepth(front + 1.4 * k * SQUASH + 0.01);
  }

  /** 号令の印・方針の印・号令の相手の枠（旗は UNIT_FLAG のときだけ。置き場所の決め方は art/marks.ts のまま） */
  private drawMarks(look: SquadLook, alive: boolean, time: number, center: { x: number; y: number }): void {
    const g = this.marks;
    const cx = Math.round(center.x);
    const cy = Math.round(center.y);
    const L = markLayout({ cx, cy, hq: this.kind === 'hq', standing: true, morale: 100, bounds: look.bounds });
    const key = alive ? [look.highlight ? 1 : 0, look.rout > 0 ? 1 : 0, look.order ?? '', look.stance ?? '', L.order.x, L.order.y, L.stance.x, L.stance.y, L.frame.x, L.frame.y].join('|') : 'dead';
    g.setPosition(cx, cy);
    void time;
    if (key === this.marksKey) return;
    this.marksKey = key;
    g.clear();
    if (!alive) return;
    if (look.highlight) {
      const f = L.frame;
      g.fillStyle(COLOR.highlight, 1);
      g.fillRect(f.x, f.y, f.w, 2);
      g.fillRect(f.x, f.y + f.h - 2, f.w, 2);
      g.fillRect(f.x, f.y + 2, 2, f.h - 4);
      g.fillRect(f.x + f.w - 2, f.y + 2, 2, f.h - 4);
    }
    if (look.rout > 0) return;
    if (UNIT_FLAG) {
      // 旗を出すときの竿と旗（古い UnitSprite と同じ形。竿の高さは兵の背丈に合わせて決め直すこと）
      g.fillStyle(COLOR.pole, 1);
      g.fillRect(L.poleX, L.poleTop, 2, L.poleH);
      g.fillStyle(SIDE_COLOR[this.team].light, 1);
      g.fillRect(L.flagX, L.flagY, L.flagW, L.flagH);
    }
    if (look.order) drawOrderIcon(g, look.order, L.order.x, L.order.y);
    if (look.stance) drawStanceIcon(g, look.stance, L.stance.x, L.stance.y);
  }

  /** いま見えている兵の画面の矩形と前後（押して選ぶため。隠れている・全滅した部隊は空） */
  hitBoxes(): HitBox[] {
    if (!this.visible) return [];
    return this.bodies
      .filter((b) => b.img.visible)
      .map((b) => ({ id: this.id, x: b.x - b.left, y: b.y - b.up, w: b.left + b.right, h: b.up + b.down, depth: b.depth }));
  }

  /** 見えている兵の矩形の、いちばん上の端（数字の箱を出す高さ）。兵がいなければ null */
  topY(): number | null {
    const boxes = this.hitBoxes();
    return boxes.length ? Math.min(...boxes.map((b) => b.y)) : null;
  }

  /** 見えている兵の体のまん中（足もとから、絵の上の端の半分だけ上）と絵の大きさ（全滅したときの倒れた兵の演出に使う） */
  soldierCenters(): { x: number; y: number; w: number; h: number }[] {
    return this.bodies.filter((b) => b.img.visible).map((b) => ({ x: b.x, y: b.y - b.up / 2, w: b.left + b.right, h: b.up + b.down }));
  }

  /** いちばん手前の兵の前後の値（並べ直しに使う） */
  get frontDepth(): number {
    const shown = this.bodies.filter((b) => b.img.visible);
    return shown.length ? Math.max(...shown.map((b) => b.depth)) : -Infinity;
  }

  hide(): void {
    for (const b of this.bodies) b.img.setVisible(false);
    this.bar.setVisible(false);
    this.marksKey = 'hidden';
    this.marks.clear();
    this.visible = false;
    this.walk.reset();
    this.lastTime = null;
  }

  destroy(): void {
    for (const b of this.bodies) b.img.destroy();
    this.bar.destroy();
    this.marks.destroy();
  }
}
