// 「範囲内か」の距離の判定は、陣営を入れ替えて戦場を 180° 回した配置でも同じ結果になる（Codex のレビュー codex-code-2 の P2）。
// 同じはずの距離が、丸めで陣営0では 1.6000000000000014、陣営1では 1.5999999999999934 のように上下に分かれることがある。
// それぞれのしきい値について、すぐ手前・ちょうど（丸めで上下にぶれる距離）・すぐ先の3つの距離で、
// ①1刻み進めたあとの両方の戦いが鏡写しのままであること、②ちょうどの距離がどちらの陣営でも「範囲内」になることを見る。
// 戦場は 10×12 の平地で、配置エリアを戦場全体にする。回した側は、座標を (10 − x, 12 − y) にして陣営を入れ替える。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBattle, step, type BattleState, type BrokenRecord, type Kind, type Placement, type Side, type Stance } from '../src/index.ts';
import { T } from '../src/tuning.ts';
import { openField, place } from './helpers.ts';

const W = 10;
const H = 12;

interface Spec {
  kind: Kind;
  side: Side;
  x: number;
  y: number;
  stance?: Stance;
  morale?: number;
}

/** 回したかどうかで、座標・陣営・id を写す道具。prep で、両方の戦いに同じ意味の値を書き込むのに使う */
interface View {
  s: BattleState;
  /** 場面の中の何番目の部隊か → その戦いでの id */
  id: (k: number) => number;
  x: (v: number) => number;
  y: (v: number) => number;
  side: (v: Side) => Side;
}

interface Scene {
  units: Spec[];
  prep?: (v: View) => void;
}

function build(scene: Scene, rotated: boolean): View {
  const side = (v: Side): Side => (rotated ? ((1 - v) as Side) : v);
  const x = (v: number): number => (rotated ? W - v : v);
  const y = (v: number): number => (rotated ? H - v : v);
  // 陣営ごとに、場面の順のまま並べる。置くマスも 180° 回して対応させる（あとで座標を置き直すので、マスは仮のもの）
  const armies: [Placement[], Placement[]] = [[], []];
  const index: { side: Side; j: number }[] = [];
  for (const u of scene.units) {
    const sd = side(u.side);
    const j = armies[sd].length;
    armies[sd].push({ kind: u.kind, col: sd === 0 ? j : W - 1 - j, row: sd === 0 ? H - 1 : 0, stance: u.stance ?? 'hold' });
    index.push({ side: sd, j });
  }
  const r = createBattle({ field: openField(W, H), armies, seed: 7, maxTicks: 1800, timeout: 'compare', requireHq: false });
  if (!r.ok) throw new Error(`createBattle: ${r.error.message}`);
  const s = r.value;
  const n0 = armies[0].length;
  const id = (k: number): number => {
    const e = index[k]!;
    return e.side === 0 ? e.j : n0 + e.j;
  };
  scene.units.forEach((u, k) => {
    place(s, id(k), x(u.x), y(u.y));
    if (u.morale !== undefined) s.units[id(k)]!.morale = u.morale;
  });
  const v: View = { s, id, x, y, side };
  scene.prep?.(v);
  return v;
}

/** 1刻み進め、両方の戦いが鏡写しのままかを見る。返すのは [そのままの戦い, 回した戦い] */
function runPair(scene: Scene, label: string): [View, View] {
  const a = build(scene, false);
  const b = build(scene, true);
  step(a.s, []);
  step(b.s, []);
  const n = scene.units.length;
  const toK = (v: View, id2: number | null): number | null => {
    if (id2 === null) return null;
    for (let k = 0; k < n; k++) if (v.id(k) === id2) return k;
    return -1;
  };
  for (let k = 0; k < n; k++) {
    const u = a.s.units[a.id(k)]!;
    const w = b.s.units[b.id(k)]!;
    const msg = `${label} 部隊 ${k}`;
    expect(Math.abs(u.x - (W - w.x)) + Math.abs(u.y - (H - w.y)), msg).toBeLessThan(1e-9);
    expect(Math.abs(u.fx + w.fx) + Math.abs(u.fy + w.fy), msg).toBeLessThan(1e-9);
    expect(Math.abs(u.men - w.men), msg).toBeLessThan(1e-9);
    expect(Math.abs(u.morale - w.morale), msg).toBeLessThan(1e-9);
    expect(u.status, msg).toBe(w.status);
    expect(toK(a, u.target), msg).toBe(toK(b, w.target));
    expect(toK(a, u.attacking), msg).toBe(toK(b, w.attacking));
  }
  return [a, b];
}

/**
 * しきい値 range について、すぐ手前（range − 0.01）・ちょうど（at + range。回すと丸めで上下に分かれる）・すぐ先（range + 0.01）の3つで調べる。
 * scene(d) は、調べる2点の距離を d にした場面。exact は、ちょうどの距離を作る (始点, 始点 + range) の始点。
 * inside(v) は、その戦いで「範囲内」と判定されたか
 */
function checkThreshold(name: string, range: number, start: number, scene: (end: number) => Scene, inside: (v: View) => boolean): void {
  // 「ちょうど」が本当に丸めで上下に分かれる距離であることを、先に確かめる（分かれなければ、この検査は意味がない）
  const end = start + range;
  const d0 = Math.abs(end - start);
  const d1 = Math.abs(H - start - (H - end));
  const d1x = Math.abs(W - start - (W - end));
  expect(d0 <= range !== d1 <= range || d0 <= range !== d1x <= range, `${name} のちょうどの距離 ${d0} / ${d1} / ${d1x}`).toBe(true);
  const cases: [string, number, boolean][] = [
    ['すぐ手前', start + range - 0.01, true],
    ['ちょうど', end, true],
    ['すぐ先', start + range + 0.01, false],
  ];
  for (const [label, e, want] of cases) {
    const [a, b] = runPair(scene(e), `${name} ${label}`);
    expect(inside(a), `${name} ${label}：そのまま`).toBe(want);
    expect(inside(b), `${name} ${label}：回した側`).toBe(want);
  }
}

describe('「範囲内か」の判定は、180° 回して陣営を入れ替えても同じ', () => {
  const saved = [T.randomMin, T.randomMax] as const;
  beforeAll(() => {
    const m = T as { randomMin: number; randomMax: number };
    m.randomMin = 1;
    m.randomMax = 1;
  });
  afterAll(() => {
    const m = T as { randomMin: number; randomMax: number };
    m.randomMin = saved[0];
    m.randomMax = saved[1];
  });

  it('近接の距離（meleeRange）：平地だけの戦場でも、ちょうどの距離で両陣営とも近接で戦う', () => {
    // 0.5 と 1.55：そのままは 1.05、回すと 1.0500000000000007
    checkThreshold(
      '近接',
      T.meleeRange,
      0.5,
      (e) => ({ units: [{ kind: 'infantry', side: 0, x: 5, y: 0.5 }, { kind: 'infantry', side: 1, x: 5, y: e }] }),
      (v) => v.s.units[v.id(0)]!.attacking === v.id(1),
    );
  });

  it('弓の射程（archerRange）：ちょうどの距離で両陣営とも撃つ', () => {
    // 0.501 と 6.101：そのままは 5.6、回すと 5.6000000000000005
    checkThreshold(
      '弓',
      T.archerRange,
      0.501,
      (e) => ({ units: [{ kind: 'archer', side: 0, x: 5, y: 0.501 }, { kind: 'infantry', side: 1, x: 5, y: e }] }),
      (v) => v.s.units[v.id(0)]!.attacking === v.id(1),
    );
  });

  it('弓の射程（敗走中の狙いを撃ち続ける）：ちょうどの距離で両陣営とも撃ち続ける', () => {
    checkThreshold(
      '弓・敗走中の狙い',
      T.archerRange,
      0.501,
      (e) => ({
        units: [{ kind: 'archer', side: 0, x: 5, y: 0.501 }, { kind: 'infantry', side: 1, x: 5, y: e }],
        prep: (v) => {
          v.s.units[v.id(0)]!.target = v.id(1);
          v.s.units[v.id(1)]!.status = 'routing';
          v.s.units[v.id(1)]!.routTick = 0;
        },
      }),
      (v) => v.s.units[v.id(0)]!.attacking === v.id(1),
    );
  });

  it('守備の見張り（holdWatchRange）：ちょうどの距離で両陣営とも狙いを取る', () => {
    // 0.501 と 4.501：そのままは 4、回すと 4.000000000000001
    checkThreshold(
      '見張り',
      T.holdWatchRange,
      0.501,
      (e) => ({ units: [{ kind: 'infantry', side: 0, x: 5, y: 0.501 }, { kind: 'infantry', side: 1, x: 5, y: e }] }),
      (v) => v.s.units[v.id(0)]!.target === v.id(1),
    );
  });

  // 支え：U（0番）が正面の敵 E（1番）と近接で戦い、横の x 方向に味方 A（2番）がいる。A は E の近接の距離の外。
  // 「範囲内」は、A がいないとき（A を遠くに置いたとき）より、U の士気の減りが小さいこと
  const supportScene = (kind: Kind, start: number) => (e: number): Scene => ({
    units: [
      { kind: 'infantry', side: 0, x: start, y: 6 },
      { kind: 'infantry', side: 1, x: start, y: 5 },
      { kind, side: 0, x: e, y: 6 },
    ],
  });
  const lessLoss = (kind: Kind, start: number) => {
    const [ref] = runPair(supportScene(kind, start)(start + 6), `${kind} 遠く`);
    const refMorale = ref.s.units[ref.id(0)]!.morale;
    expect(refMorale).toBeLessThan(100);
    return (v: View): boolean => v.s.units[v.id(0)]!.morale > refMorale + 1e-6;
  };

  it('支え（supportRange）：ちょうどの距離の味方を、両陣営とも支えに数える', () => {
    // 0.502 と 2.102：そのままは 1.6000000000000003、回すと 1.5999999999999996
    checkThreshold('支え', T.supportRange, 0.502, supportScene('infantry', 0.502), lessLoss('infantry', 0.502));
  });

  it('本陣の支え（hqSupportRange。士気の減りと、本陣のそばでの回復）：ちょうどの距離の本陣を、両陣営とも数える', () => {
    // 0.509 と 4.009：そのままは 3.5000000000000004、回すと 3.5
    checkThreshold('本陣の支え', T.hqSupportRange, 0.509, supportScene('hq', 0.509), lessLoss('hq', 0.509));
  });

  it('敵の近さによる回復の停止（recoverEnemyRange）：ちょうどの距離の敵がいれば、両陣営とも回復しない', () => {
    // 0.527 と 2.527：そのままは 2、回すと 2.0000000000000018
    checkThreshold(
      '回復の停止',
      T.recoverEnemyRange,
      0.527,
      (e) => ({ units: [{ kind: 'infantry', side: 0, x: 5, y: 0.527, morale: 50 }, { kind: 'infantry', side: 1, x: 5, y: e, morale: 50 }] }),
      (v) => v.s.units[v.id(0)]!.morale <= 50,
    );
  });

  // 前の刻みに敗走・全滅した部隊の記録を、U（0番）から y 方向に e の位置に置く。記録の部隊は、遠くに置いた2番（味方）か1番（敵）
  const brokenScene = (reason: BrokenRecord['reason'], ally: boolean) => (e: number): Scene => ({
    units: [
      { kind: 'infantry', side: 0, x: 5, y: 0.527, morale: 80 },
      { kind: 'infantry', side: 1, x: 9.5, y: 11.5 },
      { kind: 'infantry', side: 0, x: 0.5, y: 11.5 },
    ],
    prep: (v) => {
      const k = ally ? 2 : 1;
      v.s.brokenLastTick = [{ unit: v.id(k), side: v.side(ally ? 0 : 1), x: v.x(5), y: v.y(e), reason, holders: [] }];
    },
  });

  it('味方の敗走（allyRoutedRange）：ちょうどの距離で敗走した味方を、両陣営とも数える', () => {
    checkThreshold('味方の敗走', T.allyRoutedRange, 0.527, brokenScene('routed', true), (v) => v.s.units[v.id(0)]!.morale < 80);
  });

  it('味方の全滅（allyRoutedRange）：ちょうどの距離で全滅した味方を、両陣営とも数える', () => {
    checkThreshold('味方の全滅', T.allyRoutedRange, 0.527, brokenScene('destroyed', true), (v) => v.s.units[v.id(0)]!.morale < 80);
  });

  it('敵の壊滅（enemyBrokenRange）：ちょうどの距離で崩れた敵を、両陣営とも数える', () => {
    // 0.527 と 3.027：そのままは 2.5、回すと 2.5000000000000018。回復（毎刻み 0.15）より大きく増えたかで見る
    checkThreshold('敵の壊滅', T.enemyBrokenRange, 0.527, brokenScene('routed', false), (v) => v.s.units[v.id(0)]!.morale > 80 + 1);
  });
});
