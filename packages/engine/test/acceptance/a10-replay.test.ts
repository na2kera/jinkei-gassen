// A10 再現できる（design §3.9）
import { describe, expect, it } from 'vitest';
import { createBattle, step, type BattleEvent, type BattleState, type OrderInput } from '../../src/index.ts';
import { matchupSetup } from '../../sim/lib.ts';

function fresh(): BattleState {
  const r = createBattle(matchupSetup('line', 'arrow', 12345));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const ordersAt = (tick: number): OrderInput[] =>
  tick === 40 ? [{ side: 0, target: 'all', kind: 'charge' }] : tick === 90 ? [{ side: 1, target: 'center', kind: 'brace' }] : [];

/** 最後まで動かし、毎刻みの出来事を返す */
function runToEnd(s: BattleState): BattleEvent[][] {
  const log: BattleEvent[][] = [];
  while (!s.outcome) log.push(step(s, ordersAt(s.tick)));
  return log;
}

describe('A10 再現できる', () => {
  it('同じ種と同じ入力で2回動かすと、毎刻みの出来事と最後の状態が一致する', () => {
    const a = fresh();
    const b = fresh();
    expect(runToEnd(a)).toEqual(runToEnd(b));
    expect(a).toEqual(b);
  });

  it('途中（号令中、敗走中、突入の直前、戦闘の半ば）で JSON にして戻してから続けても、以後が変わらない', () => {
    // 1回目：基準。各刻みの初めの状態の特徴を記録して、止める刻みを決める
    const ref = fresh();
    const refLog: BattleEvent[][] = [];
    let orderTick = -1;
    let routTick = -1;
    let impactTick = -1;
    while (!ref.outcome) {
      if (orderTick < 0 && ref.units.some((u) => u.order !== null)) orderTick = ref.tick;
      if (routTick < 0 && ref.units.some((u) => u.status === 'routing')) routTick = ref.tick;
      const ev = step(ref, ordersAt(ref.tick));
      if (impactTick < 0 && ev.some((e) => e.type === 'impact')) impactTick = ref.tick - 1; // 突入が起きる step の直前
      refLog.push(ev);
    }
    const mid = Math.floor(ref.tick / 2);
    const points = { 号令中: orderTick, 敗走中: routTick, 突入の直前: impactTick, 戦闘の半ば: mid };
    for (const [name, at] of Object.entries(points)) {
      expect(at, name).toBeGreaterThanOrEqual(0);
      const s = fresh();
      while (s.tick < at) step(s, ordersAt(s.tick));
      const restored = JSON.parse(JSON.stringify(s)) as BattleState;
      const log = runToEnd(restored);
      expect(log, name).toEqual(refLog.slice(at));
      expect(restored, name).toEqual(ref);
    }
  });
});
