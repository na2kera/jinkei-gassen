// A6 1戦の長さ・A7 最強も最弱もない・A12 壊れた状態にならない（どれも総当たり 420 戦で見る）
import { describe, expect, it } from 'vitest';
import { T } from '../../src/tuning.ts';
import type { BattleEvent, BattleState } from '../../src/index.ts';
import { matrixStats, runMatrix, TEMPLATE_IDS, type MatrixGame } from '../../sim/lib.ts';

describe('総当たり（42通り × 種10個）', () => {
  let games: MatrixGame[] = [];
  const problems: string[] = [];

  it('A12 全刻みで壊れた状態にならない', () => {
    let seen = { rout: new Set<number>(), destroyed: new Set<number>(), ends: 0 };
    let current: BattleState | null = null;
    const onTick = (s: BattleState, ev: BattleEvent[]): void => {
      if (current !== s) {
        current = s;
        seen = { rout: new Set(), destroyed: new Set(), ends: 0 };
      }
      const W = s.field.width;
      const H = s.field.height;
      const act = s.units.filter((u) => u.status === 'active');
      for (const u of act) {
        if (u.x < T.edgeMargin - 1e-9 || u.x > W - T.edgeMargin + 1e-9 || u.y < T.edgeMargin - 1e-9 || u.y > H - T.edgeMargin + 1e-9) problems.push(`端の外 ${u.id} @${s.tick}`);
      }
      for (let i = 0; i < act.length; i++) {
        for (let j = i + 1; j < act.length; j++) {
          const a = act[i]!;
          const b = act[j]!;
          if (Math.hypot(a.x - b.x, a.y - b.y) < 0.6) problems.push(`近すぎる ${a.id}-${b.id} @${s.tick}`);
        }
      }
      for (const u of s.units) {
        if (!(u.men >= 0 && u.men <= u.maxMen)) problems.push(`兵数 ${u.id} @${s.tick}`);
        if (!(u.morale >= 0 && u.morale <= 100)) problems.push(`士気 ${u.id} @${s.tick}`);
      }
      for (const e of ev) {
        if (e.type === 'rout') {
          if (seen.rout.has(e.unit)) problems.push(`敗走が2回 ${e.unit}`);
          seen.rout.add(e.unit);
        }
        if (e.type === 'destroyed') {
          if (seen.destroyed.has(e.unit)) problems.push(`全滅が2回 ${e.unit}`);
          seen.destroyed.add(e.unit);
        }
        if (e.type === 'end') {
          seen.ends++;
          if (seen.ends > 1) problems.push('決着が2回');
        }
      }
    };
    games = runMatrix(undefined, onTick);
    expect(games.length).toBe(420);
    expect(problems.slice(0, 20)).toEqual([]);
  }, 600_000);

  it('A6 決着した戦いの長さの中央値が 40〜120秒。引き分けは 10% 以下。方円を含まない組の時間切れは 10% 以下', () => {
    const st = matrixStats(games);
    expect(st.medianDecided).toBeGreaterThanOrEqual(40);
    expect(st.medianDecided).toBeLessThanOrEqual(120);
    expect(st.drawRate).toBeLessThanOrEqual(0.1);
    expect(st.timeoutRateNoRing).toBeLessThanOrEqual(0.1);
  });

  it('A7 ほかの6つすべてに 0.6 以上のひな形も、0.4 以下のひな形もない', () => {
    const st = matrixStats(games);
    for (const x of TEMPLATE_IDS) {
      const vs = TEMPLATE_IDS.filter((y) => y !== x).map((y) => st.pair[x]![y]!);
      expect(vs.every((v) => v >= 0.6), `${x} が全部に 0.6 以上: ${vs}`).toBe(false);
      expect(vs.every((v) => v <= 0.4), `${x} が全部に 0.4 以下: ${vs}`).toBe(false);
    }
  });
});
