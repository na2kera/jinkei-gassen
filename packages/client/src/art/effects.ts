// 戦闘の演出（火花・土煙・矢・倒れた兵）。1枚の Graphics に毎フレーム描き直す。
// どれも数百ミリ秒で消える小さな点だけにして、画面が揺れ続けたり光り続けたりしないようにする。
// 半透明は使わず、時間が来たら消す。

import type Phaser from 'phaser';
import { ART, COLOR, SIDE_COLOR } from './palette.ts';

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
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  private particles: Particle[] = [];
  private arrows: Arrow[] = [];
  private fallen: Fallen[] = [];

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
    this.g = scene.add.graphics();
    layer.add(this.g);
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

  arrow(x0: number, y0: number, x1: number, y1: number, now: number, life: number): void {
    if (this.arrows.length >= MAX_ARROWS) return;
    effectCounts.arrow++;
    this.arrows.push({ x0, y0, x1, y1, born: now, life });
  }

  /** 全滅した部隊の兵が、その場に倒れて少しのあいだ残る */
  fall(centers: { x: number; y: number }[], team: 0 | 1, now: number): void {
    effectCounts.fallen++;
    centers.forEach((c, i) => this.fallen.push({ x: c.x, y: c.y, wide: i % 2 === 0, team, born: now, life: 900 + i * 60 }));
  }

  update(now: number): void {
    const g = this.g;
    g.clear();
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
    // 矢：3px の柄と穂先。山なりにはせず、まっすぐ飛ばす（真上からの見下ろしなので）
    this.arrows = this.arrows.filter((a) => now - a.born < a.life);
    for (const a of this.arrows) {
      // 少し遅れて放つ矢は、時刻が来るまで描かない
      if (now < a.born) continue;
      const t = (now - a.born) / a.life;
      const len = Math.hypot(a.x1 - a.x0, a.y1 - a.y0) || 1;
      const ux = (a.x1 - a.x0) / len;
      const uy = (a.y1 - a.y0) / len;
      const x = a.x0 + (a.x1 - a.x0) * t;
      const y = a.y0 + (a.y1 - a.y0) * t;
      g.fillStyle(ART.wood, 1);
      g.fillRect(Math.round(x - ux * 2), Math.round(y - uy * 2), 1, 1);
      g.fillRect(Math.round(x - ux), Math.round(y - uy), 1, 1);
      g.fillStyle(ART.metal, 1);
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
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
  }

  destroy(): void {
    this.g.destroy();
  }
}
