// 立体の絵の計算（art/stack。design §14.2・§14.3・§14.15）を、画面なしで確かめる。
// 試作（proto17v2/art.js・main.js）がこの機械にあれば、それを node の vm で読み、同じ型・同じ角度・同じ大きさで焼いた画素が一致することを確かめる。
// 試作の場所は JG_PROTO_DIR で変えられる。試作がないとき（scratchpad は消えることがある）は、その比べ方を飛ばし、
// 試作と一致することを確かめたときに記録した画素の要約（GOLDEN）と比べる。
// node --experimental-strip-types --test で動かす。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { abgr, ANGLES, bakeGeom, bakeOne, colorTable, sheetLayout, TEX_MAX } from '../src/art/stack/bake.ts';
import { carve, makeModel, voxelCount, type Model } from '../src/art/stack/carve.ts';
import { buildHeight, heightAt, HILL_MAX } from '../src/art/stack/height.ts';
import { BakeQueue, BATTLE_SCALE, revealAngles, setSheets, startupTasks, soldierFrameName, treeFrameName, type BakedSheet, type SetId, type TaskSpec } from '../src/art/stack/jobs.ts';
import { centerOf, colorsFor, dimsOf, MODEL_IDS, modelParts, TREE_DIMS, TREE_IDS, treeParts, WALK_FRAMES, type ModelId } from '../src/art/stack/parts.ts';
import { countFor, modelFor, slotOffset } from '../src/art/stack/squad.ts';
import { ART, COLOR, SIDE_COLOR, TERRAIN } from '../src/art/palette.ts';

const PROTO_DIR = process.env.JG_PROTO_DIR ?? '/private/tmp/claude-501/-Users-keranatsuki-dev/9e43ce8f-2131-4df5-a974-08fd67e898f4/scratchpad/proto17v2';
const HAVE_PROTO = fs.existsSync(path.join(PROTO_DIR, 'art.js')) && fs.existsSync(path.join(PROTO_DIR, 'main.js'));
const SKIP_PROTO = HAVE_PROTO ? false : `試作がない（${PROTO_DIR}）。GOLDEN との比べで代える`;

// ---- 全部を 1 回焼いておく ----

function bakeAll(tasks: TaskSpec[], n = ANGLES): Map<string, BakedSheet> {
  const out = new Map<string, BakedSheet>();
  const q = new BakeQueue((s) => out.set(s.key, s), { n });
  q.push(tasks);
  q.runAll();
  return out;
}
const allTasks = (n = ANGLES): TaskSpec[] => [...startupTasks(n), ...setSheets('reveal', n).map((spec): TaskSpec => ({ t: 'sheet', spec }))];
const SHEETS = bakeAll(allTasks());

/** 絵の中の 1 コマを切り出す */
function crop(s: BakedSheet, name: string): Uint32Array {
  const f = s.frames.find((x) => x.name === name);
  assert.ok(f, `コマがない：${s.key} ${name}`);
  const buf = new Uint32Array(s.rgba);
  const out = new Uint32Array(s.g.fw * s.g.fh);
  for (let y = 0; y < s.g.fh; y++) for (let x = 0; x < s.g.fw; x++) out[y * s.g.fw + x] = buf[(f.y + y) * s.w + f.x + x]!;
  return out;
}

/** 画素の要約（FNV-1a） */
function hash(a: Uint32Array): string {
  let h = 0x811c9dc5;
  for (const v of a) {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ---- 試作を読む ----

interface Proto {
  carve: (dims: unknown, entries: unknown, label: string) => (string | null)[];
  makeModel: (dims: unknown, vox: unknown, opts?: unknown) => { R: number; H: number };
  bakeGeom: (R: number, H: number, s: number) => { fw: number; fh: number; ax: number; ay: number };
  bakeOne: (buf: Uint32Array, bw: number, ox: number, oy: number, g: unknown, m: unknown, angle: number, s: number, cmap: unknown, vi: Int32Array, mask: null, maskOff: null) => void;
  cmapFor: (team: number) => unknown;
  modelParts: (id: string, f: number) => unknown;
  treeModel: (v: number) => { R: number; H: number };
  HUMAN: unknown;
  HORSE: unknown;
  ANGLES: number;
  buildHeight: (map: string[], hmax: number) => Float32Array;
  heightAt: (hm: Float32Array, u: number, v: number) => number;
}

function loadProto(): Proto {
  const ctx = vm.createContext({ Math, Array, Object, JSON, Error, Map, Set, Uint8Array, Uint32Array, Int32Array, Float32Array });
  const art = fs.readFileSync(path.join(PROTO_DIR, 'art.js'), 'utf8');
  const p = vm.runInContext(`${art}\n;({ carve, makeModel, bakeGeom, bakeOne, cmapFor, modelParts, treeModel, HUMAN, HORSE, ANGLES })`, ctx) as Omit<Proto, 'buildHeight' | 'heightAt'>;
  // 丘の高さは main.js の buildHeight・heightAt を切り出して、盤 10×12・1マス 32 で読む
  const main = fs.readFileSync(path.join(PROTO_DIR, 'main.js'), 'utf8');
  const a = main.indexOf('function buildHeight');
  const b = main.indexOf('class ProtoScene');
  assert.ok(a > 0 && b > a, 'main.js の buildHeight が見つからない');
  const hctx = vm.createContext({ Math, Float32Array, CELL: 32, COLS: 10, ROWS: 12, BOARD_W: 320, BOARD_H: 384, HILL_RAMP: 30 });
  const h = vm.runInContext(`${main.slice(a, b)}\n;({ buildHeight, heightAt })`, hctx) as Pick<Proto, 'buildHeight' | 'heightAt'>;
  return { ...p, ...h };
}
const PROTO: Proto | null = HAVE_PROTO ? loadProto() : null;

/** 試作で、型の並び list（大きさ s・その枠）の 1 コマを焼く。angle72 は試作の角度の番号（72 刻み） */
function protoFrame(models: { R: number; H: number }[], m: unknown, angle72: number, s: number, team: 0 | 1): Uint32Array {
  const P = PROTO!;
  const R = Math.max(...models.map((x) => x.R));
  const H = Math.max(...models.map((x) => x.H));
  const g = P.bakeGeom(R, H, s);
  const buf = new Uint32Array(g.fw * g.fh);
  const vi = new Int32Array(g.fw * g.fh);
  P.bakeOne(buf, g.fw, 0, 0, g, m, (angle72 / P.ANGLES) * Math.PI * 2, s, P.cmapFor(team), vi, null, null);
  return buf;
}

const protoModels = new Map<string, { R: number; H: number }>();
function protoModel(id: ModelId, f: number): { R: number; H: number } {
  const k = `${id}|${f}`;
  let m = protoModels.get(k);
  if (!m) {
    const P = PROTO!;
    m = P.makeModel(id === 'cavalry' ? P.HORSE : P.HUMAN, P.carve(id === 'cavalry' ? P.HORSE : P.HUMAN, P.modelParts(id, f), k), id === 'cavalry' ? { cy: 13 } : {});
    protoModels.set(k, m);
  }
  return m;
}

/** 試作の角度の番号（72 刻み）。こちらの番号 a（N 刻み）と同じ向き */
const to72 = (a: number): number => (a * 72) / ANGLES;

// ---- 試作と同じ絵 ----

test('S1 削り出し：8 つの型 × 歩く 4 コマと木 2 種の箱が、試作と同じ', { skip: SKIP_PROTO }, () => {
  const P = PROTO!;
  for (const id of MODEL_IDS)
    for (let f = 0; f < WALK_FRAMES; f++) {
      const mine = carve(dimsOf(id), modelParts(id, f), `${id} ${f}`);
      const theirs = P.carve(id === 'cavalry' ? P.HORSE : P.HUMAN, P.modelParts(id, f), id);
      assert.equal(mine.length, theirs.length);
      for (let i = 0; i < mine.length; i++) assert.equal(mine[i] ? String.fromCharCode(mine[i]!) : null, theirs[i], `${id} ${f} ${i}`);
    }
});

test('S2 戦闘の揃い（0.84）：8 つの型 × 両軍 × 歩く 4 コマ × 全部の角度が、試作の同じ向きの絵と画素まで同じ', { skip: SKIP_PROTO }, () => {
  for (const id of MODEL_IDS) {
    const s = SHEETS.get(`stk-battle-${id}`)!;
    const models = [0, 1, 2, 3].map((f) => protoModel(id, f));
    for (const team of [0, 1] as const)
      for (let f = 0; f < WALK_FRAMES; f++)
        for (let a = 0; a < ANGLES; a++) {
          const want = protoFrame(models, models[f], to72(a), BATTLE_SCALE, team);
          assert.equal(hash(crop(s, soldierFrameName(team, f, a))), hash(want), `${id} 軍${team} コマ${f} 角度${a}`);
        }
  }
});

test('S3 配置・公開の揃い（大きさ 1）：試作の同じ向きの絵と画素まで同じ', { skip: SKIP_PROTO }, () => {
  for (const id of MODEL_IDS) {
    const m0 = protoModel(id, 0);
    const dep = SHEETS.get(`stk-deploy-${id}`)!;
    assert.equal(hash(crop(dep, soldierFrameName(0, 0, 0))), hash(protoFrame([m0], m0, 0, 1, 0)), `${id} 配置 自軍`);
    assert.equal(hash(crop(dep, soldierFrameName(1, 0, ANGLES / 2))), hash(protoFrame([m0], m0, 36, 1, 1)), `${id} 配置 敵軍`);
    const rev = SHEETS.get(`stk-reveal-${id}`)!;
    for (const a of revealAngles()) {
      assert.equal(hash(crop(rev, soldierFrameName(0, 0, a))), hash(protoFrame([m0], m0, to72(a), 1, 0)), `${id} 公開 自軍 ${a}`);
      const b = (a + ANGLES / 2) % ANGLES;
      assert.equal(hash(crop(rev, soldierFrameName(1, 0, b))), hash(protoFrame([m0], m0, to72(b), 1, 1)), `${id} 公開 敵軍 ${b}`);
    }
  }
});

test('S4 木の揃い：2 種 × 全部の角度 × 4 つの大きさが、試作と画素まで同じ', { skip: SKIP_PROTO }, () => {
  const P = PROTO!;
  const trees = [P.treeModel(0), P.treeModel(1)];
  for (const sc of [1, 0.65, 0.79, 0.94]) {
    const s = SHEETS.get(`stk-tree-${sc.toFixed(2)}`)!;
    for (const v of TREE_IDS) for (let a = 0; a < ANGLES; a++) assert.equal(hash(crop(s, treeFrameName(v, a))), hash(protoFrame(trees, trees[v], to72(a), sc, 0)), `木${v} ${sc} ${a}`);
  }
});

test('S5 丘の高さ：試作の buildHeight・heightAt と同じ値（対戦の中央の丘と、試作の地図）', { skip: SKIP_PROTO }, () => {
  const P = PROTO!;
  const maps: string[][] = [
    // 中央の丘（4 × 2 マス）
    Array.from({ length: 12 }, (_, r) => (r === 5 || r === 6 ? '...hhhh...' : '..........')),
    // 試作の 10×12 の地図
    ['...f......', '..hh......', '..hh...f..', '..........', '......hh..', 'rrrr..hh..', '.ff...hh..', '.........f', '...---....', '..h....ff.', '..........', 'h.........'],
  ];
  for (const map of maps) {
    const want = P.buildHeight(map, 9);
    const got = buildHeight(10, 12, 32, (c, r) => map[r]![c] === 'h', 9);
    assert.equal(got.data.length, want.length);
    for (let i = 0; i < want.length; i++) assert.equal(got.data[i], want[i], `点 ${i}`);
    for (const [u, v] of [
      [0, 0],
      [-17.3, 4.9],
      [40.25, -31.5],
      [-159.5, 191.5],
      [3.7, 12.1],
    ] as const)
      assert.equal(heightAt(got, u, v), P.heightAt(want, u, v));
  }
});

test('S6 本陣の 2 体の選び方（幟が広く見える護衛）：試作と同じ向きで同じ護衛になる', { skip: SKIP_PROTO }, () => {
  const P = PROTO!;
  const count = (id: ModelId, a72: number): number => {
    const m = protoModel(id, 0);
    const buf = protoFrame([0, 1, 2, 3].map((f) => protoModel(id, f)), m, a72, 1, 0);
    const t0 = colorTable(0);
    let n = 0;
    for (const v of buf) if (v === t0['a'.charCodeAt(0)] || v === t0['b'.charCodeAt(0)]) n++;
    return n;
  };
  const A = SHEETS.get('stk-battle-guardA')!.teamPx!;
  const B = SHEETS.get('stk-battle-guardB')!.teamPx!;
  const diff: number[] = [];
  for (let a = 0; a < ANGLES; a++) if (A[a]! >= B[a]! !== count('guardA', to72(a)) >= count('guardB', to72(a))) diff.push(a);
  assert.deepEqual(diff, []);
});

// ---- 試作がなくても確かめる（試作と一致したときの画素の要約） ----

/** 揃いの 1 枚ごとの画素の要約。試作との一致（S2〜S4）を確かめたときの値 */
const GOLDEN: Record<string, string> = JSON.parse(fs.readFileSync(new URL('./stackArt.golden.json', import.meta.url), 'utf8')) as Record<string, string>;

test('S7 焼いた絵が、試作と一致したときの絵のまま（画素の要約）', () => {
  const got: Record<string, string> = {};
  for (const [k, s] of SHEETS) got[k] = hash(new Uint32Array(s.rgba));
  // 書き直しは、試作と比べられるときだけ（比べずに要約を書き換えないため）
  if (process.env.JG_WRITE_GOLDEN === '1' && HAVE_PROTO) fs.writeFileSync(new URL('./stackArt.golden.json', import.meta.url), JSON.stringify(got, null, 1) + '\n');
  assert.deepEqual(got, GOLDEN);
});

test('S8 型の箱の数が決まった値（削り出しが変わっていない）', () => {
  const counts: Record<string, number[]> = {};
  for (const id of MODEL_IDS) counts[id] = [0, 1, 2, 3].map((f) => voxelCount(makeModel(dimsOf(id), carve(dimsOf(id), modelParts(id, f), id), centerOf(id))));
  counts['tree'] = TREE_IDS.map((v) => voxelCount(makeModel(TREE_DIMS, carve(TREE_DIMS, treeParts(v), 'tree'))));
  assert.deepEqual(counts, JSON.parse(fs.readFileSync(new URL('./stackArt.voxels.json', import.meta.url), 'utf8')));
});

// ---- 色 ----

test('S9 焼いた絵に出る色は、色の一覧（palette.ts）の中だけ', () => {
  const allowed = new Set<number>([0]);
  for (const c of [...Object.values(COLOR), ...Object.values(ART), ...Object.values(TERRAIN), ...Object.values(SIDE_COLOR[0]), ...Object.values(SIDE_COLOR[1])]) allowed.add(abgr(c));
  for (const s of SHEETS.values()) {
    const seen = new Set(new Uint32Array(s.rgba));
    for (const v of seen) assert.ok(allowed.has(v), `${s.key} に一覧にない色 ${v.toString(16)}`);
  }
  // 文字 → 色の対応も一覧の中だけ
  for (const team of [0, 1] as const) for (const v of Object.values(colorsFor(team))) assert.ok(allowed.has(abgr(v)));
});

test('S10 地形の色（TERRAIN）は、art/textures.ts の地形の絵で使っている値と同じ（新しい色を足していない）', () => {
  const src = fs.readFileSync(new URL('../src/art/textures.ts', import.meta.url), 'utf8').toLowerCase();
  for (const [name, v] of Object.entries(TERRAIN)) assert.ok(src.includes(`0x${v.toString(16).padStart(6, '0')}`), `${name} が textures.ts にない`);
});

test('S11 敵軍の絵は、自軍の絵の陣営の 3 色を置き換えただけ', () => {
  const swap = new Map<number, number>();
  const t0 = colorTable(0);
  const t1 = colorTable(1);
  for (const ch of 'abd') swap.set(t0[ch.charCodeAt(0)]!, t1[ch.charCodeAt(0)]!);
  for (const id of MODEL_IDS) {
    const s = SHEETS.get(`stk-battle-${id}`)!;
    for (const f of [0, 3]) for (const a of [0, 7, 20]) {
      const own = crop(s, soldierFrameName(0, f, a));
      const enemy = crop(s, soldierFrameName(1, f, a));
      for (let i = 0; i < own.length; i++) assert.equal(enemy[i], swap.get(own[i]!) ?? own[i]);
    }
  }
});

// ---- 枚数・大きさ・範囲 ----

test('S12 揃いごとの焼く枚数・持つ枚数・絵の大きさが design §14.3 の表と合う', () => {
  const by = (set: SetId): BakedSheet[] => [...SHEETS.values()].filter((s) => s.set === set);
  const sum = (ss: BakedSheet[], f: (s: BakedSheet) => number): number => ss.reduce((a, s) => a + f(s), 0);
  assert.equal(sum(by('deploy'), (s) => s.baked), 16);
  assert.equal(sum(by('deploy'), (s) => s.frames.length), 16);
  assert.equal(sum(by('reveal'), (s) => s.baked), 208);
  assert.equal(sum(by('reveal'), (s) => s.frames.length), 208);
  assert.equal(sum(by('battle'), (s) => s.baked), 1152);
  assert.equal(sum(by('battle'), (s) => s.frames.length), 2304);
  assert.equal(sum(by('tree'), (s) => s.baked), 288);
  assert.equal(sum(by('tree'), (s) => s.frames.length), 288);
  for (const s of by('battle')) {
    assert.ok(s.w >= 2034 && s.w <= 2048, `${s.key} 幅 ${s.w}`);
    assert.ok(s.h >= 129 && s.h <= 200, `${s.key} 高さ ${s.h}`);
  }
  for (const s of SHEETS.values()) {
    assert.ok(s.w <= TEX_MAX && s.h <= TEX_MAX);
    assert.equal(s.rgba.byteLength, s.w * s.h * 4);
    const l = sheetLayout(s.g, s.frames.length);
    assert.deepEqual([l.w, l.h], [s.w, s.h]);
  }
  // 画素 1 枚ぶんの量（MB。design §14.3 の表：戦闘 9.7・公開 1.0・配置 0.1・木 0.7）
  const mb = (set: SetId): number => Math.round(sum(by(set), (s) => s.w * s.h * 4) / 1e5) / 10;
  assert.deepEqual([mb('battle'), mb('reveal'), mb('deploy'), mb('tree')], [9.7, 1.0, 0.1, 0.7]);
});

test('S13 焼いた絵の実際の範囲（大きさ 1・コマ 0・上向きと下向き）が design §14.2 の表と合う', () => {
  const table: Record<ModelId, [number, number, number]> = {
    infantry: [9, 32, 2],
    shield: [7, 22, 3],
    archer: [9, 23, 2],
    cavalry: [9, 36, 5],
    general: [7, 24, 2],
    guardA: [9, 37, 3],
    guardB: [6, 38, 2],
    generalF: [7, 35, 2],
  };
  for (const id of MODEL_IDS) {
    const s = SHEETS.get(`stk-deploy-${id}`)!;
    const e = s.frames.map((f) => f.ext);
    const lr = Math.max(...e.map((x) => Math.max(x.left, x.right)));
    const up = Math.max(...e.map((x) => x.up));
    const down = Math.max(...e.map((x) => x.down));
    assert.deepEqual([lr, up, down], table[id], id);
  }
  // 戦闘の揃いの騎兵の上は、0.84 で焼いた絵から求めた値（31px。design §14.2）
  const cav = SHEETS.get('stk-battle-cavalry')!;
  const f0 = cav.frames.find((f) => f.name === soldierFrameName(0, 0, 0))!;
  assert.equal(f0.ext.up, 31);
});

test('S14 枠の大きさ：試作と同じ式（bakeGeom）', { skip: SKIP_PROTO }, () => {
  for (const [R, H] of [[10, 33], [13.6, 32], [11.3, 26], [9.9, 33]] as const) for (const s of [1, 0.84, 0.65, 0.79, 0.94]) assert.deepEqual(bakeGeom(R, H, s), { ...PROTO!.bakeGeom(R, H, s) });
});

// ---- 仕事の列 ----

test('J1 起動のときの列の順（配置 → 木 1 → 削り出し → 戦闘（型の順）→ 木のほかの大きさ）', () => {
  const order: string[] = [];
  const q = new BakeQueue((s) => order.push(s.key));
  q.push(startupTasks());
  q.runAll();
  assert.deepEqual(order, [
    ...MODEL_IDS.map((m) => `stk-deploy-${m}`),
    'stk-tree-1.00',
    ...MODEL_IDS.map((m) => `stk-battle-${m}`),
    'stk-tree-0.65',
    'stk-tree-0.79',
    'stk-tree-0.94',
  ]);
  assert.equal(q.modelCount, 32 + 2);
  q.dropModels();
  assert.equal(q.modelCount, 0);
});

test('J2 1 つずつ進めても、時間で区切って進めても、まとめて進めても、同じ絵になる', () => {
  const one = new Map<string, string>();
  const q1 = new BakeQueue((s) => one.set(s.key, hash(new Uint32Array(s.rgba))));
  q1.push(allTasks());
  let steps = 0;
  while (q1.step()) steps++;
  assert.ok(steps > 3000, `区切りが細かい（${steps}）`);
  const sliced = new Map<string, string>();
  const q2 = new BakeQueue((s) => sliced.set(s.key, hash(new Uint32Array(s.rgba))));
  q2.push(allTasks());
  while (q2.runFor(2));
  const all = new Map<string, string>();
  for (const [k, s] of SHEETS) all.set(k, hash(new Uint32Array(s.rgba)));
  assert.deepEqual(one, all);
  assert.deepEqual(sliced, all);
});

test('J3 途中で別の入口（主スレッド）に引き継いでも、できた分をやり直さず、残りが全部できる', () => {
  const first: BakedSheet[] = [];
  const a = new BakeQueue((s) => first.push(s));
  a.push(allTasks());
  // 戦闘の揃いの途中まで（いくつかの絵ができ、1 枚は途中）
  while (first.length < 11) a.step();
  for (let i = 0; i < 50; i++) a.step();
  const doneKeys = first.map((s) => s.key);
  const second: BakedSheet[] = [];
  const b = new BakeQueue((s) => second.push(s), { skip: doneKeys });
  b.push(a.remaining());
  b.runAll();
  for (const s of second) assert.ok(!doneKeys.includes(s.key), `やり直した：${s.key}`);
  const keys = [...doneKeys, ...second.map((s) => s.key)].sort();
  assert.deepEqual(keys, [...SHEETS.keys()].sort());
  for (const s of [...first, ...second]) assert.equal(hash(new Uint32Array(s.rgba)), hash(new Uint32Array(SHEETS.get(s.key)!.rgba)), s.key);
});

test('J4 頼んだ揃いは列の先頭に入り、捨てた揃いは作らない', () => {
  const order: string[] = [];
  const q = new BakeQueue((s) => order.push(s.key));
  q.push(startupTasks());
  q.step();
  q.front(setSheets('reveal').map((spec): TaskSpec => ({ t: 'sheet', spec })));
  q.runFor(1e9);
  // 途中だった配置の 1 枚を終えてから、公開の揃い
  assert.deepEqual(order.slice(0, 9), ['stk-deploy-infantry', ...MODEL_IDS.map((m) => `stk-reveal-${m}`)]);
  const q2 = new BakeQueue((s) => order.push(s.key));
  order.length = 0;
  q2.push(setSheets('reveal').map((spec): TaskSpec => ({ t: 'sheet', spec })));
  q2.step();
  q2.cancel('reveal');
  q2.runAll();
  assert.deepEqual(order, []);
});

test('J5 向きの刻みを 72 にしても作れる（番号・枚数・並べ方が ANGLES から決まる）', () => {
  assert.deepEqual(revealAngles(36), [33, 34, 35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(revealAngles(72).length, 25);
  const q = new BakeQueue(() => {}, { n: 72 });
  const got: BakedSheet[] = [];
  const q2 = new BakeQueue((s) => got.push(s), { n: 72 });
  void q;
  q2.push([{ t: 'sheet', spec: setSheets('battle', 72)[0]! }, { t: 'sheet', spec: setSheets('deploy', 72)[0]! }]);
  q2.runAll();
  assert.equal(got[0]!.frames.length, 2 * 4 * 72);
  assert.equal(got[1]!.frames[1]!.name, soldierFrameName(1, 0, 36));
  // 72 刻みの番号 2a は、36 刻みの番号 a と同じ絵
  const b36 = SHEETS.get('stk-battle-infantry')!;
  const b72 = got[0]!;
  for (const a of [0, 5, 17, 30]) assert.equal(hash(crop(b72, soldierFrameName(0, 1, 2 * a))), hash(crop(b36, soldierFrameName(0, 1, a))));
});

// ---- 体の数・並び・型 ----

test('Q1 体の数の境目（0.66・0.34）', () => {
  assert.deepEqual([1, 0.67, 0.66, 0.35, 0.34, 0.01, 0].map(countFor), [3, 3, 2, 2, 1, 1, 0]);
});

test('Q2 並びの位置（試作の値 × 32/36）。上向き（heading −π/2）で、3 体は前のまん中と後ろの左右', () => {
  const up = -Math.PI / 2;
  const r = (p: { u: number; v: number } | null): [number, number] => [Math.round(p!.u * 100) / 100 + 0, Math.round(p!.v * 100) / 100 + 0];
  assert.deepEqual(r(slotOffset(up, 0, 3)), [0, -6.67]);
  assert.deepEqual(r(slotOffset(up, 1, 3)), [-7.56, 5.78]);
  assert.deepEqual(r(slotOffset(up, 2, 3)), [7.56, 5.78]);
  assert.deepEqual(r(slotOffset(up, 0, 2)), [-5.78, 0]);
  assert.deepEqual(r(slotOffset(up, 0, 1)), [0, 0]);
  assert.equal(slotOffset(up, 2, 2), null);
});

test('Q3 本陣の型の選び方', () => {
  assert.deepEqual([0, 1, 2].map((s) => modelFor('hq', 3, s)), ['general', 'guardB', 'guardA']);
  assert.deepEqual([modelFor('hq', 2, 0), modelFor('hq', 2, 1, true), modelFor('hq', 2, 1, false)], ['general', 'guardA', 'guardB']);
  assert.equal(modelFor('hq', 1, 0), 'generalF');
  assert.equal(modelFor('cavalry', 3, 1), 'cavalry');
});

test('H1 丘：丘でないマスは高さ 0、いちばん高い所は 9 以下、隣り合う点の差は小さい', () => {
  const isHill = (c: number, r: number): boolean => c >= 3 && c <= 6 && (r === 5 || r === 6);
  const hm = buildHeight(10, 12, 32, isHill);
  let max = 0;
  let step = 0;
  for (let y = 0; y < hm.h; y++)
    for (let x = 0; x < hm.w; x++) {
      const v = hm.data[y * hm.w + x]!;
      if (!isHill(Math.floor(x / 32), Math.floor(y / 32))) assert.equal(v, 0);
      max = Math.max(max, v);
      if (x > 0) step = Math.max(step, Math.abs(v - hm.data[y * hm.w + x - 1]!));
      if (y > 0) step = Math.max(step, Math.abs(v - hm.data[(y - 1) * hm.w + x]!));
    }
  assert.ok(max <= HILL_MAX && max > 8.8, `いちばん高い所 ${max}`);
  assert.ok(step < 0.5, `隣り合う点の差 ${step}`);
});

// 型の中の箱が、色を引ける文字だけでできていること
test('S15 型の箱の文字は、どれも色の対応がある', () => {
  const cm = colorsFor(0);
  const check = (m: Model): void => {
    for (const v of m.vox) if (v) assert.ok(String.fromCharCode(v) in cm, String.fromCharCode(v));
  };
  for (const id of MODEL_IDS) check(makeModel(dimsOf(id), carve(dimsOf(id), modelParts(id, 0), id)));
  for (const v of TREE_IDS) check(makeModel(TREE_DIMS, carve(TREE_DIMS, treeParts(v), 'tree')));
});

test('J6 できた揃いを捨ててから頼み直すと、同じ列で作り直す（主スレッドの列で、捨てて頼み直したとき）', () => {
  const order: string[] = [];
  const q = new BakeQueue((s) => order.push(s.key));
  const reveal = (): TaskSpec[] => setSheets('reveal').map((spec): TaskSpec => ({ t: 'sheet', spec }));
  q.push(reveal());
  q.runAll();
  assert.equal(order.length, 8);
  q.cancel('reveal');
  q.front(reveal());
  q.runAll();
  assert.equal(order.length, 16);
  assert.deepEqual(order.slice(8), order.slice(0, 8));
});

test('Q4 配置の画面（縮み 1）で、左右の隣のマスの部隊の絵の横の重なりが 2px 以下（全部の型の組み合わせ。design §14.8）', () => {
  // 自軍は上向き（番号 0）、敵軍は下向き（番号 N/2）。部隊のまん中は 32px 離れる。3 体の並びのいちばん外の兵の、焼いた絵の範囲で比べる
  const ext = (id: ModelId, team: 0 | 1): { left: number; right: number } => {
    const s = SHEETS.get(`stk-deploy-${id}`)!;
    return s.frames.find((f) => f.name === soldierFrameName(team, 0, team === 0 ? 0 : ANGLES / 2))!.ext;
  };
  const heading = { 0: -Math.PI / 2, 1: Math.PI / 2 } as const;
  const kinds = ['infantry', 'shield', 'archer', 'cavalry', 'hq'] as const;
  let worst = -Infinity;
  for (const team of [0, 1] as const)
    for (const a of kinds)
      for (const b of kinds) {
        // 左の部隊の右の端と、右の部隊の左の端（盤の px。表示の倍率 1）
        let right = -Infinity;
        for (let slot = 0; slot < 3; slot++) {
          const o = slotOffset(heading[team], slot, 3)!;
          right = Math.max(right, o.u + ext(modelFor(a, 3, slot), team).right);
        }
        let left = Infinity;
        for (let slot = 0; slot < 3; slot++) {
          const o = slotOffset(heading[team], slot, 3)!;
          left = Math.min(left, 32 + o.u - ext(modelFor(b, 3, slot), team).left);
        }
        worst = Math.max(worst, right - left);
      }
  if (process.env.JG_VERBOSE) console.log(`横の重なりの最大 ${worst.toFixed(2)}px`);
  assert.ok(worst <= 2, `横の重なり ${worst.toFixed(2)}px`);
});
