// A15 隠す情報が漏れない（design §3.4、§3.9）
import { describe, expect, it } from 'vitest';
import { createBattle, step, summarize, viewFor, type BattleEvent } from '../../src/index.ts';
import { matchupSetup } from '../../sim/lib.ts';

const ALLOWED = ['id', 'side', 'kind', 'wing', 'x', 'y', 'fx', 'fy', 'men', 'maxMen', 'morale', 'status', 'order', 'attacking'];
const EVENT_KEYS: Record<BattleEvent['type'], string[]> = {
  order: ['type', 'tick', 'side', 'target', 'kind'],
  rout: ['type', 'tick', 'unit'],
  destroyed: ['type', 'tick', 'unit'],
  impact: ['type', 'tick', 'attacker', 'defender', 'facing'],
  end: ['type', 'tick', 'winner', 'reason'],
};

describe('A15 隠す情報が漏れない', () => {
  it('viewFor(state, 0) の陣営1の部隊には、決めた項目以外の鍵がなく、stance もない。自軍には stance がある。both は全部に stance', () => {
    const r = createBattle(matchupSetup('crane', 'arrow', 3));
    if (!r.ok) throw new Error();
    const s = r.value;
    let n = 0;
    while (!s.outcome) {
      const ev = step(s, s.tick === 30 ? [{ side: 1, target: 'all', kind: 'charge' }] : []);
      for (const e of ev) expect(Object.keys(e).sort()).toEqual([...EVENT_KEYS[e.type]].sort());
      if (s.tick % 50 === 0) {
        for (const viewer of [0, 1] as const) {
          const v = viewFor(s, viewer);
          expect(Object.keys(v).sort()).toEqual(['maxTicks', 'ordersLeft', 'outcome', 'tick', 'units']);
          for (const u of v.units) {
            const keys = Object.keys(u).sort();
            if (u.side === viewer) expect(keys).toEqual([...ALLOWED, 'stance'].sort());
            else expect(keys).toEqual([...ALLOWED].sort());
          }
        }
        expect(viewFor(s, 'both').units.every((u) => u.stance !== undefined)).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(3);
    // 場面は状態の複製ではない（書き換えても状態は変わらない）
    const v = viewFor(s, 0);
    v.units[0]!.men = -1;
    expect(s.units[0]!.men).not.toBe(-1);
    // 振り返りは決着後に出せる
    expect(summarize(s).units.length).toBe(s.units.length);
  });
  it('attacking は、その刻みに実際に攻撃した相手。向かっている途中の部隊では null。両軍ぶんが見える', () => {
    const r = createBattle(matchupSetup('line', 'line', 5));
    if (!r.ok) throw new Error();
    const s = r.value;
    step(s, []);
    // 開戦直後は、どの部隊も狙いに向かって動いているだけで、まだ攻撃していない
    const v0 = viewFor(s, 0);
    expect(v0.units.every((u) => u.attacking === null)).toBe(true);
    expect(s.units.some((u) => u.target !== null)).toBe(true);
    let sawBoth = false;
    while (!s.outcome && !sawBoth) {
      step(s, []);
      const v = viewFor(s, 0);
      for (const u of v.units) {
        const real = s.units[u.id]!;
        expect(u.attacking).toBe(real.attacking);
        if (u.attacking !== null) {
          // 攻撃した相手は、その刻みの狙いでもある（同じ刻みに敗走した部隊は狙いが外れるので除く）
          if (real.status === "active") expect(real.target).toBe(u.attacking);
          expect(s.units[u.attacking]!.side).not.toBe(u.side);
        }
      }
      sawBoth = v.units.some((u) => u.side === 0 && u.attacking !== null) && v.units.some((u) => u.side === 1 && u.attacking !== null);
    }
    expect(sawBoth).toBe(true);
  });
});
