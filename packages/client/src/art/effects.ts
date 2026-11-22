// 戦闘の演出（火花・土煙・矢・倒れた兵）。毎フレーム描き直す。描く先は 2 つ：兵より手前の層（火花・土煙・矢・倒れた兵）と、
// 地面と兵のあいだの影の層（矢の影。design §14.10）。矢は山なりに飛ぶ：道すじは戦場の上（座標と高さ）で持ち、毎コマ投影で写す。
// どれも数百ミリ秒で消える小さな点だけにして、画面が揺れ続けたり光り続けたりしないようにする。
// 半透明は使わず、時間が来たら消す。

import type Phaser from 'phaser';
import { ART, COLOR, SIDE_COLOR, TERRAIN } from './palette.ts';

/** 矢を写す投影（BoardView の project と ground だけを使う） */
export interface ArrowProjection {
  project(x: number, y: number, h?: number): { x: number; y: number };
  ground(x: number, y: number): number;
}

/** 山の高さ ＝ 飛ぶ距離（盤の px）× この値（decisions §24） */
export const ARROW_PEAK = 0.22;

/** 戦場の上の点（座標はマス、高さは盤の px） */
export interface FieldPoint {
  x: number;
  y: number;
  h: number;
}

/** 飛ぶ時間（ミリ秒）：220 + 距離（盤の px）× 3.2 を 380〜900 に収める（倍速なら割る） */
export function arrowLife(distPx: number, speed = 1): number {
  return Math.max(380, Math.min(900, 220 + distPx * 3.2)) / speed;
}

/** 飛んでいる途中（t は 0〜1）の点。高さは、まっすぐの高さに 4 × 山 × t(1 − t) を足す */
export function arrowAt(a: { from: FieldPoint; to: FieldPoint; peak: number }, t: number): FieldPoint {
  const x = a.from.x + (a.to.x - a.from.x) * t;
  const y = a.from.y + (a.to.y - a.from.y) * t;
  const h = a.from.h + (a.to.h - a.from.h) * t + 4 * a.peak * t * (1 - t);
  return { x, y, h };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: number;
  size: number;
}

interface Arrow {
  from: FieldPoint;
  to: FieldPoint;
  peak: number;
  born: number;
  life: number;
}

interface Fallen {
  x: number;
  y: number;
  /** 横に倒れているか（縦に倒れているか） */
  wide: boolean;
  team: 0 | 1;
  born: number;
  life: number;
}

const DUST = 0xb09a6a;
/** 同時に出す点の上限（多すぎると画面がうるさく、重くなるため） */
const MAX_PARTICLES = 160;
const MAX_ARROWS = 60;

/** 演出ごとの回数（開発用の口で、演出が出ていることを確かめるため） */
export const effectCounts = { spark: 0, dust: 0, impact: 0, arrow: 0, fallen: 0 };

export class Effects {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly shadow: Phaser.GameObjects.Graphics;
  private particles: Particle[] = [];
  private arrows: Arrow[] = [];
  private fallen: Fallen[] = [];

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, shadowLayer: Phaser.GameObjects.Container) {
    this.g = scene.add.graphics();
    layer.add(this.g);
    this.shadow = scene.add.graphics();
    shadowLayer.add(this.shadow);
  }

  private push(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push(p);
  }

  /** ぶつかる所の火花（白と金の点が3つほど、すぐ消える） */
  spark(x: number, y: number, now: number): void {
    effectCounts.spark++;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      this.push({ x, y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, born: now, life: 140, color: i === 0 ? COLOR.goldHi : COLOR.cream, size: 1 });
    }
  }

  /** 土煙（土色の 2px の点が、ゆっくり広がって消える） */
  dust(x: number, y: number, now: number, n = 2): void {
    effectCounts.dust++;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 4;
      this.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: Math.cos(a) * 10, vy: Math.sin(a) * 10 - 6, born: now, life: 320, color: DUST, size: 2 });
    }
  }

  /** 騎兵の突入：土煙の輪と火花を一度だけ */
  impact(x: number, y: number, now: number): void {
    effectCounts.impact++;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.push({ x, y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, born: now, life: 260, color: DUST, size: 2 });
    }
    this.spark(x, y, now);
    this.spark(x, y, now);
  }

  /** 矢を 1 本。from・to は戦場の上の点（放つ所は射手の地面 + 10、落ちる所は相手の地面 + 2）。山 = 飛ぶ距離 × 0.22 */
  arrow(from: FieldPoint, to: FieldPoint, now: number, life: number): void {
    if (this.arrows.length >= MAX_ARROWS) return;
    effectCounts.arrow++;
    const d = Math.hypot(to.x - from.x, to.y - from.y) * 32;
    this.arrows.push({ from, to, peak: d * ARROW_PEAK, born: now, life });
  }

  /** 全滅した部隊の兵が、その場に倒れて少しのあいだ残る */
  fall(centers: { x: number; y: number }[], team: 0 | 1, now: number): void {
    effectCounts.fallen++;
    centers.forEach((c, i) => this.fallen.push({ x: c.x, y: c.y, wide: i % 2 === 0, team, born: now, life: 900 + i * 60 }));
  }

  update(now: number, pj: ArrowProjection): void {
    const g = this.g;
    g.clear();
    this.shadow.clear();
    // 倒れた兵：服の色の横長の点と、肌の点
    this.fallen = this.fallen.filter((f) => now - f.born < f.life);
    for (const f of this.fallen) {
      const x = Math.round(f.x);
      const y = Math.round(f.y);
      g.fillStyle(SIDE_COLOR[f.team].dark, 1);
      if (f.wide) g.fillRect(x - 2, y - 1, 4, 2);
      else g.fillRect(x - 1, y - 2, 2, 4);
      g.fillStyle(ART.skin, 1);
      g.fillRect(f.wide ? x + 2 : x - 1, f.wide ? y - 1 : y + 2, 1, 1);
    }
    // 矢：全体 7px（穂先 2px は明るい色、柄 5px）。向きは道すじの少し前と少し後ろを画面に写した差。影は地面の上に 1px
    this.arrows = this.arrows.filter((a) => now - a.born < a.life);
    for (const a of this.arrows) {
      // 少し遅れて放つ矢は、時刻が来るまで描かない
      if (now < a.born) continue;
      const t = (now - a.born) / a.life;
      const q = arrowAt(a, t);
      const p = pj.project(q.x, q.y, q.h);
      const qa = arrowAt(a, Math.max(0, t - 0.02));
      const qb = arrowAt(a, Math.min(1, t + 0.02));
      const pa = pj.project(qa.x, qa.y, qa.h);
      const pb = pj.project(qb.x, qb.y, qb.h);
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
      const ux = (pb.x - pa.x) / len;
      const uy = (pb.y - pa.y) / len;
      const sp = pj.project(q.x, q.y, pj.ground(q.x, q.y));
      this.shadow.fillStyle(TERRAIN.leafLo, 1);
      this.shadow.fillRect(Math.round(sp.x), Math.round(sp.y), 1, 1);
      g.fillStyle(ART.hat, 1);
      for (let i = 2; i <= 6; i++) g.fillRect(Math.round(p.x - ux * i), Math.round(p.y - uy * i), 1, 1);
      g.fillStyle(COLOR.cream, 1);
      for (let i = 0; i <= 1; i++) g.fillRect(Math.round(p.x - ux * i), Math.round(p.y - uy * i), 1, 1);
    }
    this.particles = this.particles.filter((p) => now - p.born < p.life);
    for (const p of this.particles) {
      const t = (now - p.born) / 1000;
      g.fillStyle(p.color, 1);
      g.fillRect(Math.round(p.x + p.vx * t), Math.round(p.y + p.vy * t), p.size, p.size);
    }
  }

  clear(): void {
    this.particles = [];
    this.arrows = [];
    this.fallen = [];
    this.g.clear();
    this.shadow.clear();
  }

  destroy(): void {
    this.g.destroy();
    this.shadow.destroy();
  }
}
