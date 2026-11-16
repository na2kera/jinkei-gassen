// 陣形名の判定（design §3.7）
import { describe, expect, it } from 'vitest';
import { applyTemplate, formationScores, listTemplates, plainField, recognizeFormation, STANDARD_ROSTER, type Placement, type Roster, type Side } from '../src/index.ts';

const field = plainField();
const ROSTERS: Record<string, Roster> = {
  R15: STANDARD_ROSTER,
  '8部隊': { hq: 1, infantry: 3, shield: 2, cavalry: 1, archer: 1 },
  '11部隊': { hq: 1, infantry: 4, shield: 2, cavalry: 2, archer: 2 },
  '14部隊': { hq: 1, infantry: 5, shield: 3, cavalry: 2, archer: 3 },
};

/** 決まった列の乱数（テストを毎回同じにするため） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('recognizeFormation', () => {
  for (const [name, roster] of Object.entries(ROSTERS)) {
    for (const side of [0, 1] as Side[]) {
      it(`7つのひな形を ${name} で並べたものは、自分の名前で判定される（陣営${side}）`, () => {
        for (const t of listTemplates()) {
          const ps = applyTemplate(t.id, roster, field.zones[side], side);
          expect(recognizeFormation(ps, field.zones[side], side), `${t.id}`).toEqual({ id: t.id, name: t.name });
        }
      });
    }
  }

  it('2〜3部隊を動かしても、点が 0.75 以上なら判定が保たれる', () => {
    const zone = field.zones[0];
    let checked = 0;
    for (const t of listTemplates()) {
      const base = applyTemplate(t.id, STANDARD_ROSTER, zone, 0);
      for (const moves of [2, 3]) {
        const rnd = lcg(moves * 31 + t.id.length);
        const ps: Placement[] = base.map((x) => ({ ...x }));
        const taken = new Set(ps.map((x) => `${x.col},${x.row}`));
        let moved = 0;
        for (let i = 0; i < ps.length && moved < moves; i++) {
          const x = ps[i]!;
          if (x.kind === 'hq') continue;
          // 空いているマスへ1マスずらす
          for (const [dc, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
            const col = x.col + dc;
            const row = x.row + dr;
            if (col < zone.col || col >= zone.col + zone.width || row < zone.row || row >= zone.row + zone.height || taken.has(`${col},${row}`)) continue;
            if (rnd() < 0.3) continue;
            taken.delete(`${x.col},${x.row}`);
            x.col = col;
            x.row = row;
            taken.add(`${col},${row}`);
            moved++;
            break;
          }
        }
        const top = formationScores(ps, zone, 0).sort((a, b) => b.score - a.score);
        const mine = top.find((s) => s.id === t.id)!;
        const other = top.filter((s) => s.id !== t.id)[0]!;
        if (mine.score >= 0.75 && mine.score - other.score >= 0.05) {
          expect(recognizeFormation(ps, zone, 0)?.id, `${t.id} を ${moves} 部隊動かした`).toBe(t.id);
          checked++;
        }
      }
    }
    // R15（本陣以外14部隊）で 3 部隊までなら点は 11/14 ≒ 0.79 以上なので、ほとんどの場合で確かめられる
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('ばらばらに置いたものは null', () => {
    const zone = field.zones[0];
    for (let trial = 0; trial < 20; trial++) {
      const rnd = lcg(1000 + trial);
      const cells = new Set<string>();
      const ps: Placement[] = [{ kind: 'hq', col: 5, row: 15, stance: 'hold' }];
      cells.add('5,15');
      const kinds = ['infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'shield', 'shield', 'shield', 'cavalry', 'cavalry', 'cavalry', 'archer', 'archer', 'archer'] as const;
      for (const kind of kinds) {
        for (;;) {
          const col = Math.floor(rnd() * 12);
          const row = 10 + Math.floor(rnd() * 6);
          if (cells.has(`${col},${row}`)) continue;
          cells.add(`${col},${row}`);
          ps.push({ kind, col, row, stance: 'advance' });
          break;
        }
      }
      expect(recognizeFormation(ps, zone, 0), `試行 ${trial}`).toBeNull();
    }
  });

  it('横にずらして置いても判定される（横 ±2 まで）', () => {
    const zone = field.zones[0];
    for (const t of listTemplates()) {
      const base = applyTemplate(t.id, ROSTERS['8部隊']!, zone, 0);
      for (const dx of [-2, -1, 1, 2]) {
        const ps = base.map((x) => ({ ...x, col: x.col + dx }));
        if (ps.some((x) => x.col < 0 || x.col > 11)) continue;
        expect(recognizeFormation(ps, zone, 0)?.id, `${t.id} を ${dx} 列ずらした`).toBe(t.id);
      }
    }
  });

  it('雁行は、左右を返した向きも雁行', () => {
    const zone = field.zones[0];
    const ps = applyTemplate('echelon', STANDARD_ROSTER, zone, 0).map((x) => ({ ...x, col: 11 - x.col }));
    expect(recognizeFormation(ps, zone, 0)).toEqual({ id: 'echelon', name: '雁行' });
  });

  it('本陣だけ・空・壊れた値は null（例外を投げない）', () => {
    const zone = field.zones[0];
    expect(recognizeFormation([], zone, 0)).toBeNull();
    expect(recognizeFormation([{ kind: 'hq', col: 5, row: 15, stance: 'hold' }], zone, 0)).toBeNull();
    for (const v of [null, undefined, 1, 'x', {}, [null], [{ kind: 'x' }]]) {
      expect(() => recognizeFormation(v as never, zone, 0)).not.toThrow();
      expect(recognizeFormation(v as never, zone, 0)).toBeNull();
      expect(() => recognizeFormation([], v as never, 0)).not.toThrow();
      expect(() => recognizeFormation([], zone, v as never)).not.toThrow();
    }
  });
});
