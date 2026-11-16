// ひな形（design §3.7）：6〜16 部隊のどの手持ちでも、エリアに収まり、重ならず、全部隊を使い切る。同じ入力からは同じ配置。
import { describe, expect, it } from 'vitest';
import { applyTemplate, listTemplates, MAX_UNITS, plainField, STANDARD_ROSTER, validateArmy, type Kind, type Roster } from '../src/index.ts';

const KINDS: Kind[] = ['infantry', 'shield', 'cavalry', 'archer'];

/** 6〜16 部隊の、いろいろな手持ち（本陣1を含む）。偏った手持ちも入れる */
function rosters(): Roster[] {
  const out: Roster[] = [];
  for (let n = 6; n <= MAX_UNITS; n++) {
    const others = n - 1;
    out.push({ hq: 1, infantry: others });
    out.push({ hq: 1, cavalry: others });
    out.push({ hq: 1, archer: others });
    // 4兵種に順に配る
    const r: Roster = { hq: 1 };
    for (let i = 0; i < others; i++) {
      const k = KINDS[i % 4]!;
      r[k] = (r[k] ?? 0) + 1;
    }
    out.push(r);
    // 2兵種だけ
    out.push({ hq: 1, shield: Math.ceil(others / 2), archer: Math.floor(others / 2) });
  }
  out.push(STANDARD_ROSTER);
  return out;
}

const field = plainField();

describe('ひな形', () => {
  it('7つある', () => {
    expect(listTemplates().map((t) => t.id)).toEqual(['line', 'crane', 'scale', 'arrow', 'ring', 'crescent', 'echelon']);
  });
  for (const t of listTemplates()) {
    it(`${t.id}（${t.name}）：6〜16 部隊で、エリアに収まり、重ならず、全部隊を使い切る（両陣営）`, () => {
      for (const roster of rosters()) {
        for (const side of [0, 1] as const) {
          const ps = applyTemplate(t.id, roster, field.zones[side], side);
          expect(validateArmy(ps, field.zones[side], { maxUnits: MAX_UNITS })).toEqual([]);
          for (const k of [...KINDS, 'hq'] as Kind[]) expect(ps.filter((x) => x.kind === k).length).toBe(roster[k] ?? 0);
          expect(applyTemplate(t.id, roster, field.zones[side], side)).toEqual(ps);
        }
      }
    });
    it(`${t.id}：陣営1の配置は、陣営0の配置を戦場の中心で点対称に写したもの`, () => {
      const a = applyTemplate(t.id, STANDARD_ROSTER, field.zones[0], 0);
      const b = applyTemplate(t.id, STANDARD_ROSTER, field.zones[1], 1);
      expect(b).toEqual(a.map((x) => ({ ...x, col: field.width - 1 - x.col, row: field.height - 1 - x.row })));
    });
  }
  it('本陣は後ろの中央（方円は輪の中心）', () => {
    for (const t of listTemplates()) {
      const ps = applyTemplate(t.id, STANDARD_ROSTER, field.zones[0], 0);
      const hq = ps.find((x) => x.kind === 'hq')!;
      expect([5, 6]).toContain(hq.col);
      const others = ps.filter((x) => x.kind !== 'hq');
      if (t.id === 'ring') {
        // 輪の中心：前にも後ろにも部隊がいる
        expect(others.some((x) => x.row < hq.row)).toBe(true);
        expect(others.some((x) => x.row > hq.row)).toBe(true);
      } else {
        expect(hq.row).toBeGreaterThanOrEqual(Math.max(...others.map((x) => x.row)) - 1);
      }
    }
  });
  it('未知の id には空の配列を返す（例外を投げない）', () => {
    expect(applyTemplate('nope' as never, STANDARD_ROSTER, field.zones[0], 0)).toEqual([]);
  });
});
