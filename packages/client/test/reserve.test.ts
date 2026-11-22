// 遊軍の画面（design §7.8）のうち、Phaser なしで確かめられる部分。
// 保存の読み書きと古い保存、配置の枠の数え方、ひな形で枠が空になる、ボタンを押せるか、対戦のメッセージの組み立て、
// snap の遊軍の読み方、「遊軍」の知らせの位置、置き場所が今の並びに重ならないこと。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTemplates, plainField, STAGES, STANDARD_HEIGHT, STANDARD_ROSTER, STANDARD_WIDTH, STANDARD_ZONE_WIDTH, validateStageArmy, type Placement, type ReserveView, type Roster } from '@jinkei/engine';
import type { RoomMessage, SnapMessage } from '@jinkei/server/protocol';
import { remainingShown, reserveNoticeAt, summonEnabled, summonShown } from '../src/battle/reserveUi.ts';
import { BoardView } from '../src/battle/BoardView.ts';
import { battleCam } from '../src/battle/camera.ts';
import { battlePanel, battleReserveButtons, CELL, computeLayout, deployInfo, FIELD_COLS, FIELD_ROWS, LANDSCAPE_H, LANDSCAPE_W, deployPanel, deployReserveSlot, pvpDeployPanel, type Rect } from '../src/layout.ts';
import { draftMessage, readyMessage, reserveAllowed, roomReserve, summonMessage } from '../src/net/reserveMessages.ts';
import { snapReserve, viewOfSnap } from '../src/net/snapView.ts';
import { cleanReserve, copyFormation, emptySave, sanitizeSave } from '../src/saveFormat.ts';
import { canPutReserve, newReserve, recallReserve, remainingOf, shrinkKind, templateWithReserve } from '../src/scenes/reserveSlot.ts';
import { RESERVE_FROM_LABEL, RESERVE_LABEL } from '../src/ui/labels.ts';

// ---- 保存 ----

/** 陣営0の配置エリア（標準の盤。通り道の列を含まない）。保存の例の座標は、ここから作る（design §13.14） */
const ZONE = plainField().zones[0];
const BACK = ZONE.row + ZONE.height - 1;
const MID = ZONE.col + Math.floor(ZONE.width / 2);

test('遊軍の項目（reserves・pvpReserve・陣形の reserve）がない保存は、そのまま読めて、遊軍は空', () => {
  const old = {
    v: 2,
    stars: { '1-1': 2 },
    placements: { '1-1': [{ kind: 'hq', col: MID, row: BACK, stance: 'hold' }] },
    muted: true,
    pid: null,
    name: 'a',
    roomCode: null,
    pvpArmy: [{ kind: 'infantry', col: ZONE.col + 2, row: ZONE.row, stance: 'advance' }],
    // 保存した陣形は、配置エリアの左上が原点
    formations: [{ name: '鶴', width: STANDARD_ZONE_WIDTH, units: [{ kind: 'hq', col: MID - ZONE.col, row: BACK - ZONE.row, stance: 'hold' }] }],
    view: 'side',
  };
  const d = sanitizeSave(old);
  assert.equal(d.stars['1-1'], 2);
  assert.equal(d.placements['1-1']?.length, 1);
  assert.deepEqual(d.reserves, {});
  assert.equal(d.pvpReserve, null);
  assert.equal(d.pvpArmy.length, 1);
  assert.equal(d.formations.length, 1);
  assert.equal('reserve' in d.formations[0]!, false);
  assert.equal(d.view, 'side');
});

test('遊軍を保存して読み戻せる（面ごと・対戦・陣形）。JSON を通しても同じ', () => {
  const d = emptySave();
  d.reserves['2-1'] = { kind: 'cavalry', stance: 'flank' };
  d.pvpReserve = { kind: 'archer', stance: 'hold' };
  d.formations.push(copyFormation({ name: 'x', width: STANDARD_ZONE_WIDTH, units: [], reserve: { kind: 'shield', stance: 'advance' } }));
  const back = sanitizeSave(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.reserves, { '2-1': { kind: 'cavalry', stance: 'flank' } });
  assert.deepEqual(back.pvpReserve, { kind: 'archer', stance: 'hold' });
  assert.deepEqual(back.formations[0]?.reserve, { kind: 'shield', stance: 'advance' });
});

test('壊れた遊軍の値は、その遊軍だけを捨てる（本陣・知らない方針・余計な項目・形が違う）', () => {
  const d = sanitizeSave({
    v: 2,
    reserves: { a: { kind: 'hq', stance: 'hold' }, b: { kind: 'infantry', stance: 'zzz' }, c: 'x', d: { kind: 'archer', stance: 'hold', extra: 1 } },
    pvpReserve: { kind: 'hq', stance: 'hold' },
    formations: [{ name: 'y', width: STANDARD_ZONE_WIDTH, units: [{ kind: 'hq', col: 1, row: 1, stance: 'hold' }], reserve: { kind: 'nope', stance: 'hold' } }],
  });
  // 余計な項目は写さない（決まった項目だけを残す）
  assert.deepEqual(d.reserves, { d: { kind: 'archer', stance: 'hold' } });
  assert.equal(d.pvpReserve, null);
  assert.equal(d.formations.length, 1);
  assert.equal(d.formations[0]?.reserve, undefined);
  assert.equal(cleanReserve(undefined), null);
  assert.equal(cleanReserve(null), null);
});

// ---- 配置の枠 ----

const roster: Roster = { hq: 1, infantry: 2, cavalry: 1 };
const list: Placement[] = [
  { kind: 'hq', col: MID, row: BACK, stance: 'hold' },
  { kind: 'infantry', col: MID - 1, row: ZONE.row, stance: 'advance' },
];

test('手持ちの残りは、戦場と遊軍の枠の両方を引いて数える', () => {
  assert.equal(remainingOf(roster, list, null, 'infantry'), 1);
  assert.equal(remainingOf(roster, list, { kind: 'infantry', stance: 'advance' }, 'infantry'), 0);
  assert.equal(remainingOf(roster, list, { kind: 'infantry', stance: 'advance' }, 'cavalry'), 1);
});

test('枠に入れられるのは、本陣以外で手持ちが残っていて、枠が空のときだけ', () => {
  assert.equal(canPutReserve('cavalry', roster, list, null), true);
  assert.equal(canPutReserve('hq', { hq: 2 }, [], null), false);
  assert.equal(canPutReserve(null, roster, list, null), false);
  assert.equal(canPutReserve('cavalry', roster, list, { kind: 'infantry', stance: 'advance' }), false);
  assert.equal(canPutReserve('archer', roster, list, null), false);
  // 方針は兵種の初期設定から
  assert.deepEqual(newReserve('cavalry'), { kind: 'cavalry', stance: 'flank' });
});

test('ひな形を当てると枠は空になり、手持ちを二重に数えない（7つのひな形すべて）', () => {
  const zone = plainField().zones[0];
  const r: Roster = { ...STANDARD_ROSTER };
  for (const t of listTemplates()) {
    const out = templateWithReserve(t.id, r, zone);
    assert.equal(out.reserve, null, t.id);
    // ひな形は手持ちの全部隊を並べる。枠に残っていたら手持ちを超える
    for (const k of ['infantry', 'shield', 'cavalry', 'archer'] as const) assert.equal(remainingOf(r, out.placements, out.reserve, k), 0, `${t.id} ${k}`);
  }
});

test('陣形を呼び出したとき、手持ちが残っていれば遊軍を枠に入れ、足りなければ入れない。選べない方針は初期設定に直す', () => {
  const ok = (): boolean => true;
  assert.deepEqual(recallReserve({ kind: 'cavalry', stance: 'advance' }, roster, list, ok), { kind: 'cavalry', stance: 'advance' });
  assert.equal(recallReserve({ kind: 'archer', stance: 'hold' }, roster, list, ok), null);
  assert.equal(recallReserve({ kind: 'hq', stance: 'hold' }, { hq: 2 }, [], ok), null);
  assert.equal(recallReserve(undefined, roster, list, ok), null);
  assert.deepEqual(recallReserve({ kind: 'cavalry', stance: 'advance' }, roster, list, () => false), { kind: 'cavalry', stance: 'flank' });
});

test('対戦で兵種の数を減らすと、戦場の最後のその兵種から外し、戦場になければ枠を空にする', () => {
  const two: Placement[] = [...list, { kind: 'infantry', col: MID + 1, row: ZONE.row, stance: 'hold' }];
  const a = shrinkKind(two, { kind: 'infantry', stance: 'advance' }, 'infantry', 2);
  assert.equal(a.list.filter((p) => p.kind === 'infantry').length, 1);
  assert.deepEqual(a.reserve, { kind: 'infantry', stance: 'advance' });
  const b = shrinkKind(list, { kind: 'cavalry', stance: 'flank' }, 'cavalry', 0);
  assert.equal(b.reserve, null);
  assert.equal(b.list.length, list.length);
  const c = shrinkKind(list, { kind: 'cavalry', stance: 'flank' }, 'cavalry', 1);
  assert.deepEqual(c.reserve, { kind: 'cavalry', stance: 'flank' });
});

test('面の検査：遊軍は手持ちに数え、手持ちを超えたら over_roster（engine の validateStageArmy をそのまま使う）', () => {
  const stage = STAGES.find((s) => s.id === '1-3');
  assert.ok(stage);
  const sol = stage.solution.map((p) => ({ ...p }));
  // 見本は手持ちを全部置くので、遊軍を足すと手持ちを超える
  const kind = sol.find((p) => p.kind !== 'hq')!.kind;
  assert.ok(validateStageArmy(stage, sol, { kind, stance: newReserve(kind).stance }).some((e) => e.code === 'over_roster'));
  // 1部隊を戦場から外して枠に回せば通る
  const i = sol.map((p) => p.kind).lastIndexOf(kind);
  const less = sol.filter((_, j) => j !== i);
  assert.deepEqual(validateStageArmy(stage, less, newReserve(kind)), []);
});

// ---- 戦闘のボタン ----

const view = (state: ReserveView['state']): ReserveView => ({ kind: 'cavalry', stance: 'advance', state });

test('遊軍のボタン：遊軍がいる戦いだけ出し、ready で、決着前・使える部屋・送っていないときだけ押せる', () => {
  assert.equal(summonShown(null), false);
  assert.equal(summonShown(view('waiting')), true);
  assert.equal(summonShown(view('used')), true);
  const base = { ended: false, allowed: true, sent: false };
  assert.equal(summonEnabled(view('ready'), base), true);
  assert.equal(summonEnabled(view('waiting'), base), false);
  assert.equal(summonEnabled(view('used'), base), false);
  assert.equal(summonEnabled(null, base), false);
  assert.equal(summonEnabled(view('ready'), { ...base, ended: true }), false);
  assert.equal(summonEnabled(view('ready'), { ...base, allowed: false }), false);
  assert.equal(summonEnabled(view('ready'), { ...base, sent: true }), false);
  assert.equal(RESERVE_FROM_LABEL.left, '遊軍 左から');
  assert.equal(RESERVE_FROM_LABEL.right, '遊軍 右から');
  assert.equal(RESERVE_LABEL, '遊軍');
});

test('結果の「残った兵」は remainingForStars を使い、ない古い振り返りでは remaining', () => {
  assert.equal(remainingShown({ remaining: [0.5, 0.2], remainingForStars: [0.6, 0.2] }, 0), 0.6);
  assert.equal(remainingShown({ remaining: [0.5, 0.2] }, 0), 0.5);
  assert.equal(remainingShown({ remaining: [0.5, 0.2], remainingForStars: [Number.NaN, 0.2] }, 0), 0.5);
});

// ---- 対戦のメッセージ ----

test('下書きと確定：使える部屋では遊軍（なければ null）を付け、使えない部屋では項目を付けない', () => {
  const r = { kind: 'cavalry', stance: 'advance' } as const;
  assert.deepEqual(draftMessage(list, r, true), { type: 'draft', army: list, reserve: r });
  assert.deepEqual(draftMessage(list, null, true), { type: 'draft', army: list, reserve: null });
  assert.deepEqual(draftMessage(list, r, false), { type: 'draft', army: list });
  assert.equal('reserve' in draftMessage(list, r, false), false);
  assert.deepEqual(readyMessage(list, r, true), { type: 'ready', army: list, reserve: r });
  assert.equal('reserve' in readyMessage(list, r, false), false);
  // 送るのは写し（あとで手元を変えても、送ったものは変わらない）
  const m = draftMessage(list, r, true);
  assert.notEqual(m.army, list);
  assert.notEqual(m.reserve, r);
});

test('遊軍を呼ぶメッセージ：from は自分から見た左右のまま（返さない）', () => {
  assert.deepEqual(summonMessage(3, 'left'), { type: 'reserve', battleNo: 3, from: 'left' });
  assert.deepEqual(summonMessage(1, 'right'), { type: 'reserve', battleNo: 1, from: 'right' });
});

test('room の rules.reserve と myReserve：項目がなければ false・null として読む', () => {
  const rules = { budget: 36, costs: {}, maxUnits: 15, standardRoster: {} } as unknown as RoomMessage['rules'];
  assert.equal(reserveAllowed(null), false);
  assert.equal(reserveAllowed({ rules }), false);
  assert.equal(reserveAllowed({ rules: { ...rules, reserve: true } }), true);
  const r = { kind: 'archer', stance: 'hold' } as const;
  assert.equal(roomReserve({ rules, myReserve: r }), null);
  assert.deepEqual(roomReserve({ rules: { ...rules, reserve: true }, myReserve: r }), r);
  assert.equal(roomReserve({ rules: { ...rules, reserve: true } }), null);
});

test('snap の遊軍は自分の側に入れ、相手の側は null。遊軍がなければ項目ごと入れない', () => {
  const base = { type: 'snap', battleNo: 1, tick: 60, maxTicks: 1800, units: [], evBase: 0, events: [], ordersLeft: [3, 3], outcome: null } as unknown as SnapMessage;
  assert.equal('reserve' in viewOfSnap(base, 0), false);
  assert.equal('reserve' in viewOfSnap({ ...base, reserve: null }, 1), false);
  const r = view('ready');
  assert.deepEqual(viewOfSnap({ ...base, reserve: r }, 0).reserve, [r, null]);
  assert.deepEqual(viewOfSnap({ ...base, reserve: r }, 1).reserve, [null, r]);
  assert.equal(snapReserve({ reserve: { kind: 'cavalry', stance: 'advance', state: 'zzz' } as unknown as ReserveView }), null);
});

// ---- 「遊軍」の知らせの位置 ----

/** 描き場所（横長の 320 × 384） */
const AREA: Rect = { x: 8, y: 8, w: FIELD_COLS * CELL, h: FIELD_ROWS * CELL };

test('「遊軍」の知らせは、兵数と士気の箱と同じく部隊の上に出す（盤の 4 つの向き。立体の画面）', () => {
  for (const mode of ['right', 'left', 'side', 'back'] as const) {
    const board = { width: STANDARD_WIDTH, height: STANDARD_HEIGHT };
    const fv = new BoardView(AREA, board, { cam: battleCam(mode, AREA, board) });
    const x = 0.5;
    const y = STANDARD_HEIGHT / 2 + 0.5;
    const at = reserveNoticeAt(fv, AREA, x, y, 48, 32);
    const p = fv.toScreen(x, y);
    // 箱は部隊の足もとより上
    assert.ok(at.y + 32 <= p.y, mode);
  }
});

// ---- 置き場所（いまある表示物に重ならない） ----

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(a: Rect, b: Rect): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

const LAYOUTS = [computeLayout(LANDSCAPE_W, LANDSCAPE_H), computeLayout(320, 620), computeLayout(390, 844), computeLayout(320, 720)];

test('配置の画面の「遊軍」の枠は、画面の中にあり、いまあるボタン・戦場に重ならない（横長・縦長、1人用・対戦）', () => {
  for (const l of LAYOUTS) {
    const screen = { x: 0, y: 0, w: l.width, h: l.height };
    for (const pvp of [false, true]) {
      const slot = deployReserveSlot(l, pvp);
      assert.ok(inside(slot, screen), `${l.mode} ${pvp}`);
      assert.ok(!overlaps(slot, l.field), `${l.mode} ${pvp} 戦場`);
      const rects: Rect[] = [];
      if (pvp) {
        const p = pvpDeployPanel(l);
        rects.push(p.back, p.mute, ...p.roster, ...p.minus, ...p.plus, ...p.templates, p.formations, p.start);
      } else {
        const p = deployPanel(l);
        rects.push(p.back, p.mute, ...p.roster, ...p.templates, p.formations, p.start);
        const info = deployInfo(l, false);
        if (info.hintButton) rects.push(info.hintButton);
      }
      for (const r of rects) assert.ok(!overlaps(slot, r), `${l.mode} ${pvp} ${JSON.stringify(r)}`);
    }
  }
});

test('戦闘の画面の「遊軍 左から」「遊軍 右から」は、操作の欄の中にあり、いまあるボタンに重ならない', () => {
  for (const l of LAYOUTS) {
    const [a, b] = battleReserveButtons(l);
    const p = battlePanel(l);
    for (const r of [a, b]) {
      assert.ok(inside(r, l.panel), l.mode);
      for (const o of [p.quit, p.mute, p.speed, ...p.targets, ...p.orders, p.view]) assert.ok(!overlaps(r, o), `${l.mode} ${JSON.stringify(o)}`);
    }
    assert.ok(!overlaps(a, b));
    assert.ok(a.x < b.x, '左が左');
  }
});
