// 戦闘の画面の視点（design §5.8.5 の V1〜V6、V9、V10）を、画面なしで確かめる。
// 将軍の視点（V12〜V16・V18）は、盤を変えるときになくした（design §13.8）。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。
// 「変更前」の式は、§5.8 の作りに直す前の FieldView・UnitSprite・BattleScene.onDown から写した。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirOf, slotsOf, soldierPoint, unitLift } from '../src/art/formation.ts';
import { groundTerrain, placeTall, placeTallCell, tallArt, tallScale } from '../src/art/tallArt.ts';
import { STANDARD_HEIGHT, STANDARD_WIDTH } from '@jinkei/engine';
import { SIDE_ART_W, sideArtColors, sideArtRows, TALL_ART_W } from '../src/art/textures.ts';
import { centeredFieldView, type FieldView, type PickTarget, type Point } from '../src/battle/FieldView.ts';
import { followInspect } from '../src/battle/inspect.ts';
import { nextView, parseView, VIEW_CYCLE, type ViewMode } from '../src/battle/viewMode.ts';
import { CELL, computeLayout, FIELD_COLS, FIELD_ROWS, LANDSCAPE_H, LANDSCAPE_W, type Rect } from '../src/layout.ts';
import { FRAME_HALF, MARK_X, markLayout, markRects, POLE_X } from '../src/art/marks.ts';
import { VIEW_LABEL } from '../src/ui/labels.ts';

/** 標準の戦場の幅と高さ（10 × 12。design §13.2） */
const W = STANDARD_WIDTH;
const H = STANDARD_HEIGHT;
/** 描き場所（標準の戦場 10 列 × 12 行ぶん = 320 × 384。design §13.7）。左上が奇数の所も試す */
const AREAS: Rect[] = [
  { x: 16, y: 40, w: FIELD_COLS * CELL, h: FIELD_ROWS * CELL },
  { x: 7, y: 13, w: FIELD_COLS * CELL, h: FIELD_ROWS * CELL },
];
/** 標準・奇数の幅・狭い面（6・5） */
const WIDTHS = [W, 7, 6, 5];

/** V1 と V9 の表 */
const MODE_TABLE: { mode: ViewMode; skip?: string }[] = [{ mode: 'top' }, { mode: 'oblique' }, { mode: 'side' }];

function views(mode: ViewMode, widths = WIDTHS): FieldView[] {
  const out: FieldView[] = [];
  for (const area of AREAS) for (const w of widths) for (const flipped of [false, true]) out.push(centeredFieldView(area, { width: w, height: H }, flipped, mode));
  return out;
}

/** 戦場の4隅と中央と、すべてのマスの中心 */
function samplePoints(fv: FieldView): Point[] {
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: fv.cols, y: 0 },
    { x: 0, y: fv.rows },
    { x: fv.cols, y: fv.rows },
    { x: fv.cols / 2, y: fv.rows / 2 },
  ];
  for (let r = 0; r < fv.rows; r++) for (let c = 0; c < fv.cols; c++) pts.push({ x: c + 0.5, y: r + 0.5 });
  return pts;
}

// ---- 変更前の式（真上と斜め） ----

const OLD_OBLIQUE_Y = 0.6;

function oldRect(area: Rect, field: { width: number; height: number }, oblique: boolean): Rect {
  const w = field.width * CELL;
  const h = Math.round(field.height * CELL * (oblique ? OLD_OBLIQUE_Y : 1));
  const x = area.x + Math.round((area.w - w) / 4) * 2;
  const y = area.y + Math.round((area.h - h) / 4) * 2;
  return { x, y, w, h };
}

class OldView {
  readonly rect: Rect;
  readonly cols: number;
  readonly rows: number;
  readonly flipped: boolean;
  readonly oblique: boolean;
  constructor(rect: Rect, cols: number, rows: number, flipped: boolean, oblique: boolean) {
    this.rect = rect;
    this.cols = cols;
    this.rows = rows;
    this.flipped = flipped;
    this.oblique = oblique;
  }
  get yScale(): number {
    return this.oblique ? OLD_OBLIQUE_Y : 1;
  }
  toScreen(x: number, y: number): Point {
    const fx = this.flipped ? this.cols - x : x;
    const fy = this.flipped ? this.rows - y : y;
    return { x: this.rect.x + fx * CELL, y: this.rect.y + fy * CELL * this.yScale };
  }
  dirToScreen(fx: number, fy: number): Point {
    return this.flipped ? { x: -fx, y: -fy } : { x: fx, y: fy };
  }
  cellRect(col: number, row: number): Rect {
    const a = this.toScreen(col, row);
    const b = this.toScreen(col + 1, row + 1);
    const x0 = Math.round(Math.min(a.x, b.x));
    const x1 = Math.round(Math.max(a.x, b.x));
    const y0 = Math.round(Math.min(a.y, b.y));
    const y1 = Math.round(Math.max(a.y, b.y));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  toField(sx: number, sy: number): Point {
    const x = (sx - this.rect.x) / CELL;
    const y = (sy - this.rect.y) / (CELL * this.yScale);
    return this.flipped ? { x: this.cols - x, y: this.rows - y } : { x, y };
  }
}

function oldView(area: Rect, width: number, flipped: boolean, oblique: boolean): OldView {
  return new OldView(oldRect(area, { width, height: H }, oblique), width, H, flipped, oblique);
}

// ---- V1 ----

for (const { mode, skip } of MODE_TABLE) {
  test(`V1 ${mode}：toField(toScreen(p)) が p に戻る（返す/返さない、幅 10・7・6・5）`, skip ? { skip } : {}, () => {
    for (const fv of views(mode)) {
      for (const p of samplePoints(fv)) {
        const s = fv.toScreen(p.x, p.y);
        const q = fv.toField(s.x, s.y);
        assert.ok(Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9, `${mode} ${fv.cols} ${fv.flipped} (${p.x},${p.y}) → (${q.x},${q.y})`);
      }
    }
  });

  test(`V1 ${mode}：vecToScreen は両端を toScreen に通した差と同じ`, skip ? { skip } : {}, () => {
    for (const fv of views(mode)) {
      for (const p of samplePoints(fv)) {
        for (const [vx, vy] of [
          [0.3, -0.2],
          [-1, 0],
          [0, 1],
        ] as const) {
          const v = fv.vecToScreen(p.x, p.y, vx, vy);
          const a = fv.toScreen(p.x, p.y);
          const b = fv.toScreen(p.x + vx, p.y + vy);
          assert.ok(Math.abs(v.x - (b.x - a.x)) < 1e-9 && Math.abs(v.y - (b.y - a.y)) < 1e-9);
          // px で書いたずれを2つの項で渡しても、同じ所に動く
          const s = fv.shiftOnScreen(a.x, a.y, p.x, p.y, vx * CELL * 2, vy * CELL * 2, vx * CELL, vy * CELL);
          assert.ok(Math.abs(s.x - b.x) < 1e-9 && Math.abs(s.y - b.y) < 1e-9);
        }
      }
    }
  });
}

// ---- V2 ----

test('V2 真上と斜め：toScreen・cellRect・rect・toField が変更前と同じ値', () => {
  for (const area of AREAS) {
    for (const w of WIDTHS) {
      for (const flipped of [false, true]) {
        for (const oblique of [false, true]) {
          const fv = centeredFieldView(area, { width: w, height: H }, flipped, oblique ? 'oblique' : 'top');
          const old = oldView(area, w, flipped, oblique);
          assert.deepEqual(fv.rect, old.rect);
          for (let r = 0; r < H; r++) {
            for (let c = 0; c < w; c++) {
              assert.deepEqual(fv.cellRect(c, r), old.cellRect(c, r));
              for (const [x, y] of [
                [c, r],
                [c + 0.5, r + 0.5],
                [c + 0.37, r + 0.81],
              ] as const) {
                assert.deepEqual(fv.toScreen(x, y), old.toScreen(x, y));
                assert.deepEqual(fv.cellCenter(c, r), old.toScreen(c + 0.5, r + 0.5));
              }
            }
          }
          for (let sy = area.y; sy < area.y + area.h; sy += 7) {
            for (let sx = area.x; sx < area.x + area.w; sx += 7) assert.deepEqual(fv.toField(sx, sy), old.toField(sx, sy));
          }
        }
      }
    }
  }
});

// ---- 変更前の兵の並び（UnitSprite.apply の計算を写したもの）と、いまの並びが同じ px に置かれるか ----
// 向きの選び方（dirOf）と兵の並び（slotsOf）も、§5.8 の前の UnitSprite.ts から写して固定する
// （いまの実装の関数を使うと、両方が同じに変わったときに比べられないため）

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

/** 変更前：画面の向き d に並びを回し、縦だけ yScale で縮める。戻り値は兵の絵の左上（整数の px）と、選ぶ4方向 */
function oldSoldier(old: OldView, x: number, y: number, fx: number, fy: number, lx: number, ly: number, w: number, h: number): [number, number, number] {
  const p = old.toScreen(x, y);
  const d = old.dirToScreen(fx, fy);
  const rx = -d.y;
  const ry = d.x;
  const wx = p.x + lx * rx - ly * d.x;
  const wy = p.y + (lx * ry - ly * d.y) * old.yScale;
  const top = old.oblique ? Math.round(wy - h + 1) : Math.round(wy - h / 2);
  return [Math.round(wx - w / 2), top, oldDirOf(d.x, d.y)];
}

function newSoldier(fv: FieldView, x: number, y: number, fx: number, fy: number, lx: number, ly: number, w: number, h: number): [number, number, number] {
  const p = fv.toScreen(x, y);
  const at = fv.toField(p.x, p.y);
  const { x: wx, y: wy } = soldierPoint(fv, p, at, fx, fy, lx, ly);
  const top = fv.standing ? Math.round(wy - h + 1) : Math.round(wy - h / 2);
  const f = fv.facingOnScreen(at.x, at.y, fx, fy);
  return [Math.round(wx - w / 2), top, dirOf(f.x, f.y)];
}

const FACINGS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0.6, -0.8],
  [-0.8, 0.6],
];

test('真上と斜め：兵の絵の位置（整数の px）と4方向の絵が、変更前と同じ', () => {
  let n = 0;
  // 決まった種の乱数（毎回同じ）
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (const area of AREAS) {
    for (const w of [W, 5]) {
      for (const flipped of [false, true]) {
        for (const oblique of [false, true]) {
          const fv = centeredFieldView(area, { width: w, height: H }, flipped, oblique ? 'oblique' : 'top');
          const old = oldView(area, w, flipped, oblique);
          const positions: Point[] = [
            { x: 0.5, y: 0.5 },
            { x: w / 2 + 0.5, y: H / 2 + 0.5 },
            { x: w - 0.5, y: H - 0.5 },
          ];
          for (let i = 0; i < 20; i++) positions.push({ x: rand() * w, y: rand() * H });
          const facings = [...FACINGS];
          for (let i = 0; i < 10; i++) {
            const a = rand() * Math.PI * 2;
            facings.push([Math.cos(a), Math.sin(a)]);
          }
          for (const pos of positions) {
            for (const [fx, fy] of facings) {
              for (const kind of ['hq', 'infantry', 'shield', 'archer', 'cavalry'] as const) {
                // 敗走中の広がり（1 + 1.2 × 進み具合）。1.6 と 3:4 の向きでは、兵のずれの2つの項がちょうど打ち消し合い、
                // 絵の左上がちょうど半 px に来る。足す順まで変更前と同じでないと 1px 変わるので、その場合も試す
                for (const spread of [1, 1.6, 1 + 1.2 * 0.37]) {
                  // 変更前の並びの px と、いまの並びの px（間隔を広げたもの）の両方で、投影の計算が変更前と同じかを見る
                  for (const s of [...OLD_SLOTS[kind], ...slotsOf(kind)]) {
                    // 敗走で散らばるときと、近接で前へ 1px 突くときも試す
                    const lx = s.lx * spread;
                    const ly = s.ly * spread - (s.ly < 0 ? 1 : 0);
                    for (const [sw, sh] of [
                      [5, 6],
                      [7, 10],
                      [8, 5],
                    ] as const) {
                      assert.deepEqual(newSoldier(fv, pos.x, pos.y, fx, fy, lx, ly, sw, sh), oldSoldier(old, pos.x, pos.y, fx, fy, lx, ly, sw, sh), JSON.stringify({ area, w, flipped, oblique, pos, fx, fy, lx, ly, sw, sh }));
                      n++;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(n > 10000);
});

test('真上と斜め：数字の箱の持ち上げと、旗・枠を立てるかが変更前と同じ', () => {
  const top = centeredFieldView(AREAS[0]!, { width: W, height: H }, false, 'top');
  const obl = centeredFieldView(AREAS[0]!, { width: W, height: H }, false, 'oblique');
  assert.equal(unitLift(top, 3, 3), 20);
  assert.equal(unitLift(obl, 3, 3), 34);
  assert.equal(top.standing, false);
  assert.equal(obl.standing, true);
  assert.equal(top.depthSorted, false);
  assert.equal(obl.depthSorted, true);
  // 旗・箱・押せる範囲を止める矩形
  const area = AREAS[0]!;
  assert.deepEqual(top.uiBounds(area), top.rect);
  assert.deepEqual(obl.uiBounds(area), { x: obl.rect.x, y: area.y, w: obl.rect.w, h: area.h });
});

test('真上と斜め：高さのある絵の置き方と並べる値が、変更前と同じ', () => {
  for (const flipped of [false, true]) {
    const obl = centeredFieldView(AREAS[1]!, { width: W, height: H }, flipped, 'oblique');
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const r = obl.cellRect(col, row);
        const bottom = r.y + r.h;
        assert.equal(r.w, CELL);
        const treeArt = tallArt('oblique', 'tree', { alt: (col + row) % 2 !== 0 })!;
        const tree = placeTall(treeArt, r);
        // 木はマスの横の 1/4 と 3/4 の所（32px のマスで 8px と 24px）。伸ばさない
        assert.deepEqual(tree, { x: r.x + ((col + row) % 2 === 0 ? CELL / 4 : (CELL * 3) / 4), y: bottom - 2, depth: bottom - 2 });
        assert.deepEqual(tallScale(treeArt, r), { sx: 1, sy: 1 });
        // 柵・城壁・門は、横だけをマスの幅に合わせて伸ばす（原画の幅 24px → 32px。design §13.8）
        for (const kind of ['fence', 'wall', 'gate'] as const) {
          assert.deepEqual(tallScale(tallArt('oblique', kind, { stage: 1 })!, r), { sx: r.w / TALL_ART_W, sy: 1 }, kind);
        }
        assert.deepEqual(placeTall(tallArt('oblique', 'fence')!, r), { x: r.x, y: bottom, depth: bottom - 1 });
        assert.deepEqual(placeTall(tallArt('oblique', 'wall')!, r), { x: r.x, y: bottom, depth: bottom });
        assert.deepEqual(placeTall(tallArt('oblique', 'gate', { stage: 2 })!, r), { x: r.x, y: r.y + r.h, depth: r.y + r.h });
      }
    }
  }
  const top = centeredFieldView(AREAS[0]!, { width: W, height: H }, false, 'top');
  const r = top.cellRect(5, 5);
  const g = tallArt('flat', 'gate', { stage: 1 })!;
  assert.equal(g.key, 'gate-1');
  assert.deepEqual([g.originX, g.originY], [0, 0]);
  assert.deepEqual(placeTall(g, r), { x: r.x, y: r.y, depth: r.y });
  // 真上の門は地面のタイルと同じ大きさで描いてあるので、伸ばさない
  assert.deepEqual(tallScale(g, r), { sx: 1, sy: 1 });
  assert.equal(tallArt('flat', 'wall'), null);
  assert.equal(tallArt('oblique', 'wall')!.key, 'tall-wall');
  assert.equal(tallArt('oblique', 'gate', { stage: 1 })!.key, 'tall-gate-1');
  assert.equal(groundTerrain('flat', 'fence'), 'fence');
  assert.equal(groundTerrain('oblique', 'fence'), 'fence');
});

// ---- V3〜V5（横から） ----

test('V3 横から：自軍の本陣が左、敵の本陣が右。自軍の左翼が上、右翼が下。rect の幅が 288px', () => {
  for (const fv of views('side')) {
    // 12 行 × 32px × 0.75 = 288（design §13.7 の表）
    assert.equal(fv.rect.w, 288);
    // 返したときは、自軍（陣営1）は戦場の座標の上の端にいる
    const ownY = fv.flipped ? 0.5 : H - 0.5;
    const enemyY = fv.flipped ? H - 0.5 : 0.5;
    const mid = fv.cols / 2;
    const own = fv.toScreen(mid, ownY);
    const enemy = fv.toScreen(mid, enemyY);
    const cx = fv.rect.x + fv.rect.w / 2;
    assert.ok(own.x < cx && enemy.x > cx);
    // 自軍の左翼：見ている人の左（返さないときは x が小さい側、返したときは x が大きい側）
    const leftX = fv.flipped ? fv.cols - 0.5 : 0.5;
    const rightX = fv.flipped ? 0.5 : fv.cols - 0.5;
    assert.ok(fv.toScreen(leftX, ownY).y < fv.toScreen(rightX, ownY).y);
    // rect は描き場所の中に収まる
    // 縦は幅 10 で 10 × 32 × 0.6 = 192（いちばん高い）
    assert.ok(fv.rect.x >= AREAS[0]!.x && fv.rect.h <= 192);
  }
  const area = AREAS[0]!;
  const fv = centeredFieldView(area, { width: W, height: H }, false, 'side');
  // 描き場所 320 × 384 の中央：横は (320 − 288) / 2 = 16、縦は (384 − 192) / 2 = 96
  assert.deepEqual(fv.rect, { x: area.x + 16, y: area.y + 96, w: 288, h: 192 });
  assert.deepEqual(fv.uiBounds(area), area);
  assert.equal(fv.standing, true);
  assert.equal(fv.depthSorted, true);
  assert.equal(fv.art, 'side');
});

test('V4 横から：隣り合うマスの cellRect に隙間も重なりもない（全マス）', () => {
  for (const fv of views('side')) {
    const all = [];
    for (let r = 0; r < fv.rows; r++) for (let c = 0; c < fv.cols; c++) all.push(fv.cellRect(c, r));
    const x0 = Math.min(...all.map((q) => q.x));
    const y0 = Math.min(...all.map((q) => q.y));
    const x1 = Math.max(...all.map((q) => q.x + q.w));
    const y1 = Math.max(...all.map((q) => q.y + q.h));
    // 囲む矩形の中の、どの px もちょうど1つのマスに入る
    const cover = new Uint8Array((x1 - x0) * (y1 - y0));
    for (const q of all) {
      // 1マスは 24 × 19.2px（design §13.7）。縦は丸めで 19 と 20 が交じる
      assert.equal(q.w, CELL * 0.75);
      assert.ok(q.h === 19 || q.h === 20);
      for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) cover[(y - y0) * (x1 - x0) + (x - x0)]!++;
    }
    assert.ok(cover.every((v) => v === 1), `${fv.cols} ${fv.flipped}`);
    // マスの絵は、隣のマスと同じ並びに並ぶ（横の隣は戦場の行、縦の隣は戦場の列）
    const a = fv.cellRect(0, 5);
    const b = fv.cellRect(0, 4);
    assert.equal(fv.flipped ? b.x + b.w : a.x + a.w, fv.flipped ? a.x : b.x);
  }
});

test('V5 depthOf：画面で手前（下）にあるものほど大きい（横から・斜め）', () => {
  for (const mode of ['side', 'oblique'] as const) {
    for (const fv of views(mode, [W, 6])) {
      const pts = samplePoints(fv);
      for (let i = 0; i < pts.length; i += 3) {
        for (let j = 1; j < pts.length; j += 5) {
          const a = pts[i]!;
          const b = pts[j]!;
          const sa = fv.toScreen(a.x, a.y);
          const sb = fv.toScreen(b.x, b.y);
          if (sa.y < sb.y - 0.5) assert.ok(fv.depthOf(a.x, a.y) < fv.depthOf(b.x, b.y));
        }
      }
    }
  }
});

test('横から：高さのある絵と、柵のマスの下地', () => {
  const fv = centeredFieldView(AREAS[0]!, { width: W, height: H }, false, 'side');
  assert.equal(groundTerrain(fv.art, 'fence'), 'plain');
  assert.equal(groundTerrain(fv.art, 'wall'), 'wall');
  const r = fv.cellRect(5, 5);
  for (const kind of ['fence', 'wall', 'gate'] as const) {
    const a = tallArt('side', kind, { stage: 2 })!;
    assert.ok(a.key.startsWith('side-'));
    const p = placeTall(a, r);
    // 下の端をマスの手前の端に合わせる
    assert.deepEqual([p.x, p.y], [r.x, r.y + r.h]);
    // 横からの柵・城壁・門は、全体を縦横同じ倍率（マスの幅 ÷ 原画の幅 18）で伸ばす（design §13.8）
    assert.deepEqual(tallScale(a, r), { sx: r.w / SIDE_ART_W, sy: r.w / SIDE_ART_W }, kind);
  }
  // 木は、マスの中で隣のマスと互い違い
  const t0 = placeTall(tallArt('side', 'tree', { alt: false })!, r);
  const t1 = placeTall(tallArt('side', 'tree', { alt: true })!, r);
  assert.ok(t0.x >= r.x && t1.x <= r.x + r.w && t0.x < t1.x);
  // 絵の並びは矩形で、知らない文字がない。原画の幅は 18px（置くときにマスの幅 24px へ伸ばす）
  const colors = sideArtColors();
  for (const [key, rows] of Object.entries(sideArtRows())) {
    for (const line of rows) {
      assert.equal(line.length, SIDE_ART_W, key);
      for (const ch of line) assert.ok(ch === '.' || colors[ch] !== undefined, `${key} ${ch}`);
    }
  }
});

// ---- V6 ----

test('V6 保存：view に3つの値が入り、読み戻せる。知らない値（なくした将軍の視点を含む）は top', () => {
  for (const v of VIEW_CYCLE) {
    // 保存は JSON にして localStorage に置くので、文字に直して戻しても同じ値になる
    const back = parseView(JSON.parse(JSON.stringify({ view: v })).view);
    assert.equal(back, v);
  }
  for (const bad of ['', 'Top', 'front', 'general', 3, null, undefined, {}]) assert.equal(parseView(bad), 'top');
});

test('視点のボタン：真上 → 斜め → 横 → 真上 と回り、保存に残った将軍は真上で読む', () => {
  assert.equal(nextView('top'), 'oblique');
  assert.equal(nextView('oblique'), 'side');
  assert.equal(nextView('side'), 'top');
  assert.equal(parseView('general'), 'top');
  assert.deepEqual(
    VIEW_CYCLE.map((v) => VIEW_LABEL[v]),
    ['視点：真上', '視点：斜め', '視点：横'],
  );
  assert.deepEqual(Object.keys(VIEW_LABEL).sort(), ['oblique', 'side', 'top']);
});

// ---- V9 ----

const DIR_VEC: Record<number, Point> = { 0: { x: 0, y: -1 }, 1: { x: 1, y: 0 }, 2: { x: 0, y: 1 }, 3: { x: -1, y: 0 } };

for (const { mode, skip } of MODE_TABLE) {
  test(`V9 ${mode}：兵の並びと向き（前の列が向きの側、右手が右、4方向の絵が画面の向きと合う）`, skip ? { skip } : {}, () => {
    for (const flipped of [false, true]) {
      const fv = centeredFieldView(AREAS[0]!, { width: W, height: H }, flipped, mode);
      for (const [fx, fy] of FACINGS.slice(0, 8)) {
        const at = { x: 6.3, y: 8.7 };
        const h = fv.vecToScreen(at.x, at.y, fx, fy);
        for (const kind of ['infantry', 'cavalry', 'hq'] as const) {
          for (const s of slotsOf(kind)) {
            const c = fv.toScreen(at.x, at.y);
            const w = soldierPoint(fv, c, at, fx, fy, s.lx, s.ly);
            const off = { x: w.x - c.x, y: w.y - c.y };
            const dot = off.x * h.x + off.y * h.y;
            // (a) 前の列（ly が負）は向きの側、後ろの列は反対側
            if (s.ly < 0) assert.ok(dot > 0, `${mode} ${flipped} ${fx},${fy} 前`);
            if (s.ly > 0) assert.ok(dot < 0, `${mode} ${flipped} ${fx},${fy} 後ろ`);
            // (b) 右手（lx が正）は、画面の上でも進む向きの右（y が下向きの画面で、外積が正）。鏡写しにならない
            const cross = h.x * off.y - h.y * off.x;
            if (s.lx > 0) assert.ok(cross > 0, `${mode} ${flipped} ${fx},${fy} 右`);
            if (s.lx < 0) assert.ok(cross < 0, `${mode} ${flipped} ${fx},${fy} 左`);
          }
        }
        // (c) 選ぶ4方向の絵は、画面の向きと合う（まっすぐの向きはその向き、斜めは隣り合う2つのどちらか）
        const f = fv.facingOnScreen(at.x, at.y, fx, fy);
        const d = DIR_VEC[dirOf(f.x, f.y)]!;
        const len = Math.hypot(h.x, h.y);
        const cos = (d.x * h.x + d.y * h.y) / len;
        if (fx === 0 || fy === 0) assert.ok(cos > 0.999, `${mode} ${flipped} ${fx},${fy}`);
        else assert.ok(cos > 0.5, `${mode} ${flipped} ${fx},${fy}`);
      }
    }
  });
}

test('V9 横から：敵へ向かう自軍は右向き、自軍へ向かう敵は左向き', () => {
  for (const flipped of [false, true]) {
    const fv = centeredFieldView(AREAS[0]!, { width: W, height: H }, flipped, 'side');
    // 自軍は、返さないときは上（y が小さい側）へ、返したときは下へ進む
    const own = fv.facingOnScreen(6, 8, 0, flipped ? 1 : -1);
    const enemy = fv.facingOnScreen(6, 8, 0, flipped ? -1 : 1);
    assert.equal(dirOf(own.x, own.y), 1);
    assert.equal(dirOf(enemy.x, enemy.y), 3);
  }
});

// ---- V10 ----

/** 変更前の BattleScene.onDown の選び方 */
function oldPick(old: OldView, units: PickTarget[], sx: number, sy: number): number | null {
  const at = old.toField(sx, sy + (old.oblique ? 6 : 0));
  let best: { id: number; d: number } | null = null;
  for (const s of units) {
    const d = Math.hypot(s.x - at.x, s.y - at.y);
    if (d <= 0.55 && (!best || d < best.d)) best = { id: s.id, d };
  }
  return best ? best.id : null;
}

/** 決まった場面：隣り合う部隊、重なりかけた部隊、同じ位置の部隊、端の部隊 */
const SCENE: PickTarget[] = [
  { id: 1, x: 4.5, y: 10.5 },
  { id: 2, x: 5.4, y: 10.5 },
  { id: 3, x: 2.2, y: 7.1 },
  { id: 4, x: 2.7, y: 7.4 },
  { id: 5, x: 7.5, y: 6.5 },
  { id: 6, x: 7.5, y: 6.5 },
  { id: 7, x: 0.3, y: 0.2 },
  { id: 8, x: W - 0.2, y: H - 0.1 },
  { id: 9, x: 5.05, y: 3.33 },
];

test('V10 真上と斜め：変更の前後で、押した位置から選ばれる部隊が同じ', () => {
  let hits = 0;
  for (const area of AREAS) {
    for (const flipped of [false, true]) {
      for (const oblique of [false, true]) {
        const fv = centeredFieldView(area, { width: W, height: H }, flipped, oblique ? 'oblique' : 'top');
        const old = oldView(area, W, flipped, oblique);
        for (let sy = area.y; sy < area.y + area.h; sy += 1.5) {
          for (let sx = area.x; sx < area.x + area.w; sx += 1.5) {
            const want = oldPick(old, SCENE, sx, sy);
            assert.equal(fv.pick(SCENE, sx, sy), want, `${flipped} ${oblique} (${sx},${sy})`);
            if (want !== null) hits++;
          }
        }
      }
    }
  }
  assert.ok(hits > 1000);
});

test('V10 横から：体のまん中を押すとその部隊、重なる2部隊のあいだを押すと手前の部隊', () => {
  for (const flipped of [false, true]) {
    const fv = centeredFieldView(AREAS[0]!, { width: W, height: H }, flipped, 'side');
    for (const u of SCENE) {
      if (u.id === 5 || u.id === 6) continue;
      const c = fv.pickPoint(u.x, u.y);
      // 体のまん中は、足もとより上
      assert.ok(c.y < fv.toScreen(u.x, u.y).y);
      const others = SCENE.filter((o) => o.id !== u.id && o.id !== 5 && o.id !== 6);
      // ほかの部隊がもっと近くにいなければ、その部隊が選ばれる
      const nearer = others.some((o) => {
        const p = fv.pickPoint(o.x, o.y);
        return Math.hypot(p.x - c.x, p.y - c.y) === 0;
      });
      if (!nearer) assert.equal(fv.pick(others.concat([u]), c.x, c.y), u.id);
    }
    // 隣の列の2部隊（画面の縦に 19.2px 離れて重なる）のあいだを押すと、手前（画面の下）の部隊
    const back = { id: 1, x: 5.5, y: 8.5 };
    const front = { id: 2, x: 6.5, y: 8.5 };
    const a = fv.pickPoint(back.x, back.y);
    const b = fv.pickPoint(front.x, front.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const want = fv.depthOf(back.x, back.y) > fv.depthOf(front.x, front.y) ? back.id : front.id;
    assert.equal(fv.pick([back, front], mid.x, mid.y), want);
    assert.equal(fv.pick([front, back], mid.x, mid.y), want);
    // 離れすぎていれば選ばない
    assert.equal(fv.pick([back], a.x + fv.pickRadius(back.x, back.y) + 1, a.y), null);
  }
});

// ---- 高さのある絵の置き場所と、押している部隊の数字の箱 ----

test('真上・斜め・横から：placeTallCell は、マスの矩形での placeTall と同じ位置', () => {
  for (const mode of ['top', 'oblique', 'side'] as const) {
    for (const fv of views(mode, [W, 6])) {
      for (const kind of ['tree', 'fence', 'wall', 'gate'] as const) {
        const a = tallArt(fv.art, kind, { alt: true, stage: 1 });
        if (!a) continue;
        for (const [c, r] of [
          [0, 0],
          [3, 7],
          [fv.cols - 1, H - 1],
        ] as const) {
          assert.deepEqual(placeTallCell(a, fv, c, r), placeTall(a, fv.cellRect(c, r)));
        }
      }
    }
  }
});

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

test('視点ごとの盤の大きさが design §13.7 の表のとおりで、どれも描き場所 320 × 384 に縮めずに入る', () => {
  const area = AREAS[0]!;
  assert.deepEqual([area.w, area.h], [320, 384]);
  const table: [number, ViewMode, number, number][] = [
    [W, 'top', 320, 384],
    [W, 'oblique', 320, 230],
    [W, 'side', 288, 192],
    [6, 'top', 192, 384],
    [6, 'oblique', 192, 230],
    [6, 'side', 288, 115],
    [5, 'top', 160, 384],
    [5, 'oblique', 160, 230],
    [5, 'side', 288, 96],
  ];
  for (const [width, mode, w, h] of table) {
    const fv = centeredFieldView(area, { width, height: H }, false, mode);
    assert.deepEqual([fv.rect.w, fv.rect.h], [w, h], `${width} ${mode}`);
    assert.ok(fv.rect.x >= area.x && fv.rect.y >= area.y, `${width} ${mode}`);
    assert.ok(fv.rect.x + fv.rect.w <= area.x + area.w && fv.rect.y + fv.rect.h <= area.y + area.h, `${width} ${mode}`);
  }
  // 幅 5 の面は、盤の左端が描き場所の x 80（半マスずらして 2px 単位に揃える）
  assert.equal(centeredFieldView({ x: 0, y: 0, w: 320, h: 384 }, { width: 5, height: H }).rect.x, 80);
});

// ---- 印（旗・号令の印・方針の印・号令の相手の枠）の描く範囲（design §13.14。Codex のコードレビュー 3 回目の P2） ----

test('印の描く先は、どの視点でも境界（uiBounds）からはみ出さない（左端 x=0.45・右端の境目・上下の端。縦長と横長）', () => {
  const inside = (r: Rect, b: Rect): boolean => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
  // engine の移動の限界（端から 0.45 マス）と、そのあいだを細かく
  const xs: number[] = [];
  for (let x = 0.45; x <= W - 0.45 + 1e-9; x += 0.05) xs.push(Math.round(x * 100) / 100);
  const ys = [0.45, 1, H / 2, H - 1, H - 0.45];
  let n = 0;
  for (const l of [computeLayout(390, 760), computeLayout(LANDSCAPE_W, LANDSCAPE_H)]) {
    const area = l.field;
    for (const mode of ['top', 'oblique', 'side'] as const) {
      const fv = centeredFieldView(area, { width: W, height: H }, false, mode);
      const b = fv.uiBounds(area);
      for (const x of xs) {
        for (const y of ys) {
          const p = fv.toScreen(x, y);
          const cx = Math.round(p.x);
          const cy = Math.round(p.y);
          for (const hq of [false, true]) {
            for (const morale of [0, 100]) {
              const r = markRects(markLayout({ cx, cy, hq, standing: fv.standing, morale, bounds: b }), cx, cy);
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
  const fv = centeredFieldView(area, { width: W, height: H }, false, 'top');
  const b = fv.uiBounds(area);
  // まん中の部隊：号令の印 (−16, −16)、方針の印 (−16, 6)、枠 ±16、旗竿は右の 12
  const c = fv.toScreen(W / 2, H / 2);
  const mid = markLayout({ cx: Math.round(c.x), cy: Math.round(c.y), hq: false, standing: false, morale: 100, bounds: b });
  assert.deepEqual(mid.order, { x: MARK_X, y: MARK_X });
  assert.deepEqual(mid.stance, { x: MARK_X, y: 6 });
  assert.deepEqual(mid.frame, { x: -FRAME_HALF, y: -FRAME_HALF, w: FRAME_HALF * 2, h: FRAME_HALF * 2 });
  assert.equal(mid.mirror, false);
  assert.equal(mid.poleX, POLE_X);
  // 左端（x=0.45 → 画面の x 14）：印の左の端が境界の左の端（x 0）にそろう
  const e = fv.toScreen(0.45, H / 2);
  const cx = Math.round(e.x);
  assert.equal(cx, b.x + 14);
  const left = markLayout({ cx, cy: Math.round(e.y), hq: false, standing: false, morale: 100, bounds: b });
  assert.equal(cx + left.order.x, b.x);
  assert.equal(cx + left.stance.x, b.x);
  assert.equal(cx + left.frame.x, b.x);
  // 右端：旗は竿の左に付け替える
  const r = fv.toScreen(W - 0.45, H / 2);
  assert.equal(markLayout({ cx: Math.round(r.x), cy: Math.round(r.y), hq: false, standing: false, morale: 100, bounds: b }).mirror, true);
});
