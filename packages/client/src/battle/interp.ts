// 前の場面と今の場面のあいだを、時間で補う（design §5.2）。
// 描く刻み renderTick を実時間 × 倍率で進め、前と今の場面の tick のあいだで位置と向きを補う。
// 補う長さは「tick の差 × DT ÷ 倍率」になる（決着の場面は差が1のこともあるので、差は毎回場面から読む）。
// 1場面ぶん遅れて描くことになるが、そのかわり届き方に揺れがあっても動きが止まらない。

import { DT, type UnitView } from '@jinkei/engine';
import type { BattleFrame } from './BattleSource.ts';

export interface UnitSample {
  view: UnitView;
  x: number;
  y: number;
  fx: number;
  fy: number;
}

/** 角度の近いほうの回りで補う（fx と fy を別々に補うと 180° の向き替えで長さが潰れるため） */
function lerpAngle(ax: number, ay: number, bx: number, by: number, t: number): number {
  const a0 = Math.atan2(ay, ax);
  const a1 = Math.atan2(by, bx);
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a0 + d * t;
}

export class FrameInterpolator {
  private prev: BattleFrame | null = null;
  private cur: BattleFrame | null = null;
  private renderTick = 0;
  private readonly samples: UnitSample[] = [];
  private readonly before = new Map<number, UnitView>();
  private beforeOf: BattleFrame | null = null;

  push(frame: BattleFrame): void {
    this.prev = this.cur ?? frame;
    this.cur = frame;
    if (this.renderTick < this.prev.tick) this.renderTick = this.prev.tick;
  }

  /** 実時間 dtMs だけ進める。speed は早送りの倍率 */
  advance(dtMs: number, speed: number): void {
    if (!this.cur) return;
    this.renderTick = Math.min(this.cur.tick, this.renderTick + (dtMs / 1000 / DT) * speed);
  }

  /** いま描いている刻み（小数） */
  get tick(): number {
    return this.renderTick;
  }

  /** 描く刻みが最後の場面に追いついたか */
  get caughtUp(): boolean {
    return !!this.cur && this.renderTick >= this.cur.tick;
  }

  get latest(): BattleFrame | null {
    return this.cur;
  }

  /**
   * いまの刻みでの各部隊。返す配列と中の入れ物は毎回使い回す（毎フレームの割り当てを避けるため）。
   * 次に sample を呼ぶまでのあいだだけ有効。
   */
  sample(): UnitSample[] {
    const cur = this.cur;
    const prev = this.prev;
    const out = this.samples;
    if (!cur || !prev) {
      out.length = 0;
      return out;
    }
    const span = cur.tick - prev.tick;
    const t = span > 0 ? Math.max(0, Math.min(1, (this.renderTick - prev.tick) / span)) : 1;
    // 前の場面の id の引き表は、場面が入れ替わったときだけ作り直す
    if (this.beforeOf !== prev) {
      this.beforeOf = prev;
      this.before.clear();
      for (const u of prev.view.units) this.before.set(u.id, u);
    }
    const units = cur.view.units;
    out.length = units.length;
    for (let i = 0; i < units.length; i++) {
      const u = units[i]!;
      const p = this.before.get(u.id) ?? u;
      const a = lerpAngle(p.fx, p.fy, u.fx, u.fy, t);
      const s = out[i] ?? { view: u, x: 0, y: 0, fx: 0, fy: -1 };
      s.view = u;
      s.x = p.x + (u.x - p.x) * t;
      s.y = p.y + (u.y - p.y) * t;
      s.fx = Math.cos(a);
      s.fy = Math.sin(a);
      out[i] = s;
    }
    return out;
  }
}
