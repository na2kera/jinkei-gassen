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
