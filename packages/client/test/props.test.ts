// 柵・城壁・城門の立体（art/stack/props.ts。design §16）を、画面なしで確かめる。
// 試作（proto17v2/art.js）がこの機械にあれば、node の vm で読み、1マス 32（setTileSize(32)）で焼いた絵と画素まで一致することを確かめる。
// 試作がないときは、その比べ方を飛ばす（兵と木の絵は stackArt.test.ts の GOLDEN で、地形の絵は props.golden.json で確かめる）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import type { Field } from '@jinkei/engine';
import { angleOf, ANGLES, bakeGeom, bakeOne, colorTable, type Geom } from '../src/art/stack/bake.ts';
import { voxelCount, type Model } from '../src/art/stack/carve.ts';
import { connName, connOf, familyIds, familyOf, fenceEdge, groupOf, lineDepth, PROP_H, PROP_IDS, propModel, propPlaces, propVox, terrainGroups, TS, type DepthLine, type PropFamily, type PropId } from '../src/art/stack/props.ts';
import { abgr } from '../src/art/stack/bake.ts';
import { ART, COLOR, SIDE_COLOR, TERRAIN } from '../src/art/palette.ts';

const PROTO_DIR = process.env.JG_PROTO_DIR ?? new URL('../../../../../proto17v2/', import.meta.url).pathname;
const HAVE_PROTO = fs.existsSync(path.join(PROTO_DIR, 'art.js'));
const SKIP_PROTO = HAVE_PROTO ? false : `試作がない（${PROTO_DIR}）`;

interface ProtoModel {
  R: number;
  H: number;
}
interface Proto {
  procModel: (H: number, fill: unknown, conn: unknown, label: string) => { m: ProtoModel; mask: ProtoModel | null };
  wallFill: (conn: unknown) => unknown;
  gateFill: () => unknown;
  fenceFill: () => unknown;
  setTileSize: (n: number) => void;
  bakeGeom: (R: number, H: number, s: number) => Geom;
  bakeOne: (buf: Uint32Array, bw: number, ox: number, oy: number, g: Geom, m: unknown, angle: number, s: number, cmap: unknown, vi: Int32Array, mask: unknown, maskOff: Int32Array | null) => void;
  cmapFor: (team: number) => unknown;
  ANGLES: number;
}

function loadProto(): Proto {
  const ctx = vm.createContext({ Math, Array, Object, JSON, Error, Map, Set, Uint8Array, Uint32Array, Int32Array, Float32Array });
  const art = fs.readFileSync(path.join(PROTO_DIR, 'art.js'), 'utf8');
  const p = vm.runInContext(`${art}\n;({ procModel, wallFill, gateFill, fenceFill, setTileSize, bakeGeom, bakeOne, cmapFor, ANGLES })`, ctx) as Proto;
  p.setTileSize(TS);
  return p;
}
const PROTO: Proto | null = HAVE_PROTO ? loadProto() : null;

/** 試作の型（gate0 のほか、試作にない gate1・gate2 は作らない） */
function protoProp(id: PropId): { m: ProtoModel; mask: ProtoModel | null } {
  const P = PROTO!;
  const f = familyOf(id);
  if (f === 'gate') return P.procModel(27, P.gateFill(), { E: true, W: true }, id);
  const s = id.replace(/^(wall|fence)/, '');
  const conn = { N: false, S: false, E: s.includes('E'), W: s.includes('W') };
  return f === 'wall' ? P.procModel(24, P.wallFill(conn), conn, id) : P.procModel(12, P.fenceFill(), conn, id);
}

/** 系統の枠（全部の型の本体と mask の半径のうち、いちばん大きいもの） */
function familyGeom(f: PropFamily, s: number): Geom {
  let R = 0;
  for (const id of familyIds(f)) {
    const pm = propModel(id);
    R = Math.max(R, pm.m.R, pm.mask ? pm.mask.R : 0);
  }
  return bakeGeom(R, PROP_H[f], s);
}

function mineFrame(id: PropId, a: number, s: number): Uint32Array {
  const g = familyGeom(familyOf(id), s);
  const pm = propModel(id);
  const buf = new Uint32Array(g.fw * g.fh);
  bakeOne(buf, g.fw, 0, 0, g, pm.m, angleOf(a), s, colorTable(0), new Int32Array(g.fw * g.fh), pm.mask, new Int32Array(g.fw * g.fh));
  return buf;
}

function protoFrame(id: PropId, a: number, s: number): Uint32Array {
  const P = PROTO!;
  const g = familyGeom(familyOf(id), s);
  const pm = protoProp(id);
  const buf = new Uint32Array(g.fw * g.fh);
  P.bakeOne(buf, g.fw, 0, 0, g, pm.m, ((a * 2) / P.ANGLES) * Math.PI * 2, s, P.cmapFor(0), new Int32Array(g.fw * g.fh), pm.mask, new Int32Array(g.fw * g.fh));
  return buf;
}

/** 組 A の大きさ 1 の 13 の向きと、止まった 4 枚（向き・大きさ） */
const CASES: readonly (readonly [number, number])[] = [...[33, 34, 35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((a) => [a, 1] as const), [0, 0.94], [3, 0.65], [33, 0.65], [9, 0.79]];
const MATCHED: readonly PropId[] = PROP_IDS.filter((id) => id !== 'gate1' && id !== 'gate2');

test('P1 柵・城壁・gate0 の箱が、試作の procModel と同じ（本体と mask の箱の数・半径）', { skip: SKIP_PROTO }, () => {
  for (const id of MATCHED) {
    const mine = propModel(id);
    const theirs = protoProp(id);
    assert.equal(mine.m.R, theirs.m.R, `${id} R`);
    assert.equal(!!mine.mask, !!theirs.mask, `${id} mask の有無`);
    if (mine.mask && theirs.mask) assert.equal(mine.mask.R, theirs.mask.R, `${id} mask R`);
  }
});

test('P2 柵 4・城壁 4・gate0 を、組 A の 13 の向き（大きさ 1）と止まった 4 枚で焼いた絵が、試作と画素まで同じ', { skip: SKIP_PROTO }, () => {
  for (const id of MATCHED)
    for (const [a, s] of CASES) {
      const mine = mineFrame(id, a, s);
      const theirs = protoFrame(id, a, s);
      let diff = 0;
      for (let i = 0; i < mine.length; i++) if (mine[i] !== theirs[i]) diff++;
      assert.equal(diff, 0, `${id} 向き ${a} 大きさ ${s}：${diff} 画素ちがう`);
      assert.ok(mine.some((v) => v !== 0), `${id} ${a} ${s} が空`);
    }
});

test('P3 枠の大きさ（大きさ 1）が design §16.4 の表と合う：城壁 46×61、城門 46×64、柵 54×55', () => {
  const g = (f: PropFamily): [number, number] => {
    const x = familyGeom(f, 1);
    return [x.fw, x.fh];
  };
  assert.deepEqual(g('wall'), [46, 61]);
  assert.deepEqual(g('gate'), [46, 64]);
  assert.deepEqual(g('fence'), [54, 55]);
});

test('P4 城門の傷み具合：gate1・gate2 は gate0 から箱を抜いただけ（新しい色なし）、段ごとに減る', () => {
  const v = [0, 1, 2].map((i) => propVox(`gate${i}` as PropId));
  const n = v.map((x) => voxelCount({ vox: x.own } as Model));
  assert.ok(n[0]! > n[1]! && n[1]! > n[2]!, `箱の数 ${n.join(' ')}`);
  for (const k of [1, 2])
    for (let i = 0; i < v[0]!.own.length; i++) {
      const a = v[0]!.own[i]!;
      const b = v[k]!.own[i]!;
      if (b) assert.equal(b, a, `gate${k} の箱 ${i} が gate0 と違う色`);
    }
  // 抜いた所：gate1 は板 2 か所と右上の角、gate2 はそれに加えて合わせ目・左下・梁の下の縁
  const at = (k: number, x: number, y: number, z: number): number => v[k]!.own[(z * 40 + y + 4) * 40 + x + 4]!;
  assert.ok(at(0, 10, 16, 8) && !at(1, 10, 16, 8));
  assert.ok(at(1, 15, 16, 4) && !at(2, 15, 16, 4));
  assert.ok(at(1, 11, 16, 17) && !at(2, 11, 16, 17));
  // 柱と屋根は残る
  assert.ok(at(2, 2, 16, 5) && at(2, 16, 16, 25));
});

test('P5 焼いた地形の絵に出る色は、色の一覧（palette.ts）の中だけ', () => {
  const allowed = new Set<number>([0]);
  for (const c of [...Object.values(COLOR), ...Object.values(ART), ...Object.values(TERRAIN), ...Object.values(SIDE_COLOR[0]), ...Object.values(SIDE_COLOR[1])]) allowed.add(abgr(c));
  for (const id of PROP_IDS)
    for (const [a, s] of CASES) for (const v of mineFrame(id, a, s)) assert.ok(allowed.has(v), `${id} に一覧にない色 ${v.toString(16)}`);
});

// ---- つながり方と置き方 ----

function field(w: number, h: number, rows: Record<number, string>): Field {
  const terrain: Field['terrain'] = [];
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const ch = rows[r]?.[c] ?? '.';
      terrain.push(ch === '#' ? 'wall' : ch === '-' ? 'fence' : 'plain');
    }
  return { width: w, height: h, terrain, zones: [{ col: 0, row: h - 3, width: w, height: 3 }, { col: 0, row: 0, width: w, height: 3 }] } as Field;
}

const ids = (f: Field, gate: { col: number; row: number } | null, row: number, broken: boolean, stage: 0 | 1 | 2 = 0): string =>
  Array.from({ length: f.width }, (_, c) => propPlaces(f, gate, stage, broken).find((p) => p.col === c && p.row === row)?.id ?? '.').join(' ');

test('P6 connOf：城壁は門とつながり、盤の端で閉じる。破れたあとは崩れた 3 マスを何もないとして数え直す', () => {
  const f = field(10, 12, { 3: '####.#####' });
  const g = { col: 4, row: 3 };
  assert.equal(ids(f, g, 3, false), 'wallE wallEW wallEW wallEW gate0 wallEW wallEW wallEW wallEW wallW');
  assert.equal(ids(f, g, 3, false, 2), 'wallE wallEW wallEW wallEW gate2 wallEW wallEW wallEW wallEW wallW');
  assert.equal(ids(f, g, 3, true), 'wallE wallEW wallW . . . wallE wallEW wallEW wallW');
  assert.deepEqual(connOf(f, g, 4, 3, false), { E: true, W: true });
  assert.equal(connOf(f, g, 4, 3, true), null);
  // 門が端から 1 マス目：崩れるのは端で切った 2 マス（門と東の隣）
  const f1 = field(10, 12, { 3: '#.########' });
  assert.equal(ids(f1, { col: 1, row: 3 }, 3, true), '. . . wallE wallEW wallEW wallEW wallEW wallEW wallW');
  // 門が端から 2 マス目：西に城壁が 1 マスだけ残り、柱の型になる
  const f2 = field(10, 12, { 3: '##.#######' });
  assert.equal(ids(f2, { col: 2, row: 3 }, 3, true), 'wall . . . wallE wallEW wallEW wallEW wallEW wallW');
  // 幅 5 の盤
  const f5 = field(5, 12, { 3: '##.##' });
  assert.equal(ids(f5, { col: 2, row: 3 }, 3, false), 'wallE wallEW gate0 wallEW wallW');
  assert.equal(ids(f5, { col: 2, row: 3 }, 3, true), 'wall . . . wall');
});

test('P7 柵：東西の隣が柵ならつながる。自軍の側の行は北の縁（回さない）、敵の側の行は南の縁（18 回し、片側の型は東西を入れ替える）', () => {
  const f = field(10, 12, { 8: '...----...', 2: '.---......' });
  assert.equal(ids(f, null, 8, false), '. . . fenceE fenceEW fenceEW fenceW . . .');
  assert.equal(fenceEdge(f, 8), 'N');
  assert.equal(fenceEdge(f, 2), 'S');
  // 南の縁：東の隣とつながる柵（列 1）は fenceW を 180° 回したもの
  assert.equal(ids(f, null, 2, false), '. fenceW fenceEW fenceE . . . . . .');
  const north = propPlaces(f, null).filter((p) => p.row === 8);
  const south = propPlaces(f, null).filter((p) => p.row === 2);
  for (const p of north) {
    assert.equal(p.rot, 0);
    assert.ok(Math.abs((p.dy - (p.row + 0.5)) * TS + 13) < 1e-9, '柵の線は、マスのまん中から北へ 13px');
  }
  for (const p of south) {
    assert.equal(p.rot, 18);
    assert.ok(Math.abs((p.dy - (p.row + 0.5)) * TS - 13) < 1e-9, '柵の線は、マスのまん中から南へ 13px');
  }
  // 1 マスだけの柵、盤の端
  const g = field(10, 12, { 8: '-........-' });
  assert.equal(ids(g, null, 8, false), 'fence . . . . . . . . fence');
  assert.equal(connName('fence', { E: true, W: false }, true), 'fenceW');
  assert.equal(connName('fence', { E: true, W: true }, true), 'fenceEW');
  assert.equal(connName('fence', { E: false, W: false }, true), 'fence');
});

test('P8 向きの組：返す・返さない × 回す量 0・18', () => {
  assert.equal(groupOf(0, false), 'A');
  assert.equal(groupOf(18, true), 'A');
  assert.equal(groupOf(18, false), 'B');
  assert.equal(groupOf(0, true), 'B');
  const own = field(10, 12, { 8: '...----...' });
  const both = field(10, 12, { 8: '...----...', 2: '--........' });
  const wall = field(10, 12, { 3: '####.#####' });
  assert.deepEqual(terrainGroups(own, null, false), ['A']);
  assert.deepEqual(terrainGroups(own, null, true), ['B']);
  assert.deepEqual(terrainGroups(both, null, false), ['A', 'B']);
  assert.deepEqual(terrainGroups(wall, { col: 4, row: 3 }, false), ['A']);
  assert.deepEqual(terrainGroups(field(10, 12, {}), null, false), []);
});

// ---- 兵との前後（design §16.5） ----

const DEG = Math.PI / 180;
const WALL: DepthLine = { x: 4.5, y: 3.5, T: 6, Hb: 22 };
const GATE: DepthLine = { x: 4.5, y: 3.5, T: 9, Hb: 27 };

/** 盤の回転 rot（返した表示なら flipped）・縮み k の、足もとの depth（BoardView.project と同じ式の、盤のまん中を原点にした値） */
function depthAt(rot: number, flipped: boolean, k: number, x: number, y: number): number {
  let u = (x - 5) * TS;
  let v = (y - 6) * TS;
  if (flipped) {
    u = -u;
    v = -v;
  }
  return k * 0.75 * (u * Math.sin(rot) + v * Math.cos(rot));
}

test('P9 lineDepth：|cosθ| が 0.5 の両側で、直す・直さないが分かれる。重なりうる範囲の外は直さない', () => {
  const k = 0.65;
  for (const L of [WALL, GATE]) {
    // 線のすぐ北（奥の側）22.8px、線に沿って少しずれた兵
    const x = L.x + 0.3;
    const y = L.y - 22.8 / TS;
    for (const deg of [59, 61]) {
      const th = deg * DEG;
      const dl = depthAt(th, false, k, L.x, L.y);
      const ds = depthAt(th, false, k, x, y);
      const got = lineDepth([L], [dl], th, x, y, ds, 0.84 / k);
      if (Math.abs(Math.cos(th)) < 0.5) assert.equal(got, ds, `${deg}° は直さない`);
      else assert.ok(got < dl, `${deg}° は線より奥に直す（${got} < ${dl}）`);
    }
    // 重なりうる範囲の外（線に沿って 3 マス離れた兵）は直さない
    const th = 45 * DEG;
    const far = { x: L.x + 3, y: L.y - 1 };
    const dfar = depthAt(th, false, k, far.x, far.y);
    assert.equal(lineDepth([L], [depthAt(th, false, k, L.x, L.y)], th, far.x, far.y, dfar, 0.84 / k), dfar);
  }
});

test('P10 lineDepth：手前の側と奥の側の兵が、どの θ でも（直すときは）線の正しい側にあり、同じ線に直された兵どうしの順が変わらない', () => {
  const k = 0.65;
  const thetas = [-30, 0, 30, 45, 59, 61, 75, 90, 150, 180, 210, 225, 239];
  for (const L of [WALL, GATE]) {
    const minPerp = (L === WALL ? 22.8 : 21) / TS;
    for (const deg of thetas) {
      const flipped = deg >= 135;
      const rot = (flipped ? deg - 180 : deg) * DEG;
      const th = deg * DEG;
      const dl = depthAt(rot, flipped, k, L.x, L.y);
      for (const side of [-1, 1]) {
        const pts: { x: number; y: number }[] = [];
        for (const a of [-0.6, -0.3, 0, 0.3, 0.6]) for (const p of [0, 0.15, 0.3]) pts.push({ x: L.x + a, y: L.y + side * (minPerp + p) });
        const before = pts.map((p) => depthAt(rot, flipped, k, p.x, p.y));
        const after = pts.map((p, i) => lineDepth([L], [dl], th, p.x, p.y, before[i]!, 0.84 / k));
        // 手前の側か（perp × cosθ > 0）
        const front = side * Math.cos(th) > 0;
        if (Math.abs(Math.cos(th)) >= 0.5) {
          for (let i = 0; i < pts.length; i++) {
            if (after[i] === before[i]) continue;
            if (front) assert.ok(after[i]! > dl, `${deg}° 手前の兵が線より奥`);
            else assert.ok(after[i]! < dl, `${deg}° 奥の兵が線より手前`);
          }
          // 直された兵どうしの順
          for (let i = 0; i < pts.length; i++)
            for (let j = 0; j < pts.length; j++) {
              if (before[i]! < before[j]! && after[i] !== before[i] && after[j] !== before[j]) assert.ok(after[i]! < after[j]!, `${deg}° 順が変わった`);
            }
        } else assert.deepEqual(after, before, `${deg}° は直さない`);
        // 止まった向き（返した表示を含む）では、足もとの depth だけで正しい側にあるので、直しても順は同じ
        if ([-30, 0, 30, 90, 150, 180, 210].includes(deg))
          for (let i = 0; i < pts.length; i++) {
            if (Math.abs(Math.cos(th)) < 1e-9) continue;
            if (front) assert.ok(before[i]! > dl);
            else assert.ok(before[i]! < dl);
          }
      }
    }
  }
});

test('P11 lineDepth：兵の残りの棒（兵の depth に 1.4 × k × 0.75 + 0.01 を足した値）を、兵の足もとで通すと、兵と同じ側に収まり、兵より手前のまま', () => {
  const k = 0.65;
  for (const L of [WALL, GATE])
    for (const deg of [0, 30, 45, 59, 210, 225]) {
      const flipped = deg >= 135;
      const rot = (flipped ? deg - 180 : deg) * DEG;
      const th = deg * DEG;
      const dl = depthAt(rot, flipped, k, L.x, L.y);
      for (const side of [-1, 1])
        for (const a of [-0.5, 0, 0.5]) {
          const p = { x: L.x + a, y: L.y + (side * 21) / TS };
          const raw = depthAt(rot, flipped, k, p.x, p.y);
          const body = lineDepth([L], [dl], th, p.x, p.y, raw, 0.84 / k);
          const bar = lineDepth([L], [dl], th, p.x, p.y, raw + 1.4 * k * 0.75 + 0.01, 0.84 / k);
          assert.ok(bar > body, `${deg}° 棒が兵より奥`);
          assert.equal(bar > dl, body > dl, `${deg}° 棒と兵が線の別の側`);
        }
    }
});

test('P12 線がなければ何もしない', () => {
  assert.equal(lineDepth([], [], 0.5, 1, 2, 123.4, 1), 123.4);
});

test('P13 BoardView.lineDepth：線を登録すると、盤の回転（返した表示は 180° 足す）で直す。線を外すとそのまま', async () => {
  const { BoardView, deg } = await import('../src/battle/BoardView.ts');
  const area = { x: 0, y: 0, w: 390, h: 500 };
  for (const flipped of [false, true])
    for (const r of [0, 45, 59]) {
      const bv = new BoardView(area, { width: 10, height: 12 }, { flipped, cam: { rot: deg(r), k: 0.65 } });
      const p = { x: WALL.x + 0.2, y: WALL.y + (flipped ? 1 : -1) * (22.8 / TS) };
      const d = bv.project(p.x, p.y).depth;
      assert.equal(bv.lineDepth(p.x, p.y, d, 1.3), d, '線がなければそのまま');
      bv.setLines([WALL]);
      const want = lineDepth([WALL], [bv.project(WALL.x, WALL.y).depth], bv.groundRotation, p.x, p.y, d, 1.3);
      assert.equal(bv.lineDepth(p.x, p.y, d, 1.3), want);
      if (r === 45) assert.ok(want < bv.project(WALL.x, WALL.y).depth, `${flipped ? '返した表示' : 'ふつう'} 45°：奥の兵は線より奥`);
      bv.setLines([]);
      assert.equal(bv.lineDepth(p.x, p.y, d, 1.3), d);
    }
});
