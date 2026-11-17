// 面 1-2 の作り直しの条件（design §3.10「1-2 の作り直し（2026-11-17）」）。
// 見本の勝ち・星と、星3つの配置（置く順を変えた3通りを含む）は stages.test.ts で確かめている。
import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/index.ts';
import { cavalryCols, isGuarded, isUnguarded, stage12Report, stage12Samples } from '../sim/stage12.ts';

const s12 = STAGES.find((s) => s.id === '1-2')!;

describe('1-2 盾の壁の条件', () => {
  it('敵の騎兵は隣り合う3列に3部隊で、横陣が盾兵を置く列（2・8・9）と重ならない。敵の部隊はすべて前進（本陣を除く）', () => {
    const cols = cavalryCols(s12);
    expect(s12.enemy.filter((p) => p.kind === 'cavalry').length).toBe(3);
    expect(cols.length).toBe(3);
    expect(cols[2]! - cols[0]!).toBe(2);
    for (const c of [2, 8, 9]) expect(cols).not.toContain(c);
    for (const p of s12.enemy) if (p.kind !== 'hq') expect(p.stance).toBe('advance');
  });

  it('変えないもの：手持ち、選べる操作、戦場の大きさ、見本が受けている配置であること', () => {
    expect(s12.roster).toEqual({ hq: 1, infantry: 5, shield: 3 });
    expect(s12.allow).toEqual({ stances: [], orders: false, templates: false });
    expect([s12.field.width, s12.field.height]).toEqual([12, 16]);
    expect(s12.field.terrain.every((t) => t === 'plain')).toBe(true);
    expect(isGuarded(s12.solution, cavalryCols(s12))).toBe(true);
  });

  it('標本は、受けている配置・受けていない配置それぞれ40個で、手持ちの9部隊をすべて置き、決まりを満たす', () => {
    const cols = cavalryCols(s12);
    for (const [kind, ok] of [['guarded', isGuarded], ['unguarded', isUnguarded]] as const) {
      const ps = stage12Samples(s12, kind);
      expect(ps.length).toBe(40);
      expect(new Set(ps.map((p) => JSON.stringify(p))).size).toBe(40);
      for (const p of ps) {
        expect(p.map((x) => x.kind)).toEqual(['hq', 'shield', 'shield', 'shield', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry']);
        expect(new Set(p.map((x) => `${x.col},${x.row}`)).size).toBe(9);
        expect(p[0]!.row).toBeGreaterThanOrEqual(13);
        expect(ok(p, cols)).toBe(true);
      }
    }
  });

  it('条件 1〜4：受けている配置は勝ち、受けていない配置は負け、時間切れと長い膠着がなく、横陣そのままでは勝てない', () => {
    const r = stage12Report(s12);
    // 1. 受けている配置40個のうち36個以上が20戦で18勝以上、800戦の勝率 0.9 以上
    expect(r.guardedGood, JSON.stringify(r)).toBeGreaterThanOrEqual(36);
    expect(r.guardedRate).toBeGreaterThanOrEqual(0.9);
    // 2. 受けていない配置40個の800戦の勝率 0.3 以下
    expect(r.unguardedRate, JSON.stringify(r)).toBeLessThanOrEqual(0.3);
    // 3. 1・2 の全戦、横陣、見本で、時間切れがなく、最後の攻撃から決着まで 20 秒を超える戦いもない
    expect(r.timeouts).toBe(0);
    expect(r.longTails, `最長 ${r.maxTail} 秒`).toBe(0);
    // 4. 見本は18勝以上・星の平均2以上、横陣そのままは10勝以下
    expect(r.solutionWins).toBeGreaterThanOrEqual(18);
    expect(r.solutionStars).toBeGreaterThanOrEqual(2);
    expect(r.lineWins).toBeLessThanOrEqual(10);
  }, 300_000);
});
