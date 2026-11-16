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
});
