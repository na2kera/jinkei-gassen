// 画面の向き・保存・兵の古い並び・押している部隊の数字の箱・印の置き場所を、画面なしで確かめる。
// 古い投影（真上・斜め・横からの FieldView）の検査（V1〜V5・V9・V10、立った絵の置き方、視点ごとの盤の大きさ）は、
// 立体の画面に替えたときに、新しいカメラでの検査（test/board.test.ts）に置き換えた（design §14.15）。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirOf, slotsOf } from '../src/art/formation.ts';
import { STANDARD_HEIGHT, STANDARD_WIDTH } from '@jinkei/engine';
import { BoardView } from '../src/battle/BoardView.ts';
import { battleCam } from '../src/battle/camera.ts';
import { followInspect } from '../src/battle/inspect.ts';
import { nextView, parseView, VIEW_CYCLE } from '../src/battle/viewMode.ts';
import { computeLayout, LANDSCAPE_H, LANDSCAPE_W, type Rect } from '../src/layout.ts';
import { FRAME_HALF, MARK_X, markLayout, markRects, POLE_X } from '../src/art/marks.ts';
import { VIEW_LABEL } from '../src/ui/labels.ts';

/** 標準の戦場の幅と高さ（10 × 12。design §13.2） */
const W = STANDARD_WIDTH;
const H = STANDARD_HEIGHT;

// ---- 古い兵の並び（ポスターと OGP の道具のために残す。§5.8 の前の UnitSprite.ts から写して固定する） ----

/** 変更前の dirOf */
function oldDirOf(dx: number, dy: number): number {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy < 0 ? 0 : 2;
}

/** 変更前の兵の並び。歩兵・盾兵・弓兵は 3×3（前の列から）、騎兵は 2×2、本陣は将と四隅の護衛 */
const OLD_FOOT: { lx: number; ly: number }[] = [];
for (const ly of [-4, 0, 4]) for (const lx of [-5, 0, 5]) OLD_FOOT.push({ lx, ly });
const OLD_SLOTS: Record<'hq' | 'infantry' | 'shield' | 'archer' | 'cavalry', { lx: number; ly: number }[]> = {
  infantry: OLD_FOOT,
  shield: OLD_FOOT,
  archer: OLD_FOOT,
  cavalry: [
    { lx: -3, ly: -4 },
    { lx: 3, ly: -4 },
    { lx: -3, ly: 4 },
    { lx: 3, ly: 4 },
  ],
  hq: [
    { lx: 0, ly: 0 },
    { lx: -5, ly: -4 },
    { lx: 5, ly: -4 },
    { lx: -5, ly: 4 },
    { lx: 5, ly: 4 },
  ],
};

test('兵の並びは、変更前と同じ順で、間隔を 1マス 32px に合わせて約 4/3 倍にした整数。向きの選び方は変更前と同じ（等号の境目を含む）', () => {
  // design §13.8：±5・±4 → ±7・±5、騎兵の ±3・±4 → ±4・±5（24px のマスから 32px のマスへ）
  for (const kind of ['hq', 'infantry', 'shield', 'archer', 'cavalry'] as const) {
    assert.deepEqual(
      slotsOf(kind).map((s) => ({ lx: s.lx, ly: s.ly })),
      OLD_SLOTS[kind].map((o) => ({ lx: Math.round((o.lx * 4) / 3), ly: Math.round((o.ly * 4) / 3) })),
      kind,
    );
  }
  // 横と縦が同じ大きさ（dx = dy、dx = −dy）や 0 のときは、縦の向き（下が 2、上が 0）を選ぶ
  const cases: [number, number, number][] = [
    [1, 1, 2],
    [-1, -1, 0],
    [1, -1, 0],
    [-1, 1, 2],
    [Math.SQRT1_2, Math.SQRT1_2, 2],
    [-Math.SQRT1_2, Math.SQRT1_2, 2],
    [Math.SQRT1_2, -Math.SQRT1_2, 0],
    [0, 0, 2],
    [-0, -0, 2],
    [1, 0, 1],
    [-1, 0, 3],
    [0, 1, 2],
    [0, -1, 0],
    [0.6, -0.8, 0],
    [0.8, -0.6, 1],
    [-0.8, 0.6, 3],
  ];
  for (const [dx, dy, want] of cases) {
    assert.equal(oldDirOf(dx, dy), want, `old ${dx},${dy}`);
    assert.equal(dirOf(dx, dy), want, `new ${dx},${dy}`);
  }
});

// ---- V6 ----

test('V6 保存：view に盤の 4 つの向きが入り、読み戻せる。横はそのまま横、知らない値（真上・斜め・将軍を含む）は右斜め（design §14.11）', () => {
  for (const v of VIEW_CYCLE) {
    // 保存は JSON にして localStorage に置くので、文字に直して戻しても同じ値になる
    const back = parseView(JSON.parse(JSON.stringify({ view: v })).view);
    assert.equal(back, v);
  }
  for (const bad of ['', 'top', 'oblique', 'Top', 'front', 'general', 3, null, undefined, {}]) assert.equal(parseView(bad), 'right');
  assert.equal(parseView('side'), 'side');
});

test('視点のボタン：右斜め → 左斜め → 横 → 後ろ → 右斜め と回る（試作と同じ順）', () => {
  assert.equal(nextView('right'), 'left');
  assert.equal(nextView('left'), 'side');
  assert.equal(nextView('side'), 'back');
  assert.equal(nextView('back'), 'right');
  assert.deepEqual(
    VIEW_CYCLE.map((v) => VIEW_LABEL[v]),
    ['視点：右斜め', '視点：左斜め', '視点：横', '視点：後ろ'],
  );
  assert.deepEqual(Object.keys(VIEW_LABEL).sort(), ['back', 'left', 'right', 'side']);
});

// ---- 押している部隊の数字の箱 ----

test('押している部隊の数字の箱：描いている部隊なら、どこにいても出す。全滅して描いていない部隊は、押している状態を残して箱を出さない', () => {
  const u = { id: 3, x: 0.2, y: H - 0.2 };
  const other = { id: 8, x: 5, y: 10 };
  const r = followInspect({ pointerId: 1, unit: 3 }, [other, u]);
  assert.equal(r.shown, u);
  const held = { pointerId: 1, unit: 9 };
  const gone = followInspect(held, [other]);
  assert.equal(gone.inspect, held);
  assert.equal(gone.shown, null);
  assert.deepEqual(followInspect(null, [u]), { inspect: null, shown: null });
});

// ---- 印（号令の印・方針の印・号令の相手の枠）の描く範囲（design §13.14・§14.9） ----

test('印の描く先は、どの向きでも境界（uiBounds）からはみ出さない（左端 x=0.45・右端の境目・上下の端。縦長と横長。配置と盤の 4 つの向き）', () => {
  const inside = (r: Rect, b: Rect): boolean => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
  // engine の移動の限界（端から 0.45 マス）と、そのあいだを細かく
  const xs: number[] = [];
  for (let x = 0.45; x <= W - 0.45 + 1e-9; x += 0.05) xs.push(Math.round(x * 100) / 100);
  const ys = [0.45, 1, H / 2, H - 1, H - 0.45];
  let n = 0;
  for (const l of [computeLayout(390, 760), computeLayout(LANDSCAPE_W, LANDSCAPE_H)]) {
    const area = l.field;
    for (const mode of ['deploy', 'right', 'left', 'side', 'back'] as const) {
      const board = { width: W, height: H };
      const fv = new BoardView(area, board, { cam: mode === 'deploy' ? { rot: 0, k: 1 } : battleCam(mode, area, board) });
      const b = fv.uiBounds(area);
      for (const x of xs) {
        for (const y of ys) {
          const p = fv.toScreen(x, y);
          const cx = Math.round(p.x);
          const cy = Math.round(p.y);
          for (const hq of [false, true]) {
            for (const morale of [0, 100]) {
              const r = markRects(markLayout({ cx, cy, hq, standing: true, morale, bounds: b }), cx, cy);
              for (const [k, rect] of Object.entries(r)) {
                assert.ok(inside(rect, b), `${l.mode} ${mode} (${x},${y}) hq=${hq} ${k} ${JSON.stringify(rect)} ⊄ ${JSON.stringify(b)}`);
                n++;
              }
            }
          }
        }
      }
    }
  }
  assert.ok(n > 10000);
});

test('印は、はみ出さない位置では寄せない（いままでの置き場所のまま）。左端では号令の印が境界の左の端に寄る', () => {
  const area = computeLayout(390, 760).field;
  const fv = new BoardView(area, { width: W, height: H });
  const b = fv.uiBounds(area);
  // まん中の部隊：号令の印 (−16, −26)、方針の印 (−16, 6)、枠は兵を囲む平たい形（−18〜6）、旗竿は右の 12（立体の画面では旗は出さない）
  const c = fv.toScreen(W / 2, H / 2);
  const mid = markLayout({ cx: Math.round(c.x), cy: Math.round(c.y), hq: false, standing: true, morale: 100, bounds: b });
  assert.deepEqual(mid.order, { x: MARK_X, y: -26 });
  assert.deepEqual(mid.stance, { x: MARK_X, y: 6 });
  assert.deepEqual(mid.frame, { x: -FRAME_HALF, y: -18, w: FRAME_HALF * 2, h: 24 });
  assert.equal(mid.mirror, false);
  assert.equal(mid.poleX, POLE_X);
  // 左端（x=0.45 → 画面の x 14）：印の左の端が境界の左の端（x 0）にそろう
  const e = fv.toScreen(0.45, H / 2);
  const cx = Math.round(e.x);
  assert.equal(cx, b.x + 14);
  const left = markLayout({ cx, cy: Math.round(e.y), hq: false, standing: true, morale: 100, bounds: b });
  assert.equal(cx + left.order.x, b.x);
  assert.equal(cx + left.stance.x, b.x);
  assert.equal(cx + left.frame.x, b.x);
  // 右端：旗は竿の左に付け替える
  const r = fv.toScreen(W - 0.45, H / 2);
  assert.equal(markLayout({ cx: Math.round(r.x), cy: Math.round(r.y), hq: false, standing: true, morale: 100, bounds: b }).mirror, true);
});
