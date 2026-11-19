// Node >=22, no packages. Run from any directory: node .../backdrops/make.mjs
// Integer pixel drawing only; RGB PNG has no alpha channel. No game files are edited.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const OUT = fileURLToPath(new URL('../../public/backdrops/', import.meta.url));
const SHEET = '/private/tmp/claude-501/-Users-keranatsuki-dev/9e43ce8f-2131-4df5-a974-08fd67e898f4/scratchpad/backdrops-sheet.png';
const W = 288, H = 96;
// Ground/trees/stone/wood/water are copied from palette.ts and textures.ts.
// Atmospheric additions are deliberately shared by every scene, never color-interpolated.
const C = {
  day0: 0x718d99, day1: 0x91a8ac, day2: 0xbdc6b7,
  grey0: 0x626f78, grey1: 0x899695, grey2: 0xb7bba9,
  dusk0: 0x626a78, dusk1: 0x918582, dusk2: 0xb7a18a,
  cloud: 0xd6d5bf, shade: 0x808a87, far: 0x7e8d7a, ridge: 0x65765c,
  grassHi: 0x648638, grass: 0x55762f, ground: 0x4c6b2a,
  leaf: 0x3a5a22, leafLo: 0x2a4418,
  rock: 0x3a3428, rockHi: 0x4e4636, rockLo: 0x2a251c,
  stone: 0x4a4640, stoneHi: 0x77736a,
  wood: 0x8a5a2a, woodLo: 0x3a2a14, water: 0x4a92ac,
};
const SCENES = [
  ['1-1', '初陣', 'day', 'first', '広い昼空と左奥の小さな木立で、初戦の平原を明快に。'],
  ['1-2', '盾の壁', 'day', 'shelf', '水平に続く低い稜線と横長の雲で、正面から迫る敵を受ける平原に。'],
  ['1-3', '矢の雨', 'day', 'wind', '斜めにずれた細長い雲と右奥の木立で、弓を構える広い空を強調。'],
  ['1-4', '両翼の騎馬', 'day', 'wings', '左右に離れた低い丘と中央の抜けで、迂回できる平原の広さを表現。'],
  ['1-5', '平原の決戦', 'day', 'wide', '連なる遠山と大きな雲の群れで、章末の決戦に奥行きを。'],
  ['2-1', '丘の上', 'grey', 'hill', '手前の戦場を遮らない重なる丘の稜線で、起伏のある狭い戦域に。'],
  ['2-2', '森の待ち伏せ', 'grey', 'forest', '左右の木立と奥の淡い霧の帯で、両奥に伏兵が潜む雰囲気に。'],
  ['2-3', '川を渡る戦い', 'grey', 'river', '低い対岸の木立と細い横向きの水面で、敵が渡る川の広がりを示す。'],
  ['2-4', '谷の狭い道', 'grey', 'valley', '両端からせり上がる段状の岩山で、中央だけが開く狭い谷に。'],
  ['2-5', '寡兵の戦', 'grey', 'combined', '丘・両脇の森・細い対岸の水面をまとめ、複合地形の守りに。'],
  ['3-1', '柵の守り', 'grey', 'defense', '重い低雲と遠い雑木林で、手前の柵を守り続ける緊張感に。'],
  ['3-2', '砦攻め', 'grey', 'fort', '中央奥に石積みの砦と閉じた門を置き、攻める方向を明確に。'],
  ['3-3', '挟み撃ち', 'dusk', 'pincer', '左右から張り出す稜線と分かれた雲で、両脇から迫る圧力を表現。'],
  ['3-4', '時を稼ぐ', 'dusk', 'hold', '狭い戦域を挟む岩山と雲に隠れかけた低い日で、耐える時間を表現。'],
  ['3-5', '天下分け目', 'dusk', 'final', '夕空・幾重もの山・左の森・右奥の霧で、最終戦の広さと伏兵を表現。'],
  ['pvp-plain', '平原', 'day', 'pvpPlain', '左右均衡の低い遠山と小雲で、対戦の見通しのよい平原に。'],
  ['pvp-hill', '中央の丘', 'day', 'pvpHill', '中央に一つ大きく盛り上がる草の稜線で、中央の丘を象徴。'],
  ['pvp-river', '中央の川', 'day', 'pvpRiver', '左右に低い河岸、中央に細長い水面を配し、横切る川を象徴。'],
  ['pvp-forest', '両脇の森', 'day', 'pvpForest', '左右に同じ密度の木立を置き、中央の進路を開けた森の戦場に。'],
].map(([id, name, sky, kind, intent], i) => ({ id, name, sky, kind, intent, seed: 501 + i * 97 }));

class Pixels {
  constructor(w, h, color) { this.w = w; this.h = h; this.data = new Uint32Array(w * h).fill(color); }
  dot(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c; }
  rect(x, y, w, h, c) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) this.dot(xx, yy, c);
  }
  // Same 1 character = 1 pixel approach as textures.ts; '.' leaves the opaque sky below.
  rows(x, y, rows, colors) {
    rows.forEach((row, yy) => [...row].forEach((v, xx) => { if (colors[v] !== undefined) this.dot(x + xx, y + yy, colors[v]); }));
  }
  ridge(points, color, bottom = H) {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      for (let x = ax; x < bx; x++) {
        const y = Math.round(ay + (by - ay) * (x - ax) / (bx - ax));
        this.rect(x, y, 1, bottom - y, color);
      }
    }
  }
}
function rng(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const TREE = ['....aa.....', '..aaaaaa...', '.aaaaaaaa..', 'aaaabaaaaa.', 'aabbbbaaaa.', '.bbbbbbbba.', '..bbbbbb...', '.....b.....'];
function trees(p, from, to, base, random, dense = false, distant = false) {
  for (let x = from; x < to; x += (dense ? 6 : 11) + Math.floor(random() * 6)) {
    const y = base - 8 - Math.floor(random() * 5);
    p.rows(x, y, TREE, distant ? { a: C.ridge, b: C.ridge } : { a: C.leaf, b: C.leafLo });
  }
}
function cloud(p, x, y, width, heavy = false) {
  // Long flat bases, irregular stepped shoulders; no ellipses, filtering or alpha.
  p.rect(x + 8, y, width - 26, 2, heavy ? C.shade : C.cloud);
  p.rect(x + 4, y + 2, width - 12, 3, heavy ? C.shade : C.cloud);
  p.rect(x, y + 5, width, 3, heavy ? C.shade : C.cloud);
  p.rect(x + 6, y + 8, width - 15, 2, C.shade);
  if (heavy) p.rect(x + 13, y + 3, width - 36, 1, C.cloud);
}
function hills(p, points) {
  p.ridge(points, C.grassHi);
  p.ridge(points.map(([x, y], i) => [x, y + 5 + i % 3]), C.grass);
}
function rocks(p, narrow = false) {
  const edge = narrow ? 54 : 64;
  p.ridge([[0, 32], [13, 32], [27, 43], [38, 44], [58, 66], [81, 76], [105, 96]], C.rockHi);
  p.ridge([[183, 96], [207, 79], [228, 65], [244, 45], [258, 45], [276, 29], [288, 29]], C.rockHi);
  p.ridge([[0, 45], [12, 45], [25, 57], [32, 57], [edge, 96]], C.rock);
  p.ridge([[288 - edge, 96], [255, 61], [265, 59], [277, 42], [288, 42]], C.rock);
  for (const [x, y, w] of [[4, 53, 15], [18, 69, 13], [29, 84, 12], [270, 50, 16], [259, 75, 13], [246, 87, 10]]) {
    p.rect(x, y, w, 1, C.rockLo); p.rect(x + 2, y - 2, w - 4, 1, C.rockHi);
  }
}
function fort(p) {
  p.rect(97, 73, 94, 15, C.stone);
  p.rect(96, 72, 96, 2, C.stoneHi);
  for (const x of [99, 176]) {
    p.rect(x, 61, 13, 25, C.stone);
    p.rect(x - 2, 60, 17, 3, C.stoneHi);
    for (const xx of [x - 1, x + 5, x + 11]) p.rect(xx, 57, 3, 3, C.stone);
    p.rect(x + 5, 65, 2, 4, C.rock);
  }
  p.rect(137, 76, 12, 12, C.woodLo); p.rect(139, 77, 8, 11, C.wood);
  p.rect(143, 77, 1, 11, C.woodLo); p.rect(139, 81, 8, 1, C.woodLo);
  for (let row = 0; row < 3; row++) for (let x = 115 + row % 2 * 4; x < 174; x += 11) {
    if (x < 134 || x > 150) p.rect(x, 77 + row * 4, 7, 1, C.stoneHi);
  }
}
function draw(s) {
  const p = new Pixels(W, H, C[`${s.sky}0`]), random = rng(s.seed);
  p.rect(0, 34, W, 29, C[`${s.sky}1`]); p.rect(0, 63, W, 33, C[`${s.sky}2`]);
  const k = s.kind;
  const clouds = {
    first: [[24, 22, 58], [183, 40, 67]], shelf: [[12, 35, 112], [174, 24, 79]],
    wind: [[-12, 21, 90], [88, 34, 91], [198, 47, 75]], wings: [[38, 31, 64], [191, 29, 60]],
    wide: [[-10, 26, 112], [131, 15, 125]], hill: [[21, 23, 83], [165, 38, 102]],
    forest: [[-12, 21, 138], [152, 31, 148]], river: [[41, 27, 126], [201, 45, 68]],
    valley: [[87, 30, 104]], combined: [[-12, 20, 151], [153, 31, 150]],
    defense: [[-20, 18, 161], [136, 30, 174], [34, 48, 122]], fort: [[-14, 22, 143], [156, 16, 148]],
    pincer: [[-19, 28, 114], [188, 33, 121]], hold: [[53, 22, 183], [131, 58, 89]],
    final: [[-19, 18, 121], [133, 28, 173]], pvpPlain: [[25, 23, 65], [198, 23, 65]],
    pvpHill: [[17, 32, 79], [192, 32, 79]], pvpRiver: [[37, 22, 83], [168, 22, 83]],
    pvpForest: [[77, 24, 134]],
  };
  if (['hold', 'final'].includes(k)) p.rows(k === 'hold' ? 190 : 114, k === 'hold' ? 55 : 48,
    ['...cccc...', '.cccccccc.', 'cccccccccc', 'cccccccccc', 'cccccccccc', '.cccccccc.', '...cccc...'], { c: C.cloud });
  for (const [x, y, w] of clouds[k]) cloud(p, x, y, w, s.sky !== 'day');
  // Background ridge is always subordinate to a large readable sky.
  const farPoints = [[0, 80], [31, 76], [58, 78], [91, 66], [116, 70], [145, 61], [174, 74], [211, 68], [247, 76], [288, 72]];
  const shift = Math.floor(random() * 9);
  p.ridge(farPoints.map(([x, y]) => [x, y + shift]), C.far);
  p.ridge([[0, 87], [40, 80], [76, 85], [111, 78], [152, 84], [197, 77], [240, 83], [288, 80]], C.ridge);
  if (k === 'first') { p.rect(0, 84, W, 12, C.grass); trees(p, 16, 61, 87, random, false, true); }
  if (k === 'shelf') hills(p, [[0, 83], [47, 82], [78, 80], [138, 80], [173, 83], [242, 83], [288, 85]]);
  if (k === 'wind') { p.rect(0, 87, W, 9, C.grass); trees(p, 214, 270, 87, random, false, true); }
  if (['wings', 'pincer'].includes(k)) hills(p, [[0, k === 'pincer' ? 74 : 79], [34, 77], [89, 89], [146, 91], [208, 87], [258, 77], [288, 76]]);
  if (k === 'wide') { hills(p, [[0, 87], [68, 83], [121, 89], [201, 82], [288, 88]]); trees(p, 235, 279, 87, random, false, true); }
  if (k === 'hill') hills(p, [[0, 78], [40, 69], [70, 68], [118, 79], [166, 82], [224, 73], [250, 73], [288, 81]]);
  if (['forest', 'pvpForest'].includes(k)) {
    p.rect(0, 88, W, 8, C.grass);
    trees(p, -5, 95, 84, random, true, true); trees(p, 193, 290, 84, random, true, true);
    trees(p, -5, 81, 91, random, true); trees(p, 210, 290, 91, random, true);
    if (k === 'forest') { p.rect(10, 84, 61, 2, C[s.sky + '2']); p.rect(225, 82, 63, 2, C[s.sky + '2']); }
  }
  if (['river', 'pvpRiver', 'combined'].includes(k)) {
    p.rect(0, 84, W, 12, C.grass);
    trees(p, 0, k === 'pvpRiver' ? 64 : 116, 83, random, true, true);
    trees(p, k === 'pvpRiver' ? 224 : 191, 287, 83, random, true, true);
    p.rect(k === 'pvpRiver' ? 62 : 15, 87, k === 'pvpRiver' ? 164 : 259, 3, C.water);
    for (const [x, w] of [[81, 17], [131, 28], [191, 12]]) p.rect(x, 87, w, 1, C[s.sky + '2']);
    p.rect(0, 90, W, 6, C.grass);
    if (k === 'combined') { hills(p, [[0, 93], [65, 91], [110, 89], [169, 89], [224, 92], [288, 93]]); trees(p, -2, 49, 93, random, true); trees(p, 244, 290, 93, random, true); }
  }
  if (k === 'valley' || k === 'hold') rocks(p, k === 'hold');
  if (k === 'defense') { p.rect(0, 90, W, 6, C.grass); trees(p, 11, 121, 90, random, true, true); trees(p, 184, 275, 89, random, false, true); }
  if (k === 'fort') { fort(p); p.rect(0, 88, W, 8, C.grass); }
  if (k === 'final') {
    hills(p, [[0, 88], [69, 84], [125, 89], [193, 83], [239, 86], [288, 85]]);
    trees(p, -3, 78, 92, random, true);
    p.rect(198, 80, 90, 3, C.dusk2); p.rect(223, 86, 65, 2, C.dusk2);
  }
  if (k === 'pvpPlain') hills(p, [[0, 86], [48, 83], [96, 86], [144, 89], [192, 86], [240, 83], [288, 86]]);
  if (k === 'pvpHill') hills(p, [[0, 91], [48, 88], [95, 75], [124, 70], [151, 70], [183, 77], [240, 88], [288, 91]]);
  // Last rows settle to the exact ground fill, never a bright stripe or a water edge.
  p.rect(0, 93, W, 3, C.ground);
  if (k === 'valley' || k === 'hold') {
    const edge = k === 'hold' ? 54 : 64;
    p.rect(0, 93, edge, 3, C.rock); p.rect(W - edge, 93, edge, 3, C.rock);
  }
  return p;
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data) {
  const name = Buffer.from(type), out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8); return out;
}
function encode(p) {
  const header = Buffer.alloc(13); header.writeUInt32BE(p.w); header.writeUInt32BE(p.h, 4); header[8] = 8; header[9] = 2;
  const stride = p.w * 3 + 1, bytes = Buffer.alloc(stride * p.h);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const c = p.data[y * p.w + x], i = y * stride + 1 + x * 3;
    bytes[i] = c >>> 16; bytes[i + 1] = c >>> 8; bytes[i + 2] = c;
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(bytes, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// Strict independent readback of this writer's RGB/filter-0 PNG subset, including CRCs.
function decode(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), SIGNATURE);
  let pos = 8, width, height, ended = false; const blocks = [];
  while (pos < bytes.length) {
    const length = bytes.readUInt32BE(pos), type = bytes.toString('ascii', pos + 4, pos + 8);
    assert.ok(pos + length + 12 <= bytes.length, 'truncated PNG');
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    assert.equal(crc32(bytes.subarray(pos + 4, pos + 8 + length)), bytes.readUInt32BE(pos + 8 + length), `${type} CRC`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [8, 2, 0, 0, 0], '8-bit opaque RGB, no interlace');
    } else if (type === 'IDAT') blocks.push(data);
    else { assert.equal(type, 'IEND', 'unexpected chunk (including transparency)'); assert.equal(length, 0); ended = true; }
    pos += length + 12;
    if (ended) break;
  }
  assert.ok(ended); assert.equal(pos, bytes.length);
  const raw = inflateSync(Buffer.concat(blocks)), stride = width * 3 + 1;
  assert.equal(raw.length, stride * height);
  const p = new Pixels(width, height, 0);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * stride], 0, 'PNG scanline filter');
    for (let x = 0; x < width; x++) { const i = y * stride + x * 3 + 1; p.dot(x, y, (raw[i] << 16) | (raw[i + 1] << 8) | raw[i + 2]); }
  }
  return p;
}
const FONT = {
  '0': ['111','101','101','101','111'], '1': ['010','110','010','010','111'], '2': ['111','001','111','100','111'],
  '3': ['111','001','111','001','111'], '4': ['101','101','111','001','001'], '5': ['111','100','111','001','111'],
  '-': ['000','000','111','000','000'], p: ['110','101','110','100','100'], v: ['101','101','101','101','010'],
  l: ['100','100','100','100','111'], a: ['010','101','111','101','101'], i: ['010','000','010','010','010'],
  n: ['000','110','101','101','101'], h: ['100','100','110','101','101'], r: ['000','110','101','100','100'],
  e: ['000','111','110','100','111'], f: ['011','010','111','010','010'], o: ['000','111','101','101','111'],
  s: ['000','011','010','001','110'], t: ['010','111','010','010','011'],
};
function sheet(images) {
  const scale = 4, cellW = W * scale + 32, cellH = H * scale + 52;
  const p = new Pixels(cellW * 4, cellH * 5, 0x1d1810);
  images.forEach(({ s, p: src }, i) => {
    const ox = i % 4 * cellW + 16, oy = Math.floor(i / 4) * cellH + 36;
    [...s.id].forEach((ch, j) => {
      assert.ok(FONT[ch], `missing label glyph: ${ch}`);
      FONT[ch].forEach((row, y) => [...row].forEach((bit, x) => { if (bit === '1') p.rect(ox + j * 12 + x * 3, oy - 25 + y * 3, 3, 3, C.cloud); }));
    });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p.rect(ox + x * scale, oy + y * scale, scale, scale, src.data[y * W + x]);
  });
  return p;
}
await mkdir(OUT, { recursive: true });
const images = [], hashes = new Set();
console.log('| ファイル | 寸法 | 色数 | 半透明/透明画素 | 下端 | 最上部 |');
console.log('|---|---|---:|---:|---|---|');
for (const s of SCENES) {
  const original = draw(s), path = `${OUT}${s.id}.png`;
  await writeFile(path, encode(original));
  const bytes = await readFile(path), p = decode(bytes), colors = new Set(p.data);
  assert.equal(p.w, W); assert.equal(p.h, H); assert.ok(colors.size <= 16, `${s.id}: ${colors.size} colors`);
  assert.deepEqual(p.data, original.data, `${s.id}: pixel roundtrip`);
  assert.deepEqual(encode(draw(s)), bytes, `${s.id}: deterministic regeneration`);
  const hash = createHash('sha256').update(bytes).digest('hex'); assert.ok(!hashes.has(hash), 'duplicate image'); hashes.add(hash);
  for (let x = 0; x < W; x++) {
    assert.equal(p.data[x], C[s.sky + '0']);
    const edge = s.kind === 'hold' ? 54 : 64;
    const rock = ['valley', 'hold'].includes(s.kind) && (x < edge || x >= W - edge);
    assert.equal(p.data[(H - 1) * W + x], rock ? C.rock : C.ground, `${s.id}: ground seam ${x}`);
  }
  images.push({ s, p });
  console.log(`| ${s.id}.png | ${p.w}×${p.h} | ${colors.size} | 0 | ${['valley', 'hold'].includes(s.kind) ? '草＋左右岩' : '草'} | #${C[s.sky + '0'].toString(16)} |`);
}
assert.equal(images.length, 19);
await mkdir(fileURLToPath(new URL('.', `file://${SHEET}`)), { recursive: true });
const overview = sheet(images); await writeFile(SHEET, encode(overview));
const reread = decode(await readFile(SHEET)); assert.deepEqual(reread.data, overview.data);
// Verify each enlarged art pixel, excluding the sheet-only labels and gutters.
images.forEach(({ p: src }, i) => {
  const ox = i % 4 * 1184 + 16, oy = Math.floor(i / 4) * 436 + 36;
  for (let y = 0; y < H * 4; y++) for (let x = 0; x < W * 4; x++)
    assert.equal(reread.data[(oy + y) * reread.w + ox + x], src.data[Math.floor(y / 4) * W + Math.floor(x / 4)]);
});
console.log(`\nSheet: ${SHEET} (${overview.w}×${overview.h}, nearest 4×; readback verified)`);
console.log('\nPalette: ' + Object.entries(C).map(([k, v]) => `${k}=#${v.toString(16).padStart(6, '0')}`).join(' '));
for (const s of SCENES) console.log(`${s.id} ${s.name}: ${s.intent}`);
