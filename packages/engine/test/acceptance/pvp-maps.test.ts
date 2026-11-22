// 対戦用の戦場（design §3.8、§13.4）：どれも上下・左右に対称で、地形は両軍の配置エリアのあいだの行だけ。それぞれで A1 と同じ検査をすべて行い、
// 地形が実際に戦いに関わっていること（平原の同じ戦いと最後の状態が違うこと）を確かめる。
import { describe, expect, it } from 'vitest';
import { createBattle, listTemplates, PVP_MAPS, pvpField, STANDARD_LANE, step, wingOf, type BattleSetup, type BattleState, type Field } from '../../src/index.ts';
import { T } from '../../src/tuning.ts';
import { runSetup, scoreFor, SEEDS_100, templateArmy } from '../../sim/lib.ts';

function mirrorSetup(field: Field, id: Parameters<typeof templateArmy>[0], seed: number, reverse: boolean): BattleSetup {
  let a = templateArmy(id, 0);
  let b = templateArmy(id, 1);
  if (reverse) {
    a = a.slice().reverse();
    b = b.slice().reverse();
  }
  return { field, armies: [a, b], seed, maxTicks: 1800, timeout: 'compare' };
}

/** 両軍の配置エリアのあいだの行（陣営1のエリアのすぐ下から、陣営0のエリアのすぐ上まで）。地図の作りとは別に、配置エリアから数える */
function middleOf(f: Field): number[] {
  const rows: number[] = [];
  for (let r = f.zones[1].row + f.zones[1].height; r < f.zones[0].row; r++) rows.push(r);
  return rows;
}

describe('対戦用の戦場', () => {
  it('4つある：平原・中央の丘・中央の川・両脇の森', () => {
    expect(PVP_MAPS.map((m) => m.id)).toEqual(['plain', 'hill', 'river', 'forest']);
  });
  for (const m of PVP_MAPS) {
    describe(`${m.id}（${m.name}）`, () => {
      const field = pvpField(m.id);
      it('上下・左右に対称（戦場の中心で点対称）で、地形は配置エリアのあいだの行（標準の盤で行 4〜7）だけ。配置エリアは平地', () => {
        const W = field.width;
        const H = field.height;
        const mid = middleOf(field);
        expect(mid.length).toBe(4);
        for (let r = 0; r < H; r++) {
          for (let c = 0; c < W; c++) {
            const t = field.terrain[r * W + c];
            expect(t).toBe(field.terrain[(H - 1 - r) * W + (W - 1 - c)]);
            expect(t).toBe(field.terrain[r * W + (W - 1 - c)]);
            if (!mid.includes(r)) expect(t).toBe('plain');
          }
        }
        expect(field.terrain.includes('wall')).toBe(false);
      });
      for (const t of ['line', 'crane', 'scale'] as const) {
        it(`${t} の鏡写し（種100個）：陣営0の得点率が 0.35〜0.65（種100個の標準誤差は約 0.05。公平さの本当の証拠は、下の「ばらつきなしで最後まで鏡写し」）。配列を逆順にしても同じ`, () => {
          for (const reverse of [false, true]) {
            const pts = SEEDS_100.map((seed) => scoreFor(runSetup(mirrorSetup(field, t, seed, reverse)).state, 0));
            const v = pts.reduce((a, b) => a + b, 0) / pts.length;
            expect(v, reverse ? '逆順' : '正順').toBeGreaterThanOrEqual(0.35);
            expect(v, reverse ? '逆順' : '正順').toBeLessThanOrEqual(0.65);
          }
        }, 300_000);
      }
      it('ばらつきをなくすと、7つのひな形すべてで、最後の刻みまで両軍が完全に鏡写し（位置・向き・兵数・士気・状態・狙い。配列の順も逆にして）', () => {
        const mutable = T as { randomMin: number; randomMax: number };
        const saved = [mutable.randomMin, mutable.randomMax] as const;
        mutable.randomMin = 1;
        mutable.randomMax = 1;
        try {
          for (const { id } of listTemplates()) {
            for (const reverse of [false, true]) {
              const r = createBattle(mirrorSetup(field, id, 7, reverse));
              if (!r.ok) throw new Error(r.error.message);
              const s = r.value;
              const n = s.units.length / 2;
              // 陣営0の i 番目と、陣営1の i 番目が鏡写しの組。狙いの id も n だけずれて対応する
              const mirrorId = (id2: number | null): number | null => (id2 === null ? null : (id2 + n) % (2 * n));
              const check = (): void => {
                for (let i = 0; i < n; i++) {
                  const u = s.units[i]!;
                  const v = s.units[i + n]!;
                  const msg = `${m.id} ${id} ${reverse ? '逆順' : ''} 刻み ${s.tick} 部隊 ${i}`;
                  expect(Math.abs(u.x - (field.width - v.x)) + Math.abs(u.y - (field.height - v.y)), msg).toBeLessThan(1e-6);
                  expect(Math.abs(u.fx + v.fx) + Math.abs(u.fy + v.fy), msg).toBeLessThan(1e-6);
                  expect(Math.abs(u.men - v.men) + Math.abs(u.morale - v.morale), msg).toBeLessThan(1e-6);
                  expect(u.status, msg).toBe(v.status);
                  expect(mirrorId(u.target), msg).toBe(v.target);
                }
              };
              check();
              while (!s.outcome) {
                step(s, []);
                check();
              }
              expect(s.outcome.winner).toBe('draw');
            }
          }
        } finally {
          mutable.randomMin = saved[0];
          mutable.randomMax = saved[1];
        }
      }, 300_000);
      if (m.id !== 'plain') {
        it('地形が実際に戦いに関わっている：平原の同じ戦い（横陣 対 魚鱗、種1）と最後の状態が違う', () => {
          const end = (f: Field): BattleState => runSetup({ field: f, armies: [templateArmy('line', 0), templateArmy('scale', 1)], seed: 1, maxTicks: 1800, timeout: 'compare' }).state;
          const a = end(field);
          const b = end(pvpField('plain'));
          expect(JSON.stringify(a.units)).not.toBe(JSON.stringify(b.units));
        }, 60_000);
      }
    });
  }
});

// 通り道に地形を置く・置かないを値で確かめる（design §13.4）。対称のテストは、左右に同じ誤りがあっても通ってしまうため
describe('対戦用の戦場と通り道', () => {
  const at = (f: Field, col: number, row: number): string => f.terrain[row * f.width + col]!;
  const lanes = (f: Field): number[] => {
    const out: number[] = [];
    for (let k = 0; k < STANDARD_LANE; k++) out.push(k, f.width - 1 - k);
    return out;
  };
  it('標準の盤には両端に通り道があり、配置エリアは通り道を除いた列', () => {
    const f = pvpField('plain');
    expect(lanes(f)).toEqual([0, f.width - 1]);
    for (const z of f.zones) {
      expect(z.col).toBe(STANDARD_LANE);
      expect(z.col + z.width).toBe(f.width - STANDARD_LANE);
    }
  });
  it('平原：全部平地', () => {
    expect(pvpField('plain').terrain.every((t) => t === 'plain')).toBe(true);
  });
  it('中央の川：あいだの内側の2行で、通り道の列を含む全部の列が川。ほかの行に川はない', () => {
    const f = pvpField('river');
    const mid = middleOf(f);
    const inner = mid.slice(1, 3);
    for (let r = 0; r < f.height; r++) {
      for (let c = 0; c < f.width; c++) expect(at(f, c, r), `(${c}, ${r})`).toBe(inner.includes(r) ? 'river' : 'plain');
    }
    for (const r of inner) for (const c of lanes(f)) expect(at(f, c, r)).toBe('river');
  });
  it('両脇の森：あいだの4行で、通り道の列とその隣の2列が森。まん中の4列は平地', () => {
    const f = pvpField('forest');
    const W = f.width;
    for (const r of middleOf(f)) {
      for (let c = 0; c < W; c++) {
        const side = c <= 2 || c >= W - 3;
        expect(at(f, c, r), `(${c}, ${r})`).toBe(side ? 'forest' : 'plain');
      }
      for (const c of lanes(f)) expect(at(f, c, r)).toBe('forest');
    }
    // 開いている列は 4（列 3〜6）
    const open = [...Array(W).keys()].filter((c) => middleOf(f).every((r) => at(f, c, r) === 'plain'));
    expect(open).toEqual([3, 4, 5, 6]);
  });
  it('中央の丘：通り道の列に丘がない。丘は号令の「中央」の列（wingOf が center を返す列）だけ、あいだの内側の2行に', () => {
    const f = pvpField('hill');
    const inner = middleOf(f).slice(1, 3);
    for (const c of lanes(f)) for (let r = 0; r < f.height; r++) expect(at(f, c, r)).not.toBe('hill');
    for (let r = 0; r < f.height; r++) {
      for (let c = 0; c < f.width; c++) {
        const want = inner.includes(r) && wingOf(c, f, 0) === 'center' && wingOf(c, f, 1) === 'center';
        expect(at(f, c, r), `(${c}, ${r})`).toBe(want ? 'hill' : 'plain');
      }
    }
    expect(f.terrain.filter((t) => t === 'hill')).toHaveLength(8);
  });
});
