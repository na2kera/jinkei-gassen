// T10（design §3.8）：平地の戦いが、地形を入れる前と1刻みも変わらないことを確かめるための、記録と照合。
// 記録は sim/baseline.ts が test/fixtures/t10-baseline.json に書き出す。照合は test/acceptance/t10-plain-unchanged.test.ts。

import { createBattle, step, type BattleSetup, type BattleState, type OrderInput } from '../src/index.ts';

export interface T10Battle {
  name: string;
  setup: BattleSetup;
  /** 刻み → その刻みに渡す号令 */
  orders: Record<string, OrderInput[]>;
}

export interface T10Record {
  name: string;
  setup: BattleSetup;
  orders: Record<string, OrderInput[]>;
  /** 50刻みごとの、ここまでの「毎刻みの出来事」と「その時点の状態」を混ぜたハッシュ */
  checkpoints: string[];
  ticks: number;
  /** 最後の状態（記録したときの項目だけ） */
  final: unknown;
}

export interface T10File {
  note: string;
  /** 記録したときの BattleState と Unit の項目（あとで足した項目は、比べる前に取り除く） */
  stateKeys: string[];
  unitKeys: string[];
  battles: T10Record[];
}

/** 32ビットの FNV-1a を2つ（違う初期値）並べた、簡単なハッシュ。照合のためだけに使う */
export class Hasher {
  private a = 0x811c9dc5;
  private b = 0x01000193 ^ 0x5bd1e995;
  add(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.a = Math.imul(this.a ^ c, 0x01000193) >>> 0;
      this.b = Math.imul(this.b ^ c, 0x01000193) >>> 0;
      this.b = (this.b ^ (this.b >>> 13)) >>> 0;
    }
  }
  hex(): string {
    return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0');
  }
}

/** 状態を、記録したときの項目だけに絞る（新しく足した項目を取り除く） */
export function project(state: BattleState, stateKeys: string[], unitKeys: string[]): unknown {
  const s = state as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of stateKeys) {
    if (k === 'units') out[k] = state.units.map((u) => Object.fromEntries(unitKeys.map((uk) => [uk, (u as unknown as Record<string, unknown>)[uk]])));
    else out[k] = s[k];
  }
  return JSON.parse(JSON.stringify(out));
}

/** 1戦を流して、記録と同じ形の値を作る */
export function playT10(b: T10Battle, stateKeys: string[], unitKeys: string[]): Omit<T10Record, 'name' | 'setup' | 'orders'> {
  const r = createBattle(b.setup);
  if (!r.ok) throw new Error(`${b.name}: ${r.error.message}`);
  const s = r.value;
  const h = new Hasher();
  const checkpoints: string[] = [];
  h.add(JSON.stringify(project(s, stateKeys, unitKeys)));
  while (!s.outcome) {
    const ev = step(s, b.orders[String(s.tick)] ?? []);
    h.add(`${s.tick}:${JSON.stringify(ev)}`);
    if (s.tick % 50 === 0 || s.outcome) {
      h.add(JSON.stringify(project(s, stateKeys, unitKeys)));
      checkpoints.push(h.hex());
    }
  }
  return { checkpoints, ticks: s.tick, final: project(s, stateKeys, unitKeys) };
}
