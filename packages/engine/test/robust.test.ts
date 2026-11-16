// 利用者の入力が届く口は、どんな値を渡されても例外を投げず、エラーの結果を返す（レビューの指摘 1・3・7）
import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  canOrder,
  canOrderView,
  createBattle,
  MAX_UNITS,
  plainField,
  STANDARD_ROSTER,
  step,
  validateArmy,
  viewFor,
} from '../src/index.ts';
import { matchupSetup } from '../sim/lib.ts';
import { clone } from './helpers.ts';

const good = (): Record<string, unknown> => clone(matchupSetup('line', 'crane', 1)) as unknown as Record<string, unknown>;

/** 壊れた値の見本 */
const junk: unknown[] = [null, undefined, 0, -1, 1.5, NaN, Infinity, '', 'x', {}, [], [null], [undefined], true, () => 1, Symbol('s')];

describe('createBattle は例外を投げない', () => {
  it('setup そのものが壊れている', () => {
    for (const v of junk) expect(() => createBattle(v as never)).not.toThrow();
    for (const v of junk) expect(createBattle(v as never).ok).toBe(false);
  });
  it('各項目が壊れている', () => {
    const keys = ['field', 'armies', 'seed', 'maxTicks', 'timeout', 'scriptedOrders', 'requireHq'];
    for (const k of keys) {
      for (const v of junk) {
        const s = good();
        s[k] = v;
        expect(() => createBattle(s as never), `${k}=${String(v)}`).not.toThrow();
        // 見本の値はどれも、この4項目には正しくない値（seed は 0 や 1.5 も正しいので、ここでは見ない）
        if (['field', 'armies', 'timeout', 'maxTicks'].includes(k)) expect(createBattle(s as never).ok, `${k}=${String(v)}`).toBe(false);
      }
    }
  });
  it('配置エリア・地形・軍・配置・予定された号令の中身が壊れている', () => {
    const cases: ((s: Record<string, any>) => void)[] = [
      (s) => (s.field.zones = [null, s.field.zones[1]]),
      (s) => (s.field.zones = [{ col: 0, row: 0, width: 'a', height: 1 }, s.field.zones[1]]),
      (s) => (s.field.terrain = new Array(192)), // 穴だけの配列
      (s) => (s.field.terrain[3] = 'lava'),
      (s) => (s.armies = [null, s.armies[1]]),
      (s) => (s.armies[0] = [null]),
      (s) => (s.armies[0] = new Array(3)), // 疎な配列
      (s) => (s.armies[0][0] = { kind: 'dragon', col: 1, row: 10, stance: 'advance' }),
      (s) => (s.armies[0][0] = { kind: 'infantry', col: 1, row: 10, stance: 'dance' }),
      (s) => (s.armies[0][0].col = NaN),
      (s) => (s.scriptedOrders = {}),
      (s) => (s.scriptedOrders = [null]),
      (s) => (s.scriptedOrders = [{ tick: 1, side: 0, target: 'all', kind: 'nope' }]),
      (s) => (s.scriptedOrders = Array.from({ length: 33 }, (_, i) => ({ tick: i, side: 0, target: 'all', kind: 'brace' }))),
    ];
    for (const f of cases) {
      const s = good();
      f(s);
      expect(() => createBattle(s as never)).not.toThrow();
      expect(createBattle(s as never).ok, f.toString()).toBe(false);
    }
  });
  it('予定された号令は 32 件までなら受け付ける', () => {
    const s = good();
    s.scriptedOrders = Array.from({ length: 32 }, (_, i) => ({ tick: i, side: 0, target: 'all', kind: 'brace' }));
    expect(createBattle(s as never).ok).toBe(true);
  });
  it('作った状態は、余計な鍵を持たず、JSON にして戻しても同じ', () => {
    const s = good() as Record<string, any>;
    s.field.zones[0].extra = { deep: [1, 2] };
    s.field.extra = 1;
    const r = createBattle(s as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value.field.zones[0]).sort()).toEqual(['col', 'height', 'row', 'width']);
    expect(Object.keys(r.value.field).sort()).toEqual(['height', 'terrain', 'width', 'zones']);
    expect(JSON.parse(JSON.stringify(r.value))).toEqual(r.value);
  });
});

describe('validateArmy は例外を投げず、数の上限を先に調べる', () => {
  const zone = plainField().zones[0];
  it('壊れた配置・エリア・条件', () => {
    for (const v of junk) {
      expect(() => validateArmy(v as never, zone, { maxUnits: 16 })).not.toThrow();
      expect(() => validateArmy([v] as never, zone, { maxUnits: 16 })).not.toThrow();
      expect(() => validateArmy([{ kind: 'hq', col: 5, row: 15, stance: 'hold' }], v as never, { maxUnits: 16 })).not.toThrow();
      expect(() => validateArmy([{ kind: 'hq', col: 5, row: 15, stance: 'hold' }], zone, v as never)).not.toThrow();
    }
    expect(validateArmy(new Array(3) as never, zone, { maxUnits: 16 }).length).toBeGreaterThan(0);
  });
  it('上限を超える配列は、走査せずに1件のエラーだけ返す', () => {
    const huge = new Array(1_000_000).fill({ kind: 'infantry', col: 0, row: 10, stance: 'advance' });
    const t0 = performance.now();
    const errs = validateArmy(huge, zone, { maxUnits: MAX_UNITS });
    expect(performance.now() - t0).toBeLessThan(50);
    expect(errs).toEqual([{ code: 'too_many_units', message: expect.any(String) }]);
  });
});

describe('canOrder・canOrderView・step の号令・applyTemplate は例外を投げない', () => {
  const r = createBattle(matchupSetup('line', 'crane', 1));
  if (!r.ok) throw new Error();
  const s = r.value;
  it('canOrder と canOrderView', () => {
    for (const v of junk) {
      expect(() => canOrder(v as never, 0, 'all', 'brace')).not.toThrow();
      expect(canOrder(v as never, 0, 'all', 'brace').ok).toBe(false);
      expect(() => canOrderView(v as never, 0, 'all', 'brace')).not.toThrow();
      expect(canOrderView(v as never, 0, 'all', 'brace')).toBe(false);
      if (v !== 0) expect(canOrder(s, v as never, 'all', 'brace').ok).toBe(false); // 0 は正しい陣営
      expect(canOrder(s, 0, v as never, 'brace').ok).toBe(false);
      expect(canOrder(s, 0, 'all', v as never).ok).toBe(false);
      expect(canOrderView(viewFor(s, 0), 0, v as never, 'brace')).toBe(false);
    }
  });
  it('step に渡す号令が壊れていれば無視し、状態を変えない。先頭の8件より後ろは見ない', () => {
    const a = clone(s);
    const b = clone(s);
    const bad: unknown[] = [...junk, { side: 2, target: 'all', kind: 'brace' }, { side: 0, target: 'all', kind: 'x' }, { side: 0, target: 'up', kind: 'brace' }];
    expect(() => step(a, bad as never)).not.toThrow();
    for (const v of junk) expect(() => step(a, v as never)).not.toThrow();
    step(b, []);
    for (const v of junk) step(b, []);
    expect(a).toEqual(b);
    // 9件目の号令は見ない
    const c = clone(s);
    const nine = [...new Array(8).fill({ side: 1, target: 'right', kind: 'brace' }), { side: 0, target: 'all', kind: 'brace' }];
    step(c, nine as never);
    expect(c.ordersUsed[0]).toBe(0);
  });
  it('applyTemplate', () => {
    const zone = plainField().zones[0];
    for (const v of junk) {
      expect(() => applyTemplate(v as never, STANDARD_ROSTER, zone, 0)).not.toThrow();
      expect(() => applyTemplate('line', v as never, zone, 0)).not.toThrow();
      expect(() => applyTemplate('line', STANDARD_ROSTER, v as never, 0)).not.toThrow();
      expect(() => applyTemplate('line', STANDARD_ROSTER, zone, v as never)).not.toThrow();
    }
    expect(applyTemplate('constructor' as never, STANDARD_ROSTER, zone, 0)).toEqual([]);
    expect(applyTemplate('__proto__' as never, STANDARD_ROSTER, zone, 0)).toEqual([]);
    expect(applyTemplate('line', { infantry: 1e9 }, zone, 0).length).toBeLessThanOrEqual(MAX_UNITS);
  });
});
