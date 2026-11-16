// 座標の返し（flip.ts）の単体テスト。往復で元に戻ること、陣営0には何もしないこと、場面の返し方。

import { applyTemplate, createBattle, plainField, viewFor, PVP_RULES } from '@jinkei/engine';
import { describe, expect, it } from 'vitest';
import { fieldFor, flipCell, flipPoint, flipZone, packUnit, placementsFor, revealFor } from '../src/flip.ts';

const field = plainField();

describe('座標の返し', () => {
  it('マス・位置・エリアは、2回返すと元に戻る', () => {
    for (let col = 0; col < field.width; col++) {
      for (let row = 0; row < field.height; row++) {
        const once = flipCell(col, row, field);
        expect(flipCell(once.col, once.row, field)).toEqual({ col, row });
        // マスの中心を返すと、返したマスの中心になる
        expect(flipPoint(col + 0.5, row + 0.5, field)).toEqual({ x: once.col + 0.5, y: once.row + 0.5 });
      }
    }
    for (const z of field.zones) expect(flipZone(flipZone(z, field), field)).toEqual(z);
    // 陣営1のエリアを返すと、陣営0のエリア（下側）になる
    expect(flipZone(field.zones[1], field)).toEqual(field.zones[0]);
  });

  it('配置は、陣営0ではそのまま、陣営1では往復で元に戻る', () => {
    const army = applyTemplate('crane', PVP_RULES.standardRoster, field.zones[0], 0);
    expect(placementsFor(0, army, field)).toEqual(army);
    const toField = placementsFor(1, army, field);
    expect(toField.every((p) => p.row < 6)).toBe(true);
    expect(placementsFor(1, toField, field)).toEqual(army);
    // 陣営1のひな形（戦場の座標）を返すと、陣営0のひな形と同じ形になる
    expect(placementsFor(1, applyTemplate('line', PVP_RULES.standardRoster, field.zones[1], 1), field)).toEqual(
      applyTemplate('line', PVP_RULES.standardRoster, field.zones[0], 0),
    );
    // 公開の配置は、自軍だけ方針を付ける
    expect(revealFor(1, 0, army, field).every((u) => !('stance' in u))).toBe(true);
    expect(revealFor(1, 1, army, field).every((u) => typeof u.stance === 'string')).toBe(true);
  });

  it('戦場は、陣営1には地形を逆順にし、zones[1] が下側になる', () => {
    const f = fieldFor(1, { ...field, terrain: field.terrain.map((t, i) => (i === 0 ? 'hill' : t)) });
    expect(f.terrain[f.terrain.length - 1]).toBe('hill');
    expect(f.zones[1]).toEqual(field.zones[0]);
    expect(f.zones[0]).toEqual(field.zones[1]);
    expect(fieldFor(0, field)).toEqual(field);
  });

  it('場面の部隊は、陣営1には位置と向きを返し、翼はそのまま、敵の方針は null', () => {
    const a0 = applyTemplate('line', PVP_RULES.standardRoster, field.zones[0], 0);
    const a1 = applyTemplate('line', PVP_RULES.standardRoster, field.zones[1], 1);
    const r = createBattle({ field, armies: [a0, a1], seed: 1, maxTicks: 100, timeout: 'compare' });
    expect(r.ok).toBe(true);
    const state = r.value;
    const v1 = viewFor(state, 1);
    for (const u of v1.units) {
      const p = packUnit(1, u, field);
      expect(p[4]).toBeCloseTo(field.width - u.x, 2);
      expect(p[5]).toBeCloseTo(field.height - u.y, 2);
      expect(p[6]).toBeCloseTo(-u.fx, 3);
      expect(p[7]).toBeCloseTo(-u.fy, 3);
      expect(p[3]).toBe(u.wing);
      expect(p[14]).toBe(u.side === 1 ? u.stance : null);
      // 陣営1の人にも、自軍は下側にいて前（上）を向いて見える
      if (u.side === 1) {
        expect(p[5]).toBeGreaterThan(10);
        expect(p[7]).toBeLessThan(0);
      }
    }
    // 陣営1の人から見て左（x が小さい）にいる自軍は、左翼
    const own = v1.units.filter((u) => u.side === 1).map((u) => packUnit(1, u, field));
    for (const p of own) {
      if (p[4] < 4) expect(p[3]).toBe('left');
      if (p[4] > 8) expect(p[3]).toBe('right');
    }
    // 陣営0にはそのまま
    const u0 = viewFor(state, 0).units[0];
    const p0 = packUnit(0, u0, field);
    expect([p0[4], p0[5], p0[6], p0[7]]).toEqual([u0.x, u0.y, u0.fx, u0.fy]);
  });
});
