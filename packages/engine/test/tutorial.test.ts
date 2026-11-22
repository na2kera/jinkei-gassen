// チュートリアルの面と戦い（design §8.2、§8.9・§8.10 の U1・U2）
import { describe, expect, it } from 'vitest';
import {
  createBattle,
  STAGES,
  STANDARD_HEIGHT,
  STANDARD_WIDTH,
  step,
  summarize,
  TUTORIAL_ARMY,
  TUTORIAL_ORDER,
  TUTORIAL_ORDER_TICK,
  TUTORIAL_SEED,
  TUTORIAL_STAGE,
  TUTORIAL_STANCE,
  tutorialSetup,
  validateStageArmy,
  type BattleEvent,
} from '../src/index.ts';

/** 号令の刻みまで何もせずに進め、次の step で号令を渡し、決着まで進める */
function run(): { outcome: unknown; remaining: [number, number]; orders: BattleEvent[] } {
  const r = createBattle(tutorialSetup());
  if (!r.ok) throw new Error(r.error.message);
  const s = r.value;
  const events: BattleEvent[] = [];
  for (let i = 0; i < TUTORIAL_ORDER_TICK; i++) events.push(...step(s, []));
  expect(s.tick).toBe(TUTORIAL_ORDER_TICK);
  events.push(...step(s, [{ side: 0, target: TUTORIAL_ORDER.target, kind: TUTORIAL_ORDER.kind }]));
  while (!s.outcome) events.push(...step(s, []));
  return { outcome: s.outcome, remaining: summarize(s).remaining, orders: events.filter((e) => e.type === 'order') };
}

describe('チュートリアルの戦い（U1）', () => {
  it('号令の刻みで全軍に突撃をかけると、陣営0が本陣を落として勝つ。決着の刻みは 256', () => {
    const a = run();
    expect(a.outcome).toEqual({ winner: 0, reason: 'hq', tick: 256 });
    // 号令は自軍の1回だけ、刻み 50 に出る
    expect(a.orders).toEqual([{ type: 'order', tick: TUTORIAL_ORDER_TICK, side: 0, target: 'all', kind: 'charge' }]);
  });

  it('2回走らせても、決着の刻みと残りの割合が一致する', () => {
    const a = run();
    const b = run();
    expect(b.outcome).toEqual(a.outcome);
    expect(b.remaining).toEqual(a.remaining);
  });
});

describe('チュートリアルの面（U2）', () => {
  it('STAGES に入っていない', () => {
    expect(STAGES.some((s) => s.id === TUTORIAL_STAGE.id)).toBe(false);
    expect(STAGES.includes(TUTORIAL_STAGE)).toBe(false);
    expect(STAGES).toHaveLength(15);
  });

  it('面のデータ：id・章・番号・名前・手持ち・敵・許すもの', () => {
    expect(TUTORIAL_STAGE).toMatchObject({ id: 'tutorial', chapter: 1, index: 0, name: '遊び方', hint: '', win: { type: 'defeat' } });
    expect(TUTORIAL_STAGE.roster).toEqual({ hq: 1, infantry: 3 });
    expect(TUTORIAL_STAGE.allow).toEqual({ stances: ['hunt'], orders: true, templates: false });
    expect(TUTORIAL_STAGE.enemy.every((p) => p.stance === 'hold')).toBe(true);
    expect(TUTORIAL_STAGE.enemyOrders).toBeUndefined();
    expect(TUTORIAL_STAGE.enemyReserve).toBeUndefined();
    expect(TUTORIAL_STAGE.solution).toEqual(TUTORIAL_ARMY);
    expect(TUTORIAL_STAGE.field.width).toBe(STANDARD_WIDTH);
    expect(TUTORIAL_STAGE.field.height).toBe(STANDARD_HEIGHT);
    expect(TUTORIAL_STAGE.field.terrain.every((t) => t === 'plain')).toBe(true);
  });

  it('自軍の配置に誤りがなく、各マスは陣営0の配置エリアの中', () => {
    expect(validateStageArmy(TUTORIAL_STAGE, TUTORIAL_ARMY)).toEqual([]);
    const z = TUTORIAL_STAGE.field.zones[0];
    for (const p of TUTORIAL_ARMY) {
      expect(p.col >= z.col && p.col < z.col + z.width && p.row >= z.row && p.row < z.row + z.height).toBe(true);
    }
  });

  it('方針を変える部隊は、真ん中の歩兵・本陣狙い。敵の歩兵2つは、その列の左右1列ずつにいる（あいだを抜けて本陣へ行ける並び）', () => {
    const u = TUTORIAL_ARMY[TUTORIAL_STANCE.index]!;
    expect(u.kind).toBe('infantry');
    expect(u.stance).toBe(TUTORIAL_STANCE.stance);
    expect(TUTORIAL_STANCE.stance).toBe('hunt');
    // ほかの歩兵2つと同じ行にいて、列がその2つのあいだ
    const others = TUTORIAL_ARMY.filter((p, i) => p.kind === 'infantry' && i !== TUTORIAL_STANCE.index);
    expect(others).toHaveLength(2);
    for (const o of others) expect(o.row).toBe(u.row);
    const [lo, hi] = others.map((o) => o.col).sort((a, b) => a - b) as [number, number];
    expect(lo).toBeLessThan(u.col);
    expect(hi).toBeGreaterThan(u.col);
    // 敵の歩兵2つは、その列の左右1列ずつ
    const enemyInf = TUTORIAL_STAGE.enemy.filter((p) => p.kind === 'infantry').map((p) => p.col).sort((a, b) => a - b);
    expect(enemyInf).toEqual([u.col - 1, u.col + 1]);
  });

  it('戦いの設定：長さ 1800 刻み、時間切れは負け、予定された号令と遊軍がない、種は固定', () => {
    const s = tutorialSetup();
    expect(s.maxTicks).toBe(1800);
    expect(s.timeout).toBe('side0_loses');
    expect(s.scriptedOrders).toEqual([]);
    expect(s.reserves).toBeUndefined();
    expect(s.scriptedReserves).toBeUndefined();
    expect(s.seed).toBe(TUTORIAL_SEED);
    expect(s.armies[0]).toEqual(TUTORIAL_ARMY);
    // 呼ぶたびに写しを渡す（戦いの中で書き換えられても、元のデータが変わらないように）
    expect(s.armies[0]).not.toBe(TUTORIAL_ARMY);
  });
});
