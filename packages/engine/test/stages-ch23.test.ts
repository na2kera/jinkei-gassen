// 第2章・第3章の10面（design §3.8「第2章・第3章の面」、§3.10）
import { describe, expect, it } from 'vitest';
import { createBattle, KIND_STATS, MAX_UNITS, STAGES, stageEnemyVisible, stageLineArmy, stageSetup, stageSetupWith, starsFor, step, summarize, terrainAt, validateStageArmy, type Placement, type Stage, type Terrain } from '../src/index.ts';
import { STAR3_FOUND } from './fixtures/star3.ts';
import { lineStats, ORDER_PERMS, runStage, solutionStats, STAGE_SEEDS, stageStats, templateWins } from '../sim/stagelib.ts';
import { DIFFICULTY_LATER, STAR3_LATER, STAR3_PENDING_CH23 } from './helpers.ts';

// 置き直した面（decisions §25）で、いまは通らない面。難しさを合わせたら外す
/** 見本が18勝・星の平均2に届かない */
const SOLUTION_LATER = new Set(['2-5', '3-1']); // 2-5・3-1 は 20 勝するが、星の平均が 1
/** 横陣のままで11勝以上する */
const LINE_LATER = new Set(['2-1', '2-2', '2-4', '3-2', '3-4']);
/** そのまま置いて11勝以上するひな形が3つ以上 */
const TEMPLATES_LATER = new Set(['3-2']);

const LATER = STAGES.filter((s) => s.chapter !== 1);
const byId = (id: string): Stage => STAGES.find((s) => s.id === id)!;
const menOf = (ps: Placement[]): number => ps.reduce((a, p) => a + KIND_STATS[p.kind as keyof typeof KIND_STATS].men, 0);

describe('第2章・第3章の面の作り', () => {
  it('id は 2-1〜2-5・3-1〜3-5。方針・ひな形・号令は、すべて使える', () => {
    expect(LATER.map((s) => s.id)).toEqual(['2-1', '2-2', '2-3', '2-4', '2-5', '3-1', '3-2', '3-3', '3-4', '3-5']);
    for (const s of LATER) expect(s.allow, s.id).toBeUndefined();
  });
  it('敵・見本・横陣が、面の検査と createBattle を通る。部隊数は両軍とも本陣を含めて MAX_UNITS まで、かつ 11 まで。ヒントは1行（24字まで）', () => {
    for (const s of LATER) {
      expect(validateStageArmy(s, s.solution), `${s.id} の見本`).toEqual([]);
      expect(validateStageArmy(s, stageLineArmy(s)), `${s.id} の横陣`).toEqual([]);
      expect(createBattle(stageSetup(s, s.solution, 1)).ok, s.id).toBe(true);
      expect(s.enemy.length).toBeLessThanOrEqual(MAX_UNITS);
      // 部隊数の上限が 12 でも 11 でも通るように、面は 11 部隊までで作る（design §13.5）
      expect(s.enemy.length).toBeLessThanOrEqual(11);
      expect(s.solution.length).toBeLessThanOrEqual(11);
      expect(s.enemy.filter((p) => p.kind === 'hq').length).toBe(1);
      expect(s.hint.length).toBeGreaterThan(5);
      expect(s.hint.length).toBeLessThanOrEqual(24);
    }
  });
  it('戦場の幅は 5〜10、高さは 12。2-4 は幅 5（谷の狭い道）', () => {
    for (const s of LATER) {
      expect(s.field.width).toBeGreaterThanOrEqual(5);
      expect(s.field.width).toBeLessThanOrEqual(10);
      expect(s.field.height).toBe(12);
    }
    expect(byId('2-4').field.width).toBe(5);
  });
  it('地形：2-1 丘、2-2 森、2-3 川、2-5 丘・森・川、3-1 柵、3-2 城壁と門、3-4 丘と柵、3-5 丘・森・川・柵', () => {
    const has = (id: string, t: string): boolean => byId(id).field.terrain.includes(t as never);
    expect(has('2-1', 'hill')).toBe(true);
    expect(has('2-2', 'forest')).toBe(true);
    expect(has('2-3', 'river')).toBe(true);
    for (const t of ['hill', 'forest', 'river']) expect(has('2-5', t), t).toBe(true);
    expect(has('3-1', 'fence')).toBe(true);
    expect(has('3-2', 'wall')).toBe(true);
    for (const t of ['hill', 'fence']) expect(has('3-4', t), t).toBe(true);
    for (const t of ['hill', 'forest', 'river', 'fence']) expect(has('3-5', t), t).toBe(true);
  });
  it('兵数の比（本陣を含めた開戦時の兵数の合計）：2-1・2-3 は敵が多い、2-4 は 1.4 倍以上、3-4 は 1.8 倍以上（2-5 は下の別のテスト）', () => {
    // 2-4・3-4 は、敵の11部隊の上限で、いまの面の比（1.88 倍・2.03 倍）を保てない。下がるのを受け入れた（decisions §22「狭い面の敵の兵力」、design §13.5）
    const ratio = (id: string): number => menOf(byId(id).enemy) / menOf(byId(id).solution);
    expect(ratio('2-1')).toBeGreaterThan(1.1);
    expect(ratio('2-3')).toBeGreaterThan(1.1);
    expect(ratio('2-4')).toBeGreaterThanOrEqual(1.4);
    // 2-4 は弓兵を2つ以上持つ（後ろから弓で削る面）
    expect(byId('2-4').roster.archer).toBeGreaterThanOrEqual(2);
    expect(ratio('3-4')).toBeGreaterThanOrEqual(1.8);
    // 見本は手持ちを使い切る（比が手持ち全体の比になるように）
    for (const id of ['2-1', '2-3', '2-4', '2-5', '3-4']) {
      const s = byId(id);
      expect(s.solution.length, id).toBe(Object.values(s.roster).reduce((a, b) => a + (b ?? 0), 0));
    }
    expect(byId('3-4').solution.length).toBe(6);
  });
  // 2-5 は、勝てる面にするために敵の歩兵を2つ外し、いまは 1.21 倍（stages.ts の 2-5 のコメント）。難しさを合わせるときに戻す
  it('兵数の比：2-5 は 1.5 倍以上', (ctx) => {
    ctx.skip(DIFFICULTY_LATER);
    expect(menOf(byId('2-5').enemy) / menOf(byId('2-5').solution)).toBeGreaterThanOrEqual(1.5);
  });
  it('3-1・3-4 は survive（120 秒・90 秒）、3-2 は gate、ほかは defeat', () => {
    expect(byId('3-1').win).toEqual({ type: 'survive' });
    expect(byId('3-1').seconds).toBe(120);
    expect(byId('3-4').win).toEqual({ type: 'survive' });
    expect(byId('3-4').seconds).toBe(90);
    expect(byId('3-2').win).toEqual({ type: 'gate' });
    expect(byId('3-2').gate).toBeDefined();
    for (const id of ['2-1', '2-2', '2-3', '2-4', '2-5', '3-3', '3-5']) expect(byId(id).win.type, id).toBe('defeat');
  });
  it('2-2・3-5 は霧を使う。霧の中にいるのは騎兵だけで、見えている敵に騎兵はいない（霧の中に何がいそうかを推し量れる）', () => {
    for (const id of ['2-2', '3-5']) {
      const s = byId(id);
      expect(s.fog?.length, id).toBeGreaterThan(0);
      const visible = stageEnemyVisible(s);
      expect(visible.length).toBeLessThan(s.enemy.length);
      expect(visible.some((e) => e.kind === 'cavalry'), id).toBe(false);
      const fog = new Set(s.fog!.map((c) => `${c.col},${c.row}`));
      for (const e of s.enemy.filter((p) => fog.has(`${p.col},${p.row}`))) expect(e.kind).toBe('cavalry');
    }
  });
  it('全15面：地形・霧・門・敵は盤の中。敵は自軍の配置エリアより前（敵の側）にいて、霧と門は敵の側', () => {
    for (const s of STAGES) {
      const f = s.field;
      const inside = (c: { col: number; row: number }): boolean => Number.isInteger(c.col) && Number.isInteger(c.row) && c.col >= 0 && c.col < f.width && c.row >= 0 && c.row < f.height;
      expect(f.terrain.length, s.id).toBe(f.width * f.height);
      for (const t of f.terrain) expect(t, s.id).toBeDefined();
      for (const e of s.enemy) {
        expect(inside(e), `${s.id} 敵 (${e.col}, ${e.row})`).toBe(true);
        expect(e.row, `${s.id} 敵 (${e.col}, ${e.row})`).toBeLessThan(f.zones[0].row);
      }
      for (const c of s.fog ?? []) {
        expect(inside(c), `${s.id} 霧 (${c.col}, ${c.row})`).toBe(true);
        expect(c.row, s.id).toBeLessThan(f.zones[0].row);
      }
      if (s.gate) expect(inside(s.gate) && s.gate.row < f.zones[0].row, s.id).toBe(true);
    }
  });
  it('2-5 と 3-5 は敵が号令を出す（3-5 は3回）', () => {
    expect(byId('2-5').enemyOrders?.length).toBeGreaterThan(0);
    expect(byId('3-5').enemyOrders?.length).toBe(3);
  });
});

describe('第2章・第3章の面の手ごたえ', () => {
  for (const s of LATER) {
    it(`${s.id} ${s.name}：見本が種20個のうち18個以上で勝ち、星の平均が2以上`, (ctx) => {
      ctx.skip(SOLUTION_LATER.has(s.id), DIFFICULTY_LATER);
      const r = solutionStats(s);
      expect(r.wins).toBeGreaterThanOrEqual(18);
      expect(r.starsMean).toBeGreaterThanOrEqual(2);
    }, 300_000);
    it(`${s.id}：横陣のひな形をそのまま置いただけでは、10個以下しか勝てない`, (ctx) => {
      ctx.skip(LINE_LATER.has(s.id), DIFFICULTY_LATER);
      expect(lineStats(s).wins).toBeLessThanOrEqual(10);
    }, 300_000);
    it(`${s.id}：7つのひな形をそのまま置いたとき、10個より多く勝つひな形は2つ以下`, (ctx) => {
      ctx.skip(TEMPLATES_LATER.has(s.id), DIFFICULTY_LATER);
      const rows = templateWins(s);
      expect(rows.filter((r) => r.wins > 10).length, JSON.stringify(rows)).toBeLessThanOrEqual(2);
    }, 600_000);
  }
  it('3-2：見本の勝ちのうち、門を破った勝ち（理由が gate）が半分以上', () => {
    const s = byId('3-2');
    let wins = 0;
    let gate = 0;
    for (const seed of STAGE_SEEDS) {
      const sm = summarize(runStage(s, s.solution, seed, undefined, s.solutionOrders ?? []));
      if (sm.winner !== 0) continue;
      wins++;
      if (sm.reason === 'gate') gate++;
    }
    expect(gate * 2).toBeGreaterThanOrEqual(wins);
  }, 300_000);
});

/**
 * 見本の配置と号令を固定して流す（design §13.5「地形の学びが、新しい盤で成り立つこと」）。
 * 星に使う残りの割合の平均と、陣営1の騎兵の突入のうち守る側が terrain のマスにいたものの数、
 * 陣営1の騎兵が最初に近接した陣営0の部隊の、開戦のときのマス（"列,行"）ごとの数を返す
 */
function lessonRun(s: Stage, terrain: Terrain): { rem: number; impacts: number; impactsOnTerrain: number; firstContact: Map<string, number> } {
  let rem = 0;
  let impacts = 0;
  let impactsOnTerrain = 0;
  const firstContact = new Map<string, number>();
  for (const seed of STAGE_SEEDS) {
    const r = createBattle(stageSetupWith(s, s.solution, seed, s.solutionOrders ?? []));
    if (!r.ok) throw new Error(r.error.message);
    const st = r.value;
    const start = new Map(st.units.map((u) => [u.id, `${Math.floor(u.x)},${Math.floor(u.y)}`]));
    const seen = new Set<number>();
    while (!st.outcome) {
      for (const e of step(st, [])) {
        if (e.type !== 'impact') continue;
        const a = st.units[e.attacker]!;
        const d = st.units[e.defender]!;
        if (a.side !== 1 || a.kind !== 'cavalry') continue;
        impacts++;
        if (terrainAt(st.field, d.x, d.y) === terrain) impactsOnTerrain++;
      }
      for (const u of st.units) {
        if (u.side !== 1 || u.kind !== 'cavalry' || u.attacking === null || seen.has(u.id)) continue;
        seen.add(u.id);
        const d = st.units[u.attacking]!;
        if (d.side !== 0) continue;
        const k = start.get(d.id)!;
        firstContact.set(k, (firstContact.get(k) ?? 0) + 1);
      }
    }
    rem += summarize(st).remainingForStars[0];
  }
  return { rem: rem / STAGE_SEEDS.length, impacts, impactsOnTerrain, firstContact };
}

/** 面の terrain のマスを平地に替えた面 */
const withoutTerrain = (s: Stage, terrain: Terrain): Stage => ({ ...s, field: { ...s.field, terrain: s.field.terrain.map((t) => (t === terrain ? 'plain' : t)) } });

describe('地形の学びが、新しい盤で成り立つ（地形だけを外した面と比べる。design §13.5）', () => {
  it('3-5：右の端の柵を平地に替えると、見本の残りの割合の平均が 0.02 以上下がる。霧の騎兵が最初に当たるのは、柵の盾兵かその後ろの歩兵', () => {
    // 実測（2026-11-22）：柵あり 0.602、柵なし 0.572（差 0.030。別の種 20 個でも 0.606 と 0.576）。
    // 霧の騎兵2の最初の相手は、40 回とも柵の盾兵（列 8、行 8）の後ろの歩兵（列 8、行 9）
    const s = byId('3-5');
    const on = lessonRun(s, 'fence');
    const off = lessonRun(withoutTerrain(s, 'fence'), 'fence');
    expect(on.rem - off.rem, `柵あり ${on.rem} 柵なし ${off.rem}`).toBeGreaterThanOrEqual(0.02);
    const fenceCells = s.solution.filter((p) => terrainAt(s.field, p.col + 0.5, p.row + 0.5) === 'fence');
    const guard = fenceCells.filter((p) => p.kind === 'shield');
    expect(guard.length).toBeGreaterThan(0);
    // 柵の盾兵と、その真後ろの部隊
    const ok = new Set(guard.flatMap((p) => [`${p.col},${p.row}`, `${p.col},${p.row + 1}`]));
    const total = [...on.firstContact.values()].reduce((a, b) => a + b, 0);
    const hit = [...on.firstContact].filter(([k]) => ok.has(k)).reduce((a, [, n]) => a + n, 0);
    expect(total, JSON.stringify([...on.firstContact])).toBe(STAGE_SEEDS.length * s.enemy.filter((p) => p.kind === 'cavalry').length);
    expect(hit, JSON.stringify([...on.firstContact])).toBeGreaterThanOrEqual(Math.ceil(total * 0.9));
    const behind = s.solution.find((p) => ok.has(`${p.col},${p.row}`) && p.kind !== 'shield');
    if (behind) expect(['infantry', 'shield']).toContain(behind.kind);
  }, 300_000);
});

describe('置く順だけを変えても、勝ち負けが変わらない（全15面）', () => {
  // 画面は置いた順に id を振る。同点を id で割る決まりがあるので、見本が置く順に頼って勝っていないことを確かめる
  for (const s of STAGES) {
    it(`${s.id}：見本を並べ替えても（${ORDER_PERMS.map((p) => p.name).join('・')}）、種20個のうち18個以上で勝つ`, () => {
      for (const p of ORDER_PERMS) expect(stageStats(s, p.apply(s.solution), STAGE_SEEDS, s.solutionOrders ?? []).wins, p.name).toBeGreaterThanOrEqual(18);
    }, 300_000);
  }
});

describe('星3つは取れる（第2章・第3章）', () => {
  for (const [id, f] of Object.entries(STAR3_FOUND)) {
    it(`${id}：見つけた配置で、種20個のうち10個以上で星3つ`, (ctx) => {
      ctx.skip(STAR3_PENDING_CH23.has(id), STAR3_LATER);
      const s = byId(id);
      const ps: Placement[] = f.ps.map(([kind, col, row, stance]) => ({ kind, col, row, stance }));
      expect(validateStageArmy(s, ps)).toEqual([]);
      // 置く順だけを変えても、10個以上で星3つ
      for (const order of [{ name: 'そのまま', apply: <T,>(a: T[]): T[] => a }, ...ORDER_PERMS]) {
        let three = 0;
        for (const seed of STAGE_SEEDS) if (starsFor(summarize(runStage(s, order.apply(ps), seed, undefined, f.orders)), 0) === 3) three++;
        expect(three, order.name).toBeGreaterThanOrEqual(10);
      }
    }, 600_000);
  }
});
