// A1 陣営と順番で有利不利がない（design §3.9）
import { describe, expect, it } from 'vitest';
import { createBattle, listTemplates, plainField, step } from '../../src/index.ts';
import { T } from '../../src/tuning.ts';
import { a1 } from '../../sim/scenes.ts';
import { templateArmy } from '../../sim/lib.ts';

describe('A1 陣営と順番で有利不利がない', () => {
  for (const t of ['line', 'crane', 'scale'] as const) {
    it(`${t} の鏡写し（種100個）：陣営0の得点率が 0.4〜0.6。配列を逆順にしても同じ`, () => {
      const fwd = a1(t, false);
      const rev = a1(t, true);
      expect(fwd).toBeGreaterThanOrEqual(0.4);
      expect(fwd).toBeLessThanOrEqual(0.6);
      expect(rev).toBeGreaterThanOrEqual(0.4);
      expect(rev).toBeLessThanOrEqual(0.6);
    }, 300_000);
  }

  it('ばらつきをなくすと、7つのひな形すべてで、最後の刻みまで両軍が完全に鏡写しになる（配列の順も逆にして）', () => {
    const saved = [T.randomMin, T.randomMax];
    const mutable = T as { randomMin: number; randomMax: number };
    mutable.randomMin = 1;
    mutable.randomMax = 1;
    try {
      for (const { id } of listTemplates()) {
        for (const reverse of [false, true]) {
          let a = templateArmy(id, 0);
          let b = templateArmy(id, 1);
          if (reverse) {
            a = a.slice().reverse();
            b = b.slice().reverse();
          }
          const r = createBattle({ field: plainField(), armies: [a, b], seed: 7, maxTicks: 1800, timeout: 'compare' });
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const s = r.value;
          const n = a.length;
          const W = s.field.width;
          const H = s.field.height;
          // 陣営0の i 番目と、陣営1の i 番目が鏡写しの組。狙いの id も n だけずれて対応する
          const mirrorId = (id2: number | null): number | null => (id2 === null ? null : (id2 + n) % (2 * n));
          // 初期状態と、各 step のあと（決着した最後の刻みを含む）で調べる
          const check = (): void => {
            for (let i = 0; i < n; i++) {
              const u = s.units[i]!;
              const v = s.units[i + n]!;
              const msg = `${id} ${reverse ? '逆順' : ''} 刻み ${s.tick} 部隊 ${i}`;
              expect(Math.abs(u.x - (W - v.x)), msg).toBeLessThan(1e-6);
              expect(Math.abs(u.y - (H - v.y)), msg).toBeLessThan(1e-6);
              expect(Math.abs(u.fx + v.fx) + Math.abs(u.fy + v.fy), msg).toBeLessThan(1e-6);
              expect(Math.abs(u.men - v.men), msg).toBeLessThan(1e-6);
              expect(Math.abs(u.morale - v.morale), msg).toBeLessThan(1e-6);
              expect(u.status, msg).toBe(v.status);
              expect(mirrorId(u.target), msg).toBe(v.target);
            }
          };
          check();
          while (!s.outcome) {
            step(s, []);
            check();
          }
          if (!s.outcome) return;
          expect(s.outcome.winner).toBe('draw');
        }
      }
    } finally {
      mutable.randomMin = saved[0]!;
      mutable.randomMax = saved[1]!;
    }
  }, 300_000);

  it('ばらつきをなくすと、違うひな形どうし（21組）でも、陣営を入れ替えた戦いと最後の刻みまで鏡写しになる（位置・向き・兵数・士気・状態・狙い・勝敗）', () => {
    const saved = [T.randomMin, T.randomMax];
    const mutable = T as { randomMin: number; randomMax: number };
    mutable.randomMin = 1;
    mutable.randomMax = 1;
    try {
      const ids = listTemplates().map((x) => x.id);
      for (const A of ids) {
        for (const B of ids) {
          if (A >= B) continue;
          const make = (x: typeof A, y: typeof A) => {
            const r = createBattle({ field: plainField(), armies: [templateArmy(x, 0), templateArmy(y, 1)], seed: 7, maxTicks: 1800, timeout: 'compare' });
            if (!r.ok) throw new Error(r.error.message);
            return r.value;
          };
          // s1 は A が陣営0・B が陣営1、s2 は B が陣営0・A が陣営1。s1 の id → s2 の id
          const s1 = make(A, B);
          const s2 = make(B, A);
          const nA = templateArmy(A, 0).length;
          const nB = templateArmy(B, 0).length;
          const map = (id: number): number => (id < nA ? nB + id : id - nA);
          const W = s1.field.width;
          const H = s1.field.height;
          const check = (): void => {
            for (let i = 0; i < nA + nB; i++) {
              const u = s1.units[i]!;
              const v = s2.units[map(i)]!;
              const msg = `${A} 対 ${B} 刻み ${s1.tick} 部隊 ${i}`;
              expect(Math.abs(u.x - (W - v.x)) + Math.abs(u.y - (H - v.y)), msg).toBeLessThan(1e-6);
              expect(Math.abs(u.fx + v.fx) + Math.abs(u.fy + v.fy), msg).toBeLessThan(1e-6);
              expect(Math.abs(u.men - v.men) + Math.abs(u.morale - v.morale), msg).toBeLessThan(1e-6);
              expect(u.status, msg).toBe(v.status);
              expect(u.target === null ? null : map(u.target), msg).toBe(v.target);
            }
          };
          check();
          while (!s1.outcome) {
            step(s1, []);
            step(s2, []);
            check();
          }
          expect(s2.outcome, `${A} 対 ${B}`).not.toBeNull();
          const w = s1.outcome.winner;
          expect(s2.outcome!.winner, `${A} 対 ${B}`).toBe(w === 'draw' ? 'draw' : 1 - w);
          expect(s2.outcome!.tick, `${A} 対 ${B}`).toBe(s1.outcome.tick);
          expect(s2.outcome!.reason, `${A} 対 ${B}`).toBe(s1.outcome.reason);
        }
      }
    } finally {
      mutable.randomMin = saved[0]!;
      mutable.randomMax = saved[1]!;
    }
  }, 300_000);
});
