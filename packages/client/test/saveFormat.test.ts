// 保存の版と引き継ぎ（design §13.9、decisions §22「保存」）。
// v 1（盤が 12×16 だったころ）からは座標を持たない項目だけを引き継ぎ、v 2 はすべて読む。それ以外は空。
// 数の上限は engine の MAX_UNITS、陣形の幅の上限は配置エリアの幅 STANDARD_ZONE_WIDTH を読む。
// 座標は、標準の盤の配置エリア（plainField().zones）から作る（盤の大きさを書かない。design §13.14）。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_UNITS, plainField, STANDARD_WIDTH, STANDARD_ZONE_WIDTH, type Placement } from '@jinkei/engine';
import { emptySave, SAVE_VERSION, sanitizeSave } from '../src/saveFormat.ts';

const PID = '0123456789abcdef0123456789abcdef';
/** 陣営0の配置エリア（標準の盤。通り道の列を含まない） */
const ZONE = plainField().zones[0];
/** 戦場の列と行で持つ配置（面ごとの配置・対戦の配置）：本陣はエリアの奥の行、歩兵は最前列 */
const hq: Placement = { kind: 'hq', col: ZONE.col + Math.floor(ZONE.width / 2), row: ZONE.row + ZONE.height - 1, stance: 'hold' };
const inf: Placement = { kind: 'infantry', col: ZONE.col + 2, row: ZONE.row, stance: 'advance' };
/** 保存した陣形の部隊（配置エリアの左上が原点。design §13.2 の 7） */
const fHq: Placement = { ...hq, col: hq.col - ZONE.col, row: hq.row - ZONE.row };

/** 全部の項目を埋めた保存（v だけ差し替えて使う） */
function full(v: unknown): Record<string, unknown> {
  return {
    v,
    stars: { '1-1': 3, '2-4': 1 },
    placements: { '1-1': [hq, inf] },
    reserves: { '1-1': { kind: 'cavalry', stance: 'flank' } },
    muted: true,
    pid: PID,
    name: 'たろう',
    roomCode: '0420',
    pvpArmy: [hq, inf],
    pvpReserve: { kind: 'archer', stance: 'hold' },
    formations: [{ name: '鶴翼', width: STANDARD_ZONE_WIDTH, units: [fHq], reserve: { kind: 'shield', stance: 'advance' } }],
    view: 'left',
    tutorialDone: true,
    pvpRulesSeen: true,
  };
}

test('新しい保存は v 2', () => {
  assert.equal(SAVE_VERSION, 2);
  assert.equal(emptySave().v, 2);
});

test('v 1 からは星・音・pid・名前・部屋のコード・視点・チュートリアルの印・対戦のルールの印を引き継ぎ、配置・遊軍・陣形・対戦の配置は捨てる', () => {
  const d = sanitizeSave(full(1));
  assert.equal(d.v, 2, '読んだあとは v 2 の形（次に書くとき v 2 になる）');
  assert.deepEqual(d.stars, { '1-1': 3, '2-4': 1 });
  assert.equal(d.muted, true);
  assert.equal(d.pid, PID);
  assert.equal(d.name, 'たろう');
  assert.equal(d.roomCode, '0420');
  assert.equal(d.view, 'left');
  assert.equal(d.tutorialDone, true);
  assert.equal(d.pvpRulesSeen, true);
  assert.deepEqual(d.placements, {});
  assert.deepEqual(d.reserves, {});
  assert.deepEqual(d.formations, []);
  assert.deepEqual(d.pvpArmy, []);
  assert.equal(d.pvpReserve, null);
});

test('v 1 の、チュートリアルの印がない保存は、いままでどおり星から決める', () => {
  const raw = full(1);
  delete raw.tutorialDone;
  assert.equal(sanitizeSave(raw).tutorialDone, true);
  raw.stars = {};
  assert.equal(sanitizeSave(raw).tutorialDone, false);
});

test('v 2 は、すべての項目を読み戻す。書いたものを JSON に通して読んでも同じ', () => {
  const d = sanitizeSave(full(2));
  assert.deepEqual(d.placements, { '1-1': [hq, inf] });
  assert.deepEqual(d.reserves, { '1-1': { kind: 'cavalry', stance: 'flank' } });
  assert.deepEqual(d.pvpArmy, [hq, inf]);
  assert.deepEqual(d.pvpReserve, { kind: 'archer', stance: 'hold' });
  assert.deepEqual(d.formations, [{ name: '鶴翼', width: STANDARD_ZONE_WIDTH, units: [fHq], reserve: { kind: 'shield', stance: 'advance' } }]);
  assert.equal(d.view, 'left');
  assert.deepEqual(sanitizeSave(JSON.parse(JSON.stringify(d))), d);
});

test('v が 1・2 でない保存（版なし・知らない版・形の違う値）は、空の保存', () => {
  for (const v of [undefined, 0, 3, '2', null]) {
    const raw = full(v);
    if (v === undefined) delete raw.v;
    assert.deepEqual(sanitizeSave(raw), emptySave(), JSON.stringify(v));
  }
  for (const raw of [null, 'x', 2, [], [full(2)]]) assert.deepEqual(sanitizeSave(raw), emptySave(), JSON.stringify(raw));
});

test('古い視点が残っている保存（v 1・v 2）：横はそのまま横、真上・斜め・将軍は右斜めとして読む（design §14.11。版は上げない）', () => {
  for (const v of [1, 2]) {
    assert.equal(sanitizeSave({ ...full(v), view: 'general' }).view, 'right');
    assert.equal(sanitizeSave({ ...full(v), view: 'top' }).view, 'right');
    assert.equal(sanitizeSave({ ...full(v), view: 'oblique' }).view, 'right');
    assert.equal(sanitizeSave({ ...full(v), view: 'side' }).view, 'side');
    for (const d of ['right', 'left', 'back'] as const) assert.equal(sanitizeSave({ ...full(v), view: d }).view, d);
  }
});

test('数の上限は engine の MAX_UNITS、陣形の幅は 1〜STANDARD_ZONE_WIDTH（配置エリアの幅。v 2）', () => {
  const many = (n: number): Placement[] => Array.from({ length: n }, (_, i) => ({ ...inf, col: i % STANDARD_ZONE_WIDTH }));
  const at = (n: number, width: number) =>
    sanitizeSave({ v: 2, placements: { a: many(n) }, pvpArmy: many(n), formations: [{ name: 'x', width, units: many(n) }] });
  const ok = at(MAX_UNITS, STANDARD_ZONE_WIDTH);
  assert.equal(ok.placements.a?.length, MAX_UNITS);
  assert.equal(ok.pvpArmy.length, MAX_UNITS);
  assert.equal(ok.formations[0]?.units.length, MAX_UNITS);
  const over = at(MAX_UNITS + 1, STANDARD_ZONE_WIDTH);
  assert.equal(over.placements.a, undefined);
  assert.deepEqual(over.pvpArmy, []);
  assert.deepEqual(over.formations, []);
  assert.deepEqual(at(1, STANDARD_ZONE_WIDTH + 1).formations, []);
  // 戦場の幅（通り道を含む）の陣形は、配置エリアより広いので捨てる
  assert.ok(STANDARD_WIDTH > STANDARD_ZONE_WIDTH);
  assert.deepEqual(at(1, STANDARD_WIDTH).formations, []);
  assert.deepEqual(at(1, 0).formations, []);
  assert.equal(at(1, 1).formations.length, 1);
});

test('壊れた値は、その項目だけを捨てる（v 1 の引き継ぐ項目・v 2 の座標を持つ項目）', () => {
  for (const v of [1, 2]) {
    const d = sanitizeSave({
      v,
      stars: { a: 4, b: '2', c: 2 },
      muted: 'yes',
      pid: 'ABC',
      name: 'あ'.repeat(13),
      roomCode: '12345',
      view: 'zzz',
      pvpRulesSeen: 'true',
    });
    assert.deepEqual(d.stars, { c: 2 });
    assert.equal(d.muted, false);
    assert.equal(d.pid, null);
    assert.equal(d.name, '');
    assert.equal(d.roomCode, null);
    assert.equal(d.view, 'right');
    assert.equal(d.pvpRulesSeen, false);
  }
  const d = sanitizeSave({
    v: 2,
    placements: { a: [{ kind: 'dragon', col: 1, row: 1, stance: 'hold' }], b: 'x', c: [hq] },
    pvpArmy: [{ ...hq, col: 1.5 }],
    formations: [{ name: '', width: STANDARD_ZONE_WIDTH, units: [] }, { name: 'ok', width: STANDARD_ZONE_WIDTH, units: [fHq] }, 'x'],
  });
  assert.deepEqual(d.placements, { c: [hq] });
  assert.deepEqual(d.pvpArmy, []);
  assert.deepEqual(d.formations.map((f) => f.name), ['ok']);
});
