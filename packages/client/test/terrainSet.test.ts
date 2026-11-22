// 地形の揃い（'terrain'。design §16.4）を、画面なしで確かめる：枚数・コマ・量、試作との一致（焼いた絵の中のコマで）、
// 捨てて頼み直したときの作り直しと、古い応答を受け付けないこと。
// 試作がないときは、試作と一致したときに記録した画素の要約（terrain.golden.json）と比べる。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { bakeOne, type Geom } from '../src/art/stack/bake.ts';
import { BakeQueue, setSheets, terrainFrameName, terrainSheetKey, type BakedSheet, type TaskSpec } from '../src/art/stack/jobs.ts';
import { familyOf, PROP_IDS, TS, type PropId } from '../src/art/stack/props.ts';
import { SheetBook } from '../src/art/stack/sheetBook.ts';

const PROTO_DIR = process.env.JG_PROTO_DIR ?? new URL('../../../../../proto17v2/', import.meta.url).pathname;
const HAVE_PROTO = fs.existsSync(path.join(PROTO_DIR, 'art.js'));
const SKIP_PROTO = HAVE_PROTO ? false : `試作がない（${PROTO_DIR}）。GOLDEN との比べで代える`;

const tasks = (groups: ('A' | 'B')[] = ['A']): TaskSpec[] => setSheets('terrain', 36, groups).map((spec): TaskSpec => ({ t: 'sheet', spec }));

function bake(groups: ('A' | 'B')[] = ['A']): Map<string, BakedSheet> {
  const out = new Map<string, BakedSheet>();
  const q = new BakeQueue((s) => out.set(s.key, s));
  q.push(tasks(groups));
  q.runAll();
  return out;
}
const SHEETS = bake();

function crop(s: BakedSheet, name: string): Uint32Array {
  const f = s.frames.find((x) => x.name === name);
  assert.ok(f, `コマがない：${s.key} ${name}`);
  const buf = new Uint32Array(s.rgba);
  const out = new Uint32Array(s.g.fw * s.g.fh);
  for (let y = 0; y < s.g.fh; y++) for (let x = 0; x < s.g.fw; x++) out[y * s.g.fw + x] = buf[(f.y + y) * s.w + f.x + x]!;
  return out;
}

function hash(a: Uint32Array): string {
  let h = 0x811c9dc5;
  for (const v of a) {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

test('T1 組 A：絵 44 枚・コマ 187。量（画素 1 枚ぶん）が design §16.4 の表と合う（城壁 0.70・城門 0.55・柵 0.73・合計 1.98MB）', () => {
  assert.equal(SHEETS.size, 44);
  const all = [...SHEETS.values()];
  assert.equal(all.reduce((a, s) => a + s.frames.length, 0), 187);
  const mb = (f: string | null): number => Math.round(all.filter((s) => f === null || familyOf(s.key.split('-')[2] as PropId) === f).reduce((a, s) => a + s.w * s.h * 4, 0) / 1e4) / 100;
  assert.deepEqual([mb('wall'), mb('gate'), mb('fence'), mb(null)], [0.7, 0.55, 0.73, 1.98]);
  // 大きさ 1 の枠：城壁 46×61、城門 46×64、柵 54×55（城壁の 4 つの型は同じ枠）
  const g1 = (id: PropId): [number, number] => {
    const s = SHEETS.get(terrainSheetKey(id, 1, 'A'))!;
    return [s.g.fw, s.g.fh];
  };
  for (const id of ['wallEW', 'wallE', 'wallW', 'wall'] as const) assert.deepEqual(g1(id), [46, 61]);
  for (const id of ['gate0', 'gate1', 'gate2'] as const) assert.deepEqual(g1(id), [46, 64]);
  for (const id of ['fenceEW', 'fenceE', 'fenceW', 'fence'] as const) assert.deepEqual(g1(id), [54, 55]);
  // 1 つの型につき 4 枚（大きさ 1 が 13 コマ、0.94 が 1、0.65 が 2、0.79 が 1）
  for (const id of PROP_IDS) {
    assert.deepEqual(
      [1, 0.94, 0.65, 0.79].map((s) => SHEETS.get(terrainSheetKey(id, s, 'A'))!.frames.map((f) => f.name).join(',')),
      ['33,34,35,0,1,2,3,4,5,6,7,8,9', '0', '3,33', '9'],
    );
  }
});

test('T2 組 B を足すと倍（88 枚・374 コマ）。組 B の鍵は組 A と別で、向きは 18 を足したもの', () => {
  const both = bake(['A', 'B']);
  assert.equal(both.size, 88);
  assert.equal([...both.values()].reduce((a, s) => a + s.frames.length, 0), 374);
  assert.deepEqual(
    both.get(terrainSheetKey('wallEW', 1, 'B'))!.frames.map((f) => f.name),
    [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map(String),
  );
  assert.deepEqual(both.get(terrainSheetKey('fence', 0.65, 'B'))!.frames.map((f) => f.name), ['21', '15']);
  assert.notEqual(terrainSheetKey('wallEW', 0.65, 'A'), terrainSheetKey('wallEW', 0.65, 'B'));
});

// ---- 試作との一致（焼いた絵の中のコマで） ----

interface Proto {
  procModel: (H: number, fill: unknown, conn: unknown, label: string) => { m: unknown; mask: unknown };
  wallFill: (conn: unknown) => unknown;
  gateFill: () => unknown;
  fenceFill: () => unknown;
  setTileSize: (n: number) => void;
  bakeOne: (buf: Uint32Array, bw: number, ox: number, oy: number, g: Geom, m: unknown, angle: number, s: number, cmap: unknown, vi: Int32Array, mask: unknown, maskOff: Int32Array) => void;
  cmapFor: (team: number) => unknown;
  ANGLES: number;
}

test('T3 焼いた絵の中の柵 4・城壁 4・gate0 の全部のコマが、試作で同じ枠に焼いた絵と画素まで同じ', { skip: SKIP_PROTO }, () => {
  const ctx = vm.createContext({ Math, Array, Object, JSON, Error, Map, Set, Uint8Array, Uint32Array, Int32Array, Float32Array });
  const P = vm.runInContext(`${fs.readFileSync(path.join(PROTO_DIR, 'art.js'), 'utf8')}\n;({ procModel, wallFill, gateFill, fenceFill, setTileSize, bakeOne, cmapFor, ANGLES })`, ctx) as Proto;
  P.setTileSize(TS);
  let n = 0;
  for (const id of PROP_IDS) {
    if (id === 'gate1' || id === 'gate2') continue;
    const s = id.replace(/^(wall|fence)/, '');
    const conn = { N: false, S: false, E: s.includes('E'), W: s.includes('W') };
    const f = familyOf(id);
    const pm = f === 'gate' ? P.procModel(27, P.gateFill(), { E: true, W: true }, id) : f === 'wall' ? P.procModel(24, P.wallFill(conn), conn, id) : P.procModel(12, P.fenceFill(), conn, id);
    for (const scale of [1, 0.94, 0.65, 0.79]) {
      const sheet = SHEETS.get(terrainSheetKey(id, scale, 'A'))!;
      const g = sheet.g;
      for (const fr of sheet.frames) {
        const buf = new Uint32Array(g.fw * g.fh);
        P.bakeOne(buf, g.fw, 0, 0, g, pm.m, ((Number(fr.name) * 2) / P.ANGLES) * Math.PI * 2, scale, P.cmapFor(0), new Int32Array(g.fw * g.fh), pm.mask, new Int32Array(g.fw * g.fh));
        assert.equal(hash(crop(sheet, fr.name)), hash(buf), `${id} ${scale} ${fr.name}`);
        n++;
      }
    }
  }
  assert.equal(n, 9 * 17);
});

const GOLDEN_URL = new URL('./terrain.golden.json', import.meta.url);

test('T4 焼いた地形の絵が、試作と一致したときの絵のまま（画素の要約。gate1・gate2 も含む）', () => {
  const got: Record<string, string> = {};
  for (const [k, s] of SHEETS) got[k] = hash(new Uint32Array(s.rgba));
  if (process.env.JG_WRITE_GOLDEN === '1' && HAVE_PROTO) fs.writeFileSync(GOLDEN_URL, JSON.stringify(got, null, 1) + '\n');
  assert.deepEqual(got, JSON.parse(fs.readFileSync(GOLDEN_URL, 'utf8')));
});

// ---- 捨てる・頼み直す ----

test('T5 同じ列で、地形を捨ててから頼み直すと作り直す（組 A・B のどちらも）', () => {
  for (const groups of [['A'], ['B'], ['A', 'B']] as ('A' | 'B')[][]) {
    const order: string[] = [];
    const q = new BakeQueue((s) => order.push(s.key));
    q.push(tasks(groups));
    q.runAll();
    const n = order.length;
    assert.equal(n, 44 * groups.length);
    q.cancel('terrain');
    q.front(tasks(groups));
    q.runAll();
    assert.equal(order.length, 2 * n, `${groups.join('')} を作り直していない`);
    assert.deepEqual(order.slice(n), order.slice(0, n));
  }
});

test('T6 頼む → 捨てる → 頼むで、捨てる前の古い応答を受け付けない。組 A のあとに組 B を頼むと別の鍵の絵ができる', () => {
  const book = new SheetBook();
  const wanted = new Set<string>();
  const ready = new Set<string>();
  const request = (groups: ('A' | 'B')[]): TaskSpec[] => {
    const specs = book.stamp(setSheets('terrain', 36, groups).filter((s) => !ready.has(s.key)));
    for (const s of specs) wanted.add(s.key);
    return specs.map((spec): TaskSpec => ({ t: 'sheet', spec }));
  };
  const run = (t: TaskSpec[]): BakedSheet[] => {
    const out: BakedSheet[] = [];
    const q = new BakeQueue((s) => out.push(s));
    q.push(t);
    q.runAll();
    return out;
  };
  const old = run(request(['A']));
  book.release('terrain');
  wanted.clear();
  const fresh = run(request(['A']));
  for (const s of old) assert.equal(book.accepts(s, (k) => wanted.has(k), (k) => ready.has(k), () => false), false, `古い応答を受け付けた：${s.key}`);
  for (const s of fresh) {
    assert.equal(book.accepts(s, (k) => wanted.has(k), (k) => ready.has(k), () => false), true);
    ready.add(s.key);
  }
  // 組 B を足して頼む：組 A はもうあるので、組 B の 44 枚だけ
  const more = run(request(['A', 'B']));
  assert.equal(more.length, 44);
  assert.ok(more.every((s) => s.key.endsWith('-B') && !ready.has(s.key)));
  assert.equal(terrainFrameName(3), '3');
});
