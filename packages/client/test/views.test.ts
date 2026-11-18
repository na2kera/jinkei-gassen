// 戦闘の画面の視点（design §5.8.5 の V1〜V6、V9、V10）を、画面なしで確かめる。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。
// 「変更前」の式は、§5.8 の作りに直す前の FieldView・UnitSprite・BattleScene.onDown から写した。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirOf, slotsOf, soldierPoint, unitLift } from '../src/art/formation.ts';
import { groundTerrain, placeTall, tallArt } from '../src/art/tallArt.ts';
import { sideArtColors, sideArtRows } from '../src/art/textures.ts';
import { centeredFieldView, type FieldView, type PickTarget, type Point } from '../src/battle/FieldView.ts';
import { nextView, parseView, usableView, VIEW_CYCLE, VIEW_MODES, type ViewMode } from '../src/battle/viewMode.ts';
import { CELL, type Rect } from '../src/layout.ts';
import { VIEW_LABEL } from '../src/ui/labels.ts';

/** 描き場所（12列×16行ぶん）。左上が奇数の所も試す */
const AREAS: Rect[] = [
  { x: 16, y: 40, w: 288, h: 384 },
  { x: 7, y: 13, w: 288, h: 384 },
];
const WIDTHS = [12, 8, 7, 6];

/** V1 と V9 の表。将軍は変換がまだないので、名前だけ残して飛ばす（足すときに skip を外す） */
const MODE_TABLE: { mode: ViewMode; skip?: string }[] = [
  { mode: 'top' },
  { mode: 'oblique' },
  { mode: 'side' },
  { mode: 'general', skip: '将軍の視点はまだない（design §5.8.3）' },
];

function views(mode: ViewMode, widths = WIDTHS): FieldView[] {
  const out: FieldView[] = [];
  for (const area of AREAS) for (const w of widths) for (const flipped of [false, true]) out.push(centeredFieldView(area, { width: w, height: 16 }, flipped, mode));
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
  return new OldView(oldRect(area, { width, height: 16 }, oblique), width, 16, flipped, oblique);
}

// ---- V1 ----

for (const { mode, skip } of MODE_TABLE) {
  test(`V1 ${mode}：toField(toScreen(p)) が p に戻る（返す/返さない、幅 12・8・7・6）`, skip ? { skip } : {}, () => {
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

test('将軍の視点は、まだ FieldView を作れない（変換を足すまで回す順に入れない）', () => {
  assert.throws(() => centeredFieldView(AREAS[0]!, { width: 12, height: 16 }, false, 'general'));
  assert.ok(!VIEW_CYCLE.includes('general'));
});

// ---- V2 ----

test('V2 真上と斜め：toScreen・cellRect・rect・toField が変更前と同じ値', () => {
  for (const area of AREAS) {
    for (const w of WIDTHS) {
      for (const flipped of [false, true]) {
        for (const oblique of [false, true]) {
          const fv = centeredFieldView(area, { width: w, height: 16 }, flipped, oblique ? 'oblique' : 'top');
          const old = oldView(area, w, flipped, oblique);
          assert.deepEqual(fv.rect, old.rect);
          for (let r = 0; r < 16; r++) {
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

/** 変更前：画面の向き d に並びを回し、縦だけ yScale で縮める。戻り値は兵の絵の左上（整数の px）と、選ぶ4方向 */
function oldSoldier(old: OldView, x: number, y: number, fx: number, fy: number, lx: number, ly: number, w: number, h: number): [number, number, number] {
  const p = old.toScreen(x, y);
  const d = old.dirToScreen(fx, fy);
  const rx = -d.y;
  const ry = d.x;
  const wx = p.x + lx * rx - ly * d.x;
  const wy = p.y + (lx * ry - ly * d.y) * old.yScale;
  const top = old.oblique ? Math.round(wy - h + 1) : Math.round(wy - h / 2);
  return [Math.round(wx - w / 2), top, dirOf(d.x, d.y)];
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
    for (const w of [12, 7]) {
      for (const flipped of [false, true]) {
        for (const oblique of [false, true]) {
          const fv = centeredFieldView(area, { width: w, height: 16 }, flipped, oblique ? 'oblique' : 'top');
          const old = oldView(area, w, flipped, oblique);
          const positions: Point[] = [
            { x: 0.5, y: 0.5 },
            { x: w / 2 + 0.5, y: 8.5 },
            { x: w - 0.5, y: 15.5 },
          ];
          for (let i = 0; i < 20; i++) positions.push({ x: rand() * w, y: rand() * 16 });
          const facings = [...FACINGS];
          for (let i = 0; i < 10; i++) {
            const a = rand() * Math.PI * 2;
            facings.push([Math.cos(a), Math.sin(a)]);
          }
          for (const pos of positions) {
            for (const [fx, fy] of facings) {
              for (const kind of ['hq', 'infantry', 'cavalry'] as const) {
                // 敗走中の広がり（1 + 1.2 × 進み具合）。1.6 と 3:4 の向きでは、兵のずれの2つの項がちょうど打ち消し合い、
                // 絵の左上がちょうど半 px に来る。足す順まで変更前と同じでないと 1px 変わるので、その場合も試す
                for (const spread of [1, 1.6, 1 + 1.2 * 0.37]) {
                  for (const s of slotsOf(kind)) {
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
  const top = centeredFieldView(AREAS[0]!, { width: 12, height: 16 }, false, 'top');
  const obl = centeredFieldView(AREAS[0]!, { width: 12, height: 16 }, false, 'oblique');
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
    const obl = centeredFieldView(AREAS[1]!, { width: 12, height: 16 }, flipped, 'oblique');
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 12; col++) {
        const r = obl.cellRect(col, row);
        const bottom = r.y + r.h;
        const tree = placeTall(tallArt('oblique', 'tree', { alt: (col + row) % 2 !== 0 })!, r);
        assert.deepEqual(tree, { x: r.x + ((col + row) % 2 === 0 ? 6 : 18), y: bottom - 2, depth: bottom - 2 });
        assert.deepEqual(placeTall(tallArt('oblique', 'fence')!, r), { x: r.x, y: bottom, depth: bottom - 1 });
        assert.deepEqual(placeTall(tallArt('oblique', 'wall')!, r), { x: r.x, y: bottom, depth: bottom });
        assert.deepEqual(placeTall(tallArt('oblique', 'gate', { stage: 2 })!, r), { x: r.x, y: r.y + r.h, depth: r.y + r.h });
      }
    }
  }
  const top = centeredFieldView(AREAS[0]!, { width: 12, height: 16 }, false, 'top');
  const r = top.cellRect(5, 5);
  const g = tallArt('flat', 'gate', { stage: 1 })!;
  assert.equal(g.key, 'gate-1');
  assert.deepEqual([g.originX, g.originY], [0, 0]);
  assert.deepEqual(placeTall(g, r), { x: r.x, y: r.y, depth: r.y });
  assert.equal(tallArt('flat', 'wall'), null);
  assert.equal(tallArt('oblique', 'wall')!.key, 'tall-wall');
  assert.equal(tallArt('oblique', 'gate', { stage: 1 })!.key, 'tall-gate-1');
  assert.equal(groundTerrain('flat', 'fence'), 'fence');
  assert.equal(groundTerrain('oblique', 'fence'), 'fence');
});

// ---- V3〜V5（横から） ----

test('V3 横から：自軍の本陣が左、敵の本陣が右。自軍の左翼が上、右翼が下。rect の幅が 288px', () => {
  for (const fv of views('side')) {
    assert.equal(fv.rect.w, 288);
    // 返したときは、自軍（陣営1）は戦場の座標の上の端にいる
    const ownY = fv.flipped ? 0.5 : 15.5;
    const enemyY = fv.flipped ? 15.5 : 0.5;
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
    assert.ok(fv.rect.x >= AREAS[0]!.x - 20 && fv.rect.h <= 173);
  }
  const area = AREAS[0]!;
  const fv = centeredFieldView(area, { width: 12, height: 16 }, false, 'side');
  assert.deepEqual(fv.rect, { x: area.x, y: area.y + 106, w: 288, h: 173 });
  assert.deepEqual(fv.uiBounds(area), area);
  assert.equal(fv.standing, true);
  assert.equal(fv.depthSorted, true);
  assert.equal(fv.masked, false);
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
      assert.equal(q.w, 18);
      assert.ok(q.h === 14 || q.h === 15);
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
    for (const fv of views(mode, [12, 6])) {
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
  const fv = centeredFieldView(AREAS[0]!, { width: 12, height: 16 }, false, 'side');
  assert.equal(groundTerrain(fv.art, 'fence'), 'plain');
  assert.equal(groundTerrain(fv.art, 'wall'), 'wall');
  const r = fv.cellRect(5, 5);
  for (const kind of ['fence', 'wall', 'gate'] as const) {
    const a = tallArt('side', kind, { stage: 2 })!;
    assert.ok(a.key.startsWith('side-'));
    const p = placeTall(a, r);
    // 下の端をマスの手前の端に合わせる
    assert.deepEqual([p.x, p.y], [r.x, r.y + r.h]);
  }
  // 木は、マスの中で隣のマスと互い違い
  const t0 = placeTall(tallArt('side', 'tree', { alt: false })!, r);
  const t1 = placeTall(tallArt('side', 'tree', { alt: true })!, r);
  assert.ok(t0.x >= r.x && t1.x <= r.x + r.w && t0.x < t1.x);
  // 絵の並びは矩形で、知らない文字がない。幅はマスと同じ 18px、城壁と門の上の面は 15 行以上
  const colors = sideArtColors();
  for (const [key, rows] of Object.entries(sideArtRows())) {
    for (const line of rows) {
      assert.equal(line.length, 18, key);
      for (const ch of line) assert.ok(ch === '.' || colors[ch] !== undefined, `${key} ${ch}`);
    }
  }
});

// ---- V6 ----

test('V6 保存：view に4つの値が入り、読み戻せる。知らない値は top', () => {
  for (const v of VIEW_MODES) {
    // 保存は JSON にして localStorage に置くので、文字に直して戻しても同じ値になる
    const back = parseView(JSON.parse(JSON.stringify({ view: v })).view);
    assert.equal(back, v);
  }
  for (const bad of ['', 'Top', 'front', 3, null, undefined, {}]) assert.equal(parseView(bad), 'top');
});

test('視点のボタン：真上 → 斜め → 横 → 真上 と回り、将軍が保存されていたら真上として扱う', () => {
  assert.equal(nextView('top'), 'oblique');
  assert.equal(nextView('oblique'), 'side');
  assert.equal(nextView('side'), 'top');
  assert.equal(usableView('general'), 'top');
  assert.equal(nextView('general'), 'oblique');
  assert.deepEqual(
    VIEW_CYCLE.map((v) => VIEW_LABEL[v]),
    ['視点：真上', '視点：斜め', '視点：横'],
  );
  assert.equal(VIEW_LABEL.general, '視点：将軍');
});

// ---- V9 ----

const DIR_VEC: Record<number, Point> = { 0: { x: 0, y: -1 }, 1: { x: 1, y: 0 }, 2: { x: 0, y: 1 }, 3: { x: -1, y: 0 } };

for (const { mode, skip } of MODE_TABLE) {
  test(`V9 ${mode}：兵の並びと向き（前の列が向きの側、右手が右、4方向の絵が画面の向きと合う）`, skip ? { skip } : {}, () => {
    for (const flipped of [false, true]) {
      const fv = centeredFieldView(AREAS[0]!, { width: 12, height: 16 }, flipped, mode);
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
    const fv = centeredFieldView(AREAS[0]!, { width: 12, height: 16 }, flipped, 'side');
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
  { id: 1, x: 5.5, y: 14.5 },
  { id: 2, x: 6.4, y: 14.5 },
  { id: 3, x: 3.2, y: 9.1 },
  { id: 4, x: 3.7, y: 9.4 },
  { id: 5, x: 8.5, y: 8.5 },
  { id: 6, x: 8.5, y: 8.5 },
  { id: 7, x: 0.3, y: 0.2 },
  { id: 8, x: 11.8, y: 15.9 },
  { id: 9, x: 6.05, y: 4.33 },
];

test('V10 真上と斜め：変更の前後で、押した位置から選ばれる部隊が同じ', () => {
  let hits = 0;
  for (const area of AREAS) {
    for (const flipped of [false, true]) {
      for (const oblique of [false, true]) {
        const fv = centeredFieldView(area, { width: 12, height: 16 }, flipped, oblique ? 'oblique' : 'top');
        const old = oldView(area, 12, flipped, oblique);
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
    const fv = centeredFieldView(AREAS[0]!, { width: 12, height: 16 }, flipped, 'side');
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
    // 隣の列の2部隊（画面の縦に 14.4px 離れて重なる）のあいだを押すと、手前（画面の下）の部隊
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
