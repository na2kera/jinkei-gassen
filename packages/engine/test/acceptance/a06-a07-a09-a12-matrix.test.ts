// A6 1戦の長さ・A7 最強も最弱もない・A9 決着の判定・A12 壊れた状態にならない（どれも総当たり 420 戦で見る）
import { describe, expect, it } from 'vitest';
import { T } from '../../src/tuning.ts';
import type { BattleEvent, BattleState, Side } from '../../src/index.ts';
import { matrixStats, runMatrix, TEMPLATE_IDS, type MatrixGame } from '../../sim/lib.ts';
import { blockedCounter } from '../helpers.ts';

/** 陣営の負けの条件（design §3.6.4）：本陣が active でない／本陣以外がすべて active でない */
function lost(s: BattleState, side: Side): { hq: boolean; wipe: boolean } {
  const mine = s.units.filter((u) => u.side === side);
  const hq = mine.find((u) => u.kind === 'hq');
  const others = mine.filter((u) => u.kind !== 'hq');
  return { hq: hq !== undefined && hq.status !== 'active', wipe: others.length > 0 && others.every((u) => u.status !== 'active') };
}

const finite = (v: number): boolean => typeof v === 'number' && Number.isFinite(v);

describe('総当たり（42通り × 種10個、ふつうの初期状態から）', () => {
  let games: MatrixGame[] = [];
  const problems: string[] = [];
  const reasons = new Set<string>();
  const outcomeProblems: string[] = [];
  /** 戦いごとの、ふさがれ状態の刻みの合計のいちばん長い部隊の値（D8。games と同じ順） */
  const blockedMax: number[] = [];

  it('A12 全刻みで壊れた状態にならない。最後の状態は JSON にして戻しても同じ', () => {
    let seen = { rout: new Set<number>(), destroyed: new Set<number>(), ends: 0 };
    let current: BattleState | null = null;
    let blocked = blockedCounter();
    const onTick = (s: BattleState, ev: BattleEvent[]): void => {
      if (current !== s) {
        current = s;
        seen = { rout: new Set(), destroyed: new Set(), ends: 0 };
        blocked = blockedCounter();
        blockedMax.push(0);
      }
      blocked.onTick(s);
      blockedMax[blockedMax.length - 1] = blocked.maxTicks();
      const W = s.field.width;
      const H = s.field.height;
      for (const u of s.units) {
        if (![u.x, u.y, u.fx, u.fy, u.men, u.morale].every(finite)) problems.push(`有限でない値 ${u.id} @${s.tick}`);
        if (!(u.men >= 0 && u.men <= u.maxMen)) problems.push(`兵数 ${u.id} @${s.tick}`);
        if (!(u.morale >= 0 && u.morale <= 100)) problems.push(`士気 ${u.id} @${s.tick}`);
      }
      const act = s.units.filter((u) => u.status === 'active');
      for (const u of act) {
        if (!(u.x >= T.edgeMargin - 1e-9 && u.x <= W - T.edgeMargin + 1e-9 && u.y >= T.edgeMargin - 1e-9 && u.y <= H - T.edgeMargin + 1e-9)) {
          problems.push(`端の外 ${u.id} @${s.tick}`);
        }
      }
      for (let i = 0; i < act.length; i++) {
        for (let j = i + 1; j < act.length; j++) {
          const a = act[i]!;
          const b = act[j]!;
          if (!(Math.hypot(a.x - b.x, a.y - b.y) >= 0.6)) problems.push(`近すぎる ${a.id}-${b.id} @${s.tick}`);
        }
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
          checkOutcome(s);
        }
      }
      if (s.outcome && JSON.stringify(JSON.parse(JSON.stringify(s))) !== JSON.stringify(s)) problems.push('JSON にして戻すと変わる');
      if (s.outcome) expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    };
    games = runMatrix(undefined, onTick);
    expect(games.length).toBe(420);
    expect(problems.slice(0, 20)).toEqual([]);
  }, 600_000);

  /** A9：決着した刻みの状態が、決着の表と合っているか */
  function checkOutcome(s: BattleState): void {
    const o = s.outcome!;
    reasons.add(o.reason);
    const l = [lost(s, 0), lost(s, 1)] as const;
    const any = (x: { hq: boolean; wipe: boolean }): boolean => x.hq || x.wipe;
    const tag = `${o.reason} ${String(o.winner)} @${o.tick}`;
    if (o.reason === 'timeout') {
      if (s.tick !== s.maxTicks) outcomeProblems.push(`時間切れなのに tick が maxTicks でない ${tag}`);
      if (any(l[0]) || any(l[1])) outcomeProblems.push(`時間切れなのに負けの条件を満たした側がある ${tag}`);
      return;
    }
    if (o.winner === 'draw') {
      if (!(any(l[0]) && any(l[1]))) outcomeProblems.push(`引き分けなのに両軍が条件を満たしていない ${tag}`);
      if (o.reason === 'hq' && !(l[0].hq || l[1].hq)) outcomeProblems.push(`理由が hq なのに本陣が残っている ${tag}`);
      return;
    }
    const loser = o.winner === 0 ? 1 : 0;
    const winner = o.winner;
    if (any(l[winner])) outcomeProblems.push(`勝った側も負けの条件を満たしている ${tag}`);
    if (o.reason === 'hq' && !l[loser].hq) outcomeProblems.push(`理由が hq なのに負けた側の本陣が active ${tag}`);
    if (o.reason === 'wipeout' && !(l[loser].wipe && !l[loser].hq)) outcomeProblems.push(`理由が wipeout なのに条件が合わない ${tag}`);
  }

  it('A9 決着はすべて決着の表のとおり。hq・wipeout・timeout がそれぞれ1回以上出る', () => {
    expect(outcomeProblems.slice(0, 20)).toEqual([]);
    for (const r of ['hq', 'wipeout', 'timeout']) expect(reasons.has(r), r).toBe(true);
  });

  it('A6 決着した戦いの長さの中央値が 40〜120秒。引き分けは 10% 以下。方円を含まない組の時間切れは 10% 以下', () => {
    const st = matrixStats(games);
    expect(st.medianDecided).toBeGreaterThanOrEqual(40);
    expect(st.medianDecided).toBeLessThanOrEqual(120);
    expect(st.drawRate).toBeLessThanOrEqual(0.1);
    expect(st.timeoutRateNoRing).toBeLessThanOrEqual(0.1);
  });

  it('D8 鶴翼が入る120戦で、ふさがれ状態の刻みの合計が 20 秒を超える部隊がない（design §3.6.6）', () => {
    expect(blockedMax.length).toBe(games.length);
    const crane = games.map((g, i) => ({ g, b: blockedMax[i]! })).filter(({ g }) => g.a === 'crane' || g.b === 'crane');
    expect(crane.length).toBe(120);
    const bad = crane.filter(({ b }) => b > 200).map(({ g, b }) => `${g.a} 対 ${g.b} 種${g.seed} ${b / 10}秒`);
    expect(bad).toEqual([]);
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
