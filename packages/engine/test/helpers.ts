// テスト用の小さな道具。場面は「戦場全体を両陣営の配置エリアにした戦場」で作り、必要なら createBattle のあとで値を書き換える。

import { createBattle, plainField, type BattleSetup, type BattleState, type Field, type Kind, type Placement, type Side, type Stance } from '../src/index.ts';

export function openField(width = 12, height = 16): Field {
  const f = plainField(width, height);
  f.zones = [
    { col: 0, row: 0, width, height },
    { col: 0, row: 0, width, height },
  ];
  return f;
}

export function p(kind: Kind, col: number, row: number, stance: Stance = 'advance'): Placement {
  return { kind, col, row, stance };
}

export function battle(a: Placement[], b: Placement[], extra: Partial<BattleSetup> = {}): BattleState {
  const r = createBattle({ field: openField(), armies: [a, b], seed: 1, maxTicks: 1800, timeout: 'compare', requireHq: false, ...extra });
  if (!r.ok) throw new Error(`createBattle: ${r.error.message} ${JSON.stringify(r.error.armyErrors ?? [])}`);
  return r.value;
}

/** 部隊を (x, y) に置き直し、持ち場もそこにする */
export function place(s: BattleState, id: number, x: number, y: number): void {
  const u = s.units[id]!;
  u.x = x;
  u.y = y;
  u.home = { x, y };
}

/** 向きを (fx, fy) にする */
export function face(s: BattleState, id: number, fx: number, fy: number): void {
  const l = Math.hypot(fx, fy);
  s.units[id]!.fx = fx / l;
  s.units[id]!.fy = fy / l;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const sides: Side[] = [0, 1];

/**
 * 「ふさがれ状態」の刻みを数える道具（design §3.6.6 の確かめ方）。step のあとに毎刻み呼ぶ。
 * ふさがれ状態：方針（stance。号令は見ない）が守備でない部隊（本陣を除く）が、active で、敵が残っていて、
 * 同じ陣営の持ち場の守り手の 1.0 以内にいて、直近 3 秒の間ずっと攻撃しておらず、その 3 秒の位置の変化が 0.3 未満。
 */
export function blockedCounter(): { onTick: (s: BattleState) => void; maxTicks: () => number; reset: () => void } {
  let hist = new Map<number, { x: number; y: number }[]>();
  let total = new Map<number, number>();
  let worst = 0;
  const isHolder = (f: BattleState['units'][number]): boolean =>
    f.status === 'active' && f.kind !== 'gate' && f.stance === 'hold' && f.order === null && Math.hypot(f.x - f.home.x, f.y - f.home.y) <= 0.1;
  return {
    reset: () => {
      hist = new Map();
      total = new Map();
      worst = 0;
    },
    maxTicks: () => worst,
    onTick: (s) => {
      for (const u of s.units) {
        if (u.status !== 'active' || u.attacking !== null) {
          hist.set(u.id, []);
          continue;
        }
        const h = hist.get(u.id) ?? [];
        h.push({ x: u.x, y: u.y });
        if (h.length > 31) h.shift();
        hist.set(u.id, h);
        if (h.length < 31) continue;
        if (u.stance === 'hold' || u.kind === 'hq' || u.kind === 'gate') continue;
        const moved = Math.hypot(h[30]!.x - h[0]!.x, h[30]!.y - h[0]!.y);
        if (moved >= 0.3) continue;
        if (!s.units.some((e) => e.side !== u.side && e.status === 'active' && e.kind !== 'gate')) continue;
        if (!s.units.some((f) => f.id !== u.id && f.side === u.side && isHolder(f) && Math.hypot(f.x - u.x, f.y - u.y) <= 1.0)) continue;
        const v = (total.get(u.id) ?? 0) + 1;
        total.set(u.id, v);
        worst = Math.max(worst, v);
      }
    },
  };
}

// 一人用の15面は、2026-11-22 に新しい盤へ機械的に置き直した（design §13.5、decisions §25）。難しさと星の条件は、公開のあとに合わせる。
// 面の難しさを確かめるテストのうち、置き直した面で通らないものは、条件を残したまま ctx.skip(…, 理由) で止めておく。
// 合わせ直したら、面の id を一覧から外す（一覧が空になったら、この仕組みごと外す）
export const DIFFICULTY_LATER = '難しさは公開のあとに合わせる（decisions §25）';
/** 古い盤（12×16）の手持ちで探した星3つの配置。置き直した面の手持ちと合わないので、探し直すまで止める */
export const STAR3_LATER = '星3つの配置は古い盤のもの。公開のあとに探し直す（decisions §25）';
/** 星3つの配置を、まだ新しい盤で探し直していない面（第2章・第3章。test/fixtures/star3.ts の記録）。探し直したら外す */
export const STAR3_PENDING_CH23 = new Set(['2-1', '2-2', '2-3', '2-4', '2-5', '3-1', '3-2', '3-4']);
