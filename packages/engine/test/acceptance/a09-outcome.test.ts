// A9 決着の判定（design §3.6.4）
import { describe, expect, it } from 'vitest';
import { step, type BattleState } from '../../src/index.ts';
import { battle, p } from '../helpers.ts';

/** 次の損害で敗走させる（決まりの確認のための仕込み） */
function brink(s: BattleState, id: number): void {
  s.units[id]!.morale = 0.001;
}

describe('A9 決着の判定', () => {
  it('本陣が敗走した刻みに決着する（消えるのを待たない）', () => {
    const s = battle([p('hq', 5, 10, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold'), p('hq', 11, 0, 'hold')], { requireHq: true });
    brink(s, 0);
    const ev = step(s, []);
    expect(s.units[0]!.status).toBe('routing');
    expect(s.outcome).toEqual({ winner: 1, reason: 'hq', tick: 0 });
    expect(ev.at(-1)).toEqual({ type: 'end', tick: 0, winner: 1, reason: 'hq' });
  });
  it('本陣以外の最後の1部隊が敗走・全滅した刻みに決着する（理由は wipeout）', () => {
    const s = battle([p('hq', 0, 15, 'hold'), p('infantry', 5, 10, 'hold')], [p('infantry', 5, 9, 'hold'), p('hq', 11, 0, 'hold')], { requireHq: true });
    s.units[1]!.men = 0.01;
    step(s, []);
    expect(s.units[1]!.status).toBe('gone');
    expect(s.outcome).toEqual({ winner: 1, reason: 'wipeout', tick: 0 });
  });
  it('両軍が同じ刻みに条件を満たすと引き分け。どちらかが本陣なら理由は hq', () => {
    const s = battle([p('infantry', 5, 10, 'hold')], [p('infantry', 5, 9, 'hold')]);
    brink(s, 0);
    brink(s, 1);
    step(s, []);
    expect(s.outcome).toEqual({ winner: 'draw', reason: 'wipeout', tick: 0 });
    const t = battle([p('hq', 5, 10, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold'), p('hq', 11, 0, 'hold')], { requireHq: true });
    brink(t, 0);
    brink(t, 2);
    step(t, []);
    expect(t.outcome).toEqual({ winner: 'draw', reason: 'hq', tick: 0 });
  });
  it('決着と時間切れが重なると、決着が優先', () => {
    const s = battle([p('infantry', 5, 10, 'hold'), p('infantry', 0, 15, 'hold')], [p('infantry', 5, 9, 'hold')], { maxTicks: 1 });
    brink(s, 2);
    step(s, []);
    expect(s.outcome).toEqual({ winner: 0, reason: 'wipeout', tick: 0 });
  });
  it('時間切れ：compare は残った兵の割合（百分率に四捨五入）で比べる。勝ち・負け・引き分け', () => {
    const run = (men0: number, men1: number) => {
      const s = battle([p('infantry', 5, 15, 'hold')], [p('infantry', 5, 0, 'hold')], { maxTicks: 3 });
      s.units[0]!.men = men0;
      s.units[1]!.men = men1;
      while (!s.outcome) step(s, []);
      return s.outcome;
    };
    expect(run(80, 70)).toEqual({ winner: 0, reason: 'timeout', tick: 2 });
    expect(run(70, 80)).toEqual({ winner: 1, reason: 'timeout', tick: 2 });
    // 62.4% と 61.6% はどちらも 62% と出るので引き分け（assumptions S7）
    expect(run(62.4, 61.6).winner).toBe('draw');
  });
  it('時間切れ：side0_wins と side0_loses', () => {
    for (const [timeout, winner] of [['side0_wins', 0], ['side0_loses', 1]] as const) {
      const s = battle([p('infantry', 5, 15, 'hold')], [p('infantry', 5, 0, 'hold')], { maxTicks: 5, timeout });
      while (!s.outcome) step(s, []);
      expect(s.outcome).toEqual({ winner, reason: 'timeout', tick: 4 });
    }
  });
  it('ちょうど maxTicks 回の step で終わる', () => {
    const s = battle([p('infantry', 5, 15, 'hold')], [p('infantry', 5, 0, 'hold')], { maxTicks: 1800 });
    let n = 0;
    while (!s.outcome) {
      step(s, []);
      n++;
    }
    expect(n).toBe(1800);
  });
});
