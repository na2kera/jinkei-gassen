// マスの境目の判定が、180° 回した配置で陣営によって分かれないこと（terrain.ts の cellIndex。CELL_EPS = 1e-9）。
// 対戦の地図（森・丘・川）で、ばらつきをなくした戦いが最後まで鏡写しになることを、全部の組で確かめる。
import { describe, expect, it } from 'vitest';
import { createBattle, listTemplates, pvpField, step, terrainAt, type BattleState, type Field, type PvpMapId, type Terrain } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { templateArmy } from '../sim/lib.ts';

/** 点対称で、行ごと・列ごとに地形の違う戦場（境目でどちらのマスを選んだかが、地形の違いで分かるように） */
function patterned(width: number, height: number): Field {
  const kinds: Terrain[] = ['plain', 'hill', 'forest', 'river', 'fence'];
  const terrain: Terrain[] = new Array<Terrain>(width * height).fill('plain');
  // 上半分（行の数は偶数）を式で塗り、下半分はその 180° 回した写し
  for (let r = 0; r < height / 2; r++) {
    for (let c = 0; c < width; c++) {
      const t = kinds[(r * 7 + c * 3 + r * c) % kinds.length]!;
      terrain[r * width + c] = t;
      terrain[(height - 1 - r) * width + (width - 1 - c)] = t;
    }
  }
  return { width, height, terrain, zones: [{ col: 0, row: 0, width, height }, { col: 0, row: 0, width, height }] };
}

describe('マスの境目と 180° 回した座標', () => {
  // 丸めで上下にぶれる大きさ（遊びの 1e-9 の内側）。鏡写しの両側で別々に選ぶ（片方はちょうど整数、片方は 8.000000000000002、のように分かれる）
  const small = [0, 2e-15, -2e-15, 4e-12, -4e-12, 5e-10, -5e-10];
  // 遊びの外（1e-9 より離れた値）。こちらは鏡写しの座標を引き算で作る。
  // 差がちょうど 1e-9 の値は、x と W − x の丸めで遊びの内と外に分かれるので使わない（遊びの大きさそのものの上の、別の境目）
  const far = [2e-9, -2e-9, 1e-6, -1e-6, 0.3, -0.3];
  for (const [W, H] of [[10, 12], [12, 16], [5, 12], [3, 16]] as const) {
    it(`${W}×${H}：境目の近くの (x, y) と、別々に丸めがぶれた (W − x, H − y) が、点対称の戦場で同じ地形のマスになる（戦場のまん中の線の上は除く）`, () => {
      const f = patterned(W, H);
      const bad: string[] = [];
      for (let i = 0; i <= W; i++) {
        for (let j = 0; j <= H; j++) {
          // まん中の線の上（x = W/2 か y = H/2 の境目）は、1つのマスの番号の決め方では鏡写しにできない（どちらの陣営にも同じマスを返す）
          if (2 * i === W || 2 * j === H) continue;
          for (const d1 of small) for (const d2 of small) for (const d3 of small) for (const d4 of small) {
            const x = i + d1;
            const y = j + d2;
            const mx = W - i + d3;
            const my = H - j + d4;
            if (x < 0 || y < 0 || mx < 0 || my < 0 || x > W || y > H || mx > W || my > H) continue;
            const a = terrainAt(f, x, y);
            const b = terrainAt(f, mx, my);
            if (a !== b) bad.push(`(${x}, ${y}) ${a} / (${mx}, ${my}) ${b}`);
          }
          for (const dx of [...small, ...far]) for (const dy of [...small, ...far]) {
            const x = i + dx;
            const y = j + dy;
            if (x < 0 || y < 0 || x > W || y > H) continue;
            const a = terrainAt(f, x, y);
            const b = terrainAt(f, W - x, H - y);
            if (a !== b) bad.push(`(${x}, ${y}) ${a} / (${W - x}, ${H - y}) ${b}`);
          }
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }
  it('鏡写しの対で丸めがずれた例：陣営0の y = 8.000000000000002 と、陣営1の y = 4 が、同じ地形のマス（森の地図の行 7 と行 4）になる', () => {
    const f = pvpField('forest');
    expect(terrainAt(f, 7.5, 8.000000000000002)).toBe('forest');
    expect(terrainAt(f, 10 - 7.5, 4)).toBe('forest');
    expect(terrainAt(f, 7.5, 8)).toBe('forest');
  });
  it('境目から 1e-9 より離れた座標は、floor のマス（遊びを入れる前と同じ）', () => {
    const f = patterned(10, 12);
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 12; j++) {
        for (const dx of [2e-9, 1e-6, 0.5, 1 - 2e-9]) {
          for (const dy of [2e-9, 1e-6, 0.5, 1 - 2e-9]) {
            const x = i + dx;
            const y = j + dy;
            expect(terrainAt(f, x, y), `(${x}, ${y})`).toBe(f.terrain[Math.floor(y) * 10 + Math.floor(x)]);
          }
        }
      }
    }
  });
});

/** ばらつきなしで s1 と s2 を最後まで進め、map(i) の対が鏡写しでなくなった最初の刻みを返す（最後まで鏡写しなら null） */
function firstMismatch(s1: BattleState, s2: BattleState, map: (id: number) => number, label: string): string | null {
  const W = s1.field.width;
  const H = s1.field.height;
  const n = s1.units.length;
  const check = (): string | null => {
    for (let i = 0; i < n; i++) {
      const u = s1.units[i]!;
      const v = s2.units[map(i)]!;
      const where = `${label} 刻み ${s1.tick} 部隊 ${i}`;
      if (Math.abs(u.x - (W - v.x)) + Math.abs(u.y - (H - v.y)) >= 1e-6) return `${where} 位置`;
      if (Math.abs(u.fx + v.fx) + Math.abs(u.fy + v.fy) >= 1e-6) return `${where} 向き`;
      if (Math.abs(u.men - v.men) + Math.abs(u.morale - v.morale) >= 1e-6) return `${where} 兵数・士気`;
      if (u.status !== v.status) return `${where} 状態`;
      if ((u.target === null ? null : map(u.target)) !== v.target) return `${where} 狙い`;
    }
    return null;
  };
  let bad = check();
  while (!bad && !s1.outcome) {
    step(s1, []);
    step(s2, []);
    bad = check();
  }
  if (bad) return bad;
  const w = s1.outcome!.winner;
  const o = s2.outcome;
  if (!o || o.winner !== (w === 'draw' ? 'draw' : 1 - w) || o.tick !== s1.outcome!.tick || o.reason !== s1.outcome!.reason) return `${label} 決着 ${JSON.stringify(s1.outcome)} / ${JSON.stringify(o)}`;
  return null;
}

describe('対戦の地図（森・丘・川）：ばらつきをなくすと、全部の組で最後の刻みまで鏡写し', () => {
  const ids = listTemplates().map((x) => x.id);
  const make = (field: Field, a: ReturnType<typeof templateArmy>, b: ReturnType<typeof templateArmy>): BattleState => {
    const r = createBattle({ field, armies: [a, b], seed: 7, maxTicks: 1800, timeout: 'compare' });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  const withoutNoise = (fn: () => void): void => {
    const mutable = T as { randomMin: number; randomMax: number };
    const saved = [mutable.randomMin, mutable.randomMax] as const;
    mutable.randomMin = 1;
    mutable.randomMax = 1;
    try {
      fn();
    } finally {
      mutable.randomMin = saved[0];
      mutable.randomMax = saved[1];
    }
  };
  for (const id of ['forest', 'hill', 'river'] as PvpMapId[]) {
    it(`${id}：同じひな形どうし（7つ × 配列の正順・逆順）は、1つの戦いの中で両軍が鏡写し`, () => {
      withoutNoise(() => {
        const bad: string[] = [];
        for (const t of ids) {
          for (const reverse of [false, true]) {
            let a = templateArmy(t, 0);
            let b = templateArmy(t, 1);
            if (reverse) {
              a = a.slice().reverse();
              b = b.slice().reverse();
            }
            const s = make(pvpField(id), a, b);
            const n = a.length;
            const W = s.field.width;
            const H = s.field.height;
            let msg: string | null = null;
            const check = (): void => {
              for (let i = 0; i < n && !msg; i++) {
                const u = s.units[i]!;
                const v = s.units[i + n]!;
                const mirror = u.target === null ? null : (u.target + n) % (2 * n);
                if (Math.abs(u.x - (W - v.x)) + Math.abs(u.y - (H - v.y)) >= 1e-6 || Math.abs(u.fx + v.fx) + Math.abs(u.fy + v.fy) >= 1e-6 || Math.abs(u.men - v.men) + Math.abs(u.morale - v.morale) >= 1e-6 || u.status !== v.status || mirror !== v.target) {
                  msg = `${t}${reverse ? ' 逆順' : ''} 刻み ${s.tick} 部隊 ${i}`;
                }
              }
            };
            check();
            while (!msg && !s.outcome) {
              step(s, []);
              check();
            }
            if (!msg && s.outcome!.winner !== 'draw') msg = `${t}${reverse ? ' 逆順' : ''} 決着 ${JSON.stringify(s.outcome)}`;
            if (msg) bad.push(msg);
          }
        }
        expect(bad).toEqual([]);
      });
    }, 300_000);
    it(`${id}：違うひな形どうし（21組）は、陣営を入れ替えた戦いと鏡写し（位置・向き・兵数・士気・状態・狙い・勝敗）`, () => {
      withoutNoise(() => {
        const bad: string[] = [];
        for (const A of ids) {
          for (const B of ids) {
            if (A >= B) continue;
            const s1 = make(pvpField(id), templateArmy(A, 0), templateArmy(B, 1));
            const s2 = make(pvpField(id), templateArmy(B, 0), templateArmy(A, 1));
            const nA = templateArmy(A, 0).length;
            const nB = templateArmy(B, 0).length;
            const msg = firstMismatch(s1, s2, (i) => (i < nA ? nB + i : i - nA), `${A} 対 ${B}`);
            if (msg) bad.push(msg);
          }
        }
        expect(bad).toEqual([]);
      });
    }, 300_000);
  }
});
