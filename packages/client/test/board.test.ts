// 立体の画面の投影・カメラ・押して選ぶ・歩く動き・棒（design §14.4・§14.5・§14.8・§14.10・§14.15）を、画面なしで確かめる。
// node --experimental-strip-types --test で動かす。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHeight } from '../src/art/stack/height.ts';
import { barLength, WalkTracker, walkFrame } from '../src/art/stack/squad.ts';
import { BoardView, camBetween, deg, fit, limit, type Cam } from '../src/battle/BoardView.ts';
import { BattleCamera, battleCam, DIR_ROT, revealCam, revealProgress, type BoardDir } from '../src/battle/camera.ts';
import { pickSquad } from '../src/battle/pick.ts';

const BOARD = { width: 10, height: 12 };
const AREAS = [
  { x: 0, y: 40, w: 320, h: 328 },
  { x: 16, y: 13, w: 320, h: 384 },
];
const DIRS: BoardDir[] = ['right', 'left', 'side', 'back'];
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 対戦の中央の丘（4 × 2 マス） */
const HILL = buildHeight(10, 12, 32, (c, r) => c >= 3 && c <= 6 && (r === 5 || r === 6));

/** その向きで盤が画面の上で使う幅と、背丈の余白を含む高さ */
function used(cam: Cam): { w: number; h: number } {
  const c = Math.abs(Math.cos(cam.rot));
  const s = Math.abs(Math.sin(cam.rot));
  const ex = 160 * c + 192 * s;
  const ey = (160 * s + 192 * c) * 0.75;
  return { w: 2 * ex * cam.k, h: (2 * ey + 34) * cam.k };
}

test('B1 止まった向きの縮み（fit・limit）が design §14.4 の表と合う（描き場所 320×328 と 320×384）', () => {
  for (const a of AREAS) {
    assert.equal(fit(0, false, a, BOARD), 1);
    assert.equal(r3(limit(deg(30), true, a, BOARD)), 0.651);
    assert.equal(r3(limit(deg(-30), true, a, BOARD)), 0.651);
    assert.equal(r3(limit(deg(90), true, a, BOARD)), 0.79);
    assert.equal(r3(limit(0, true, a, BOARD)), 0.94);
  }
  // 狭い盤（一人用。幅 6・5）
  const a = AREAS[0]!;
  assert.equal(r3(limit(deg(30), true, a, { width: 6, height: 12 })), 0.844);
  assert.equal(r3(limit(deg(30), true, a, { width: 5, height: 12 })), 0.912);
});

test('B2 カメラの動き：全部の移り変わりを細かく刻んでも、盤が描き場所に収まり、縮みが途中で飛ばない', () => {
  for (const a of AREAS) {
    const runs: { from: Cam; to: Cam; strict: boolean }[] = [];
    for (const d of DIRS) runs.push({ from: { rot: 0, k: 1 }, to: { rot: DIR_ROT[d], k: fit(DIR_ROT[d], false, a, BOARD) }, strict: false });
    for (const d1 of DIRS) for (const d2 of DIRS) if (d1 !== d2) runs.push({ from: battleCam(d1, a, BOARD), to: battleCam(d2, a, BOARD), strict: true });
    for (const r of runs) {
      let prev: number | null = null;
      for (let i = 0; i <= 200; i++) {
        const cam = camBetween(r.from, r.to, i / 200, r.strict, a, BOARD);
        const u = used(cam);
        assert.ok(u.w <= a.w + 1e-6, `幅 ${u.w}`);
        assert.ok(u.h <= a.h + 1e-6, `高さ ${u.h}`);
        if (prev !== null) assert.ok(Math.abs(cam.k - prev) < 0.02, `縮みが飛ぶ ${prev} → ${cam.k}`);
        prev = cam.k;
      }
    }
  }
});

test('B3 動いている途中に別の向きを押しても、収まりと縮みのつながりが保たれる', () => {
  const a = AREAS[0]!;
  for (const p0 of [0.2, 0.5, 0.8])
    for (const d1 of DIRS)
      for (const d2 of DIRS) {
        if (d1 === d2) continue;
        const cam = new BattleCamera('right');
        cam.turnTo(d1, 0, a, BOARD);
        const before = cam.camAt(p0 * 1100, a, BOARD);
        cam.turnTo(d2, p0 * 1100, a, BOARD);
        const after = cam.camAt(p0 * 1100, a, BOARD);
        assert.ok(Math.abs(after.k - before.k) < 1e-9 && Math.abs(after.rot - before.rot) < 1e-9);
        for (let t = 0; t <= 1100; t += 11) {
          const c = cam.camAt(p0 * 1100 + t, a, BOARD);
          const u = used(c);
          assert.ok(u.w <= a.w + 1e-6 && u.h <= a.h + 1e-6);
        }
        assert.equal(cam.moving, false);
      }
});

test('B4 投影と逆変換：行って帰ったずれが盤の px で 0.05 以下（丘の上・下、4 つの向き、返した表示）', () => {
  let worst = 0;
  for (const a of AREAS)
    for (const d of [...DIRS, 'deploy'] as const)
      for (const flipped of [false, true]) {
        const cam = d === 'deploy' ? { rot: 0, k: 1 } : battleCam(d, a, BOARD);
        const bv = new BoardView(a, BOARD, { flipped, hm: HILL, cam });
        for (let y = 0.05; y < 12; y += 0.37)
          for (let x = 0.05; x < 10; x += 0.29) {
            const p = bv.toScreen(x, y);
            const q = bv.toField(p.x, p.y);
            worst = Math.max(worst, Math.hypot(q.x - x, q.y - y) * 32);
          }
      }
  assert.ok(worst <= 0.05, `ずれ ${worst}`);
});

test('B5 持ち上がった丘の面を押すと、そのマスになる（境目から 0.5px 以上離した点）', () => {
  for (const d of DIRS) {
    const bv = new BoardView(AREAS[0]!, BOARD, { hm: HILL, cam: battleCam(d, AREAS[0]!, BOARD) });
    const dep = new BoardView(AREAS[0]!, BOARD, { hm: HILL });
    for (const v of [bv, dep])
      for (let row = 4; row <= 7; row++)
        for (let col = 2; col <= 7; col++)
          for (const [fx, fy] of [
            [0.5, 0.5],
            [0.02, 0.02],
            [0.98, 0.5],
            [0.5, 0.98],
          ] as const) {
            const p = v.toScreen(col + fx, row + fy);
            assert.deepEqual(v.cellAt(p.x, p.y), { col, row }, `${d} (${col},${row}) ${fx},${fy}`);
          }
  }
});

test('B6 向きの番号：4 方向 × 4 つの向き × 返す・返さない。負にならず、返すと N/2 ずれる（36 と 72）', () => {
  const a = AREAS[0]!;
  for (const n of [36, 72])
    for (const d of DIRS)
      for (const [fx, fy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const cam = battleCam(d, a, BOARD);
        const i0 = new BoardView(a, BOARD, { cam }).angleIndex(fx, fy, n);
        const i1 = new BoardView(a, BOARD, { cam, flipped: true }).angleIndex(fx, fy, n);
        assert.ok(i0 >= 0 && i0 < n && i1 >= 0 && i1 < n);
        assert.equal((i1 - i0 + n) % n, n / 2);
      }
  const bv = new BoardView(a, BOARD);
  assert.equal(bv.angleIndex(0, -1), 0);
  assert.equal(bv.angleIndex(0, 1), 18);
  assert.equal(bv.angleIndex(1, 0), 9);
  assert.equal(new BoardView(a, BOARD, { flipped: true }).angleIndex(0, -1), 18);
  // 左斜め（−30°）で上向きは −3 → 33
  assert.equal(new BoardView(a, BOARD, { cam: battleCam('left', a, BOARD) }).angleIndex(0, -1), 33);
  assert.equal(new BoardView(a, BOARD, { cam: battleCam('right', a, BOARD) }).angleIndex(0, -1), 3);
});

test('B7 配置の画面（回さない）では、マスがそのまま 32 × 24px になり、盤は縦のまん中', () => {
  const a = AREAS[1]!;
  const bv = new BoardView(a, BOARD);
  assert.deepEqual(bv.cellRect(0, 0), { x: a.x, y: Math.round(bv.rect.y), w: 32, h: 24 });
  const r = bv.rect;
  assert.equal(r.w, 320);
  assert.equal(r.h, 288);
  // 使う高さ (288 + 34) を縦のまん中に
  assert.equal(r.y - 34, a.y + (a.h - 322) / 2);
});

test('B8 公開の回転：始まる前は 0、startsAt で 1、同じ時刻なら同じ値。はじめの 0.8 秒は回さない', () => {
  assert.equal(revealProgress(1000, 4000), 0);
  assert.equal(revealProgress(1800, 4000), 0);
  assert.equal(revealProgress(4000, 4000), 1);
  assert.equal(revealProgress(9000, 4000), 1);
  assert.equal(revealProgress(2900, 4000), revealProgress(2900, 4000));
  assert.equal(r3(revealProgress(2900, 4000)), 0.5);
  const a = AREAS[0]!;
  assert.deepEqual(revealCam('right', 0, a, BOARD), { rot: 0, k: 1 });
  const end = revealCam('right', 1, a, BOARD);
  assert.equal(r3(end.rot), r3(deg(30)));
  for (let i = 0; i <= 100; i++) {
    const u = used(revealCam('side', i / 100, a, BOARD));
    assert.ok(u.w <= a.w + 1e-6 && u.h <= a.h + 1e-6);
  }
});

test('P1 押して選ぶ：矩形に入る点はその部隊、重なりは手前、12px 以内の近い部隊、なければ null', () => {
  const boxes = [
    { id: 1, x: 100, y: 100, w: 10, h: 30, depth: 50 },
    { id: 2, x: 105, y: 110, w: 10, h: 30, depth: 60 },
  ];
  assert.equal(pickSquad(boxes, null, 101, 101), 1);
  assert.equal(pickSquad(boxes, null, 107, 115), 2);
  assert.equal(pickSquad(boxes, null, 98.5, 99), 1);
  assert.equal(pickSquad(boxes, null, 200, 200), null);
  assert.equal(pickSquad(boxes, [{ id: 3, x: 200, y: 210 }], 200, 200), 3);
  assert.equal(pickSquad(boxes, [{ id: 3, x: 200, y: 213 }], 200, 200), null);
  // 戦闘の揃いの騎兵（0.84 で焼いた絵の上 31px。表示の倍率 1）：頭を押すとその部隊（0.84 を 2 度掛けていない）
  const cav = [{ id: 9, x: 50 - 8, y: 200 - 31, w: 16, h: 31 + 4, depth: 200 }];
  assert.equal(pickSquad(cav, null, 50, 200 - 30), 9);
});

test('W1 歩いた距離：戦場の座標の差で積む。カメラだけを動かしても増えない。初め・飛んだとき・隠したときに 0', () => {
  const w = new WalkTracker();
  assert.equal(w.update(3, 4, 16, false), 0);
  assert.equal(w.update(3, 4, 16, false), 0);
  assert.equal(r3(w.update(3.1, 4, 16, false)), 3.2);
  // 2 マスを超えて飛んだら、足さずに 0 に戻す（design §14.8。Codex の再現：(0,0) → (1,0) → (4,0) で 0）
  assert.equal(r3(w.update(6, 4, 16, false)), 0);
  const j = new WalkTracker();
  j.update(0, 0, 16, false);
  assert.equal(r3(j.update(1, 0, 16, false)), 32);
  assert.equal(j.update(4, 0, 16, false), 0);
  // 戦っている間は止まっていても 1 秒に 5.3px
  assert.equal(r3(w.update(6, 4, 1000, true)), 5.3);
  w.reset();
  assert.equal(w.update(6, 4, 16, false), 0);
  assert.equal(walkFrame(100, 0, 0, false), 0);
  assert.equal(walkFrame(2.8, 0, 0, true), 1);
});

test('R1 兵の残りの棒：戦闘（0.84）で 13px。1 未満なら満タンにならず、0 より大きければ 1px 残る', () => {
  assert.deepEqual(barLength(0.84, 0.5), { len: 13, fill: 7 });
  assert.equal(barLength(0.84, 0.99).fill, 12);
  assert.equal(barLength(0.84, 0.01).fill, 1);
  assert.equal(barLength(0.3, 0.5).len, 6);
});
