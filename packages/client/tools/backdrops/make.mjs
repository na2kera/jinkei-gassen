// Node with native TypeScript stripping (>=22.18), no npm packages. Run from any directory: node .../backdrops/make.mjs
// Integer pixel drawing only; RGB PNG has no alpha channel. No game files are edited.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { STAGES } from '../../../engine/src/stages.ts';

const OUT = fileURLToPath(new URL('../../public/backdrops/', import.meta.url));
const SHEET = '/private/tmp/claude-501/-Users-keranatsuki-dev/9e43ce8f-2131-4df5-a974-08fd67e898f4/scratchpad/backdrops-sheet2.png';
const W = 288, H = 192, TILE = 24;
const stageWidths = new Map(STAGES.map(s => [s.id, s.field.width]));
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
].map(([id, name, sky, kind, intent], i) => ({ id, name, sky, kind, intent, width: id.startsWith('pvp-') ? 12 : stageWidths.get(id), seed: 501 + i * 97 }));

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
// Cliff feet meet the exact battlefield edges at y=191; no rock enters the seam.
function rocks(p, edge, kind) {
  const top = kind === 'hill' ? 142 : kind === 'hold' ? 121 : 112;
  for (const mirror of [false, true]) {
    const points = [[0, top], [12, top], [23, top + 13], [Math.max(27, edge - 15), 153], [edge - 4, 175], [edge, 191]];
    const flip = pts => mirror ? pts.map(([x, y]) => [W - x, y]).reverse() : pts;
    p.ridge(flip(points), C.rockHi);
    p.ridge(flip([[0, top + 17], [12, top + 17], [23, 161], [edge - 9, 179], [edge, 191]]), C.rock);
    for (const [x, y, w] of [[3, top + 24, 13], [13, 166, 16], [edge - 20, 181, 12]]) {
      p.rect(mirror ? W - x - w : x, y, w, 2, C.rockLo);
      p.rect(mirror ? W - x - w + 2 : x + 2, y - 3, w - 4, 1, C.rockHi);
    }
  }
}
// A near tree has a roughly one-tile crown; distant trees retain their 11px crowns.
function nearTree(p, x, base, scale = 2) {
  TREE.forEach((row, y) => [...row].forEach((v, xx) => {
    if (v !== '.') p.rect(x + xx * scale, base - TREE.length * scale + y * scale, scale, scale, v === 'a' ? C.leaf : C.leafLo);
  }));
}
function approach(p, s, random) {
  const k = s.kind;
  // Overlapping slopes replace the former empty 96px gap. Their scale grows toward the seam.
  const phase = Math.floor(random() * 10);
  const river = ['river', 'pvpRiver', 'combined'].includes(k);
  const slopes = [[0, 163], [39, 157 + phase], [83, 164], [135, 158], [190, 168], [242, 156 + phase], [W, 164]]
    .map(([x, y]) => [x, y + (river ? 7 : 0)]);
  p.ridge(slopes, C.grassHi);
  p.ridge(slopes.map(([x, y]) => [x, y + 4]), C.grass);
  p.ridge([[0, 184], [35, 177], [80, 181], [127, 187], [173, 183], [227, 179], [W, 185]], C.ground);
  if (['hill', 'pvpHill'].includes(k)) {
    p.ridge([[0, 181], [48, 176], [98, 156], [134, 150], [164, 155], [212, 173], [W, 182]], C.grassHi);
    p.ridge([[0, 186], [49, 182], [99, 165], [135, 160], [169, 165], [216, 181], [W, 188]], C.grass);
    p.ridge([[0, 190], [83, 188], [130, 179], [166, 179], [226, 189], [W, 190]], C.ground);
  }
  const groves = {
    first: [20], shelf: [246], wind: [231, 253], wings: [11, 255], wide: [236, 257],
    forest: [0, 18, 40, 226, 249, 269], river: [17, 253], combined: [2, 24, 244, 265],
    defense: [12, 33, 65, 242], pincer: [8, 30, 255], final: [0, 19, 42, 65],
    pvpPlain: [24, 242], pvpForest: [0, 22, 44, 222, 244, 266], pvpRiver: [8, 258],
  };
  for (const x of groves[k] ?? []) nearTree(p, x, 181 + Math.floor(random() * 8));
  // Short stepped contour marks, never noise or a continuous horizontal ground band.
  for (let i = 0; i < 16; i++) {
    const x = 4 + Math.floor(random() * 274), y = 179 + Math.floor(random() * 11);
    // Fort uses its existing stone palette instead of adding foliage colors.
    p.rect(x, y, 3 + Math.floor(random() * 5), 1, C.grass);
  }
  if (s.width < 12) rocks(p, (W - s.width * TILE) / 2, k);
  const edge = (W - s.width * TILE) / 2;
  p.rect(0, H - 1, W, 1, C.rock);
  p.rect(edge, H - 1, s.width * TILE, 1, C.ground);
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
  p.rect(0, 57, W, 53, C[`${s.sky}1`]); p.rect(0, 110, W, H - 110, C[`${s.sky}2`]);
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
  if (['hold', 'final'].includes(k)) p.rows(k === 'hold' ? 190 : 114, k === 'hold' ? 108 : 101,
    ['...cccc...', '.cccccccc.', 'cccccccccc', 'cccccccccc', 'cccccccccc', '.cccccccc.', '...cccc...'], { c: C.cloud });
  for (const [x, y, w] of clouds[k]) cloud(p, x, y * 2 - 5, w, s.sky !== 'day');
  cloud(p, 42 + Math.floor(random() * 35), 117, 62, s.sky !== 'day');
  // Retain native-pixel silhouettes in the lower third, with ground continuing to the seam.
  const land = {
    rect: (x, y, w, h, c) => p.rect(x, y + 68, w, y + h >= 96 ? H - y - 68 : h, c),
    rows: (x, y, rows, colors) => p.rows(x, y + 68, rows, colors),
    ridge: (points, c) => p.ridge(points.map(([x, y]) => [x, y + 68]), c),
  };
  // Background ridge is always subordinate to a large readable sky.
  const farPoints = [[0, 80], [31, 76], [58, 78], [91, 66], [116, 70], [145, 61], [174, 74], [211, 68], [247, 76], [288, 72]];
  const shift = Math.floor(random() * 9);
  land.ridge(farPoints.map(([x, y]) => [x, y + shift]), C.far);
  land.ridge([[0, 87], [40, 80], [76, 85], [111, 78], [152, 84], [197, 77], [240, 83], [288, 80]], C.ridge);
  if (k === 'first') { land.rect(0, 84, W, 12, C.grass); trees(land, 16, 61, 87, random, false, true); }
  if (k === 'shelf') hills(land, [[0, 83], [47, 82], [78, 80], [138, 80], [173, 83], [242, 83], [288, 85]]);
  if (k === 'wind') { land.rect(0, 87, W, 9, C.grass); trees(land, 214, 270, 87, random, false, true); }
  if (['wings', 'pincer'].includes(k)) hills(land, [[0, k === 'pincer' ? 74 : 79], [34, 77], [89, 89], [146, 91], [208, 87], [258, 77], [288, 76]]);
  if (k === 'wide') { hills(land, [[0, 87], [68, 83], [121, 89], [201, 82], [288, 88]]); trees(land, 235, 279, 87, random, false, true); }
  if (k === 'hill') hills(land, [[0, 78], [40, 69], [70, 68], [118, 79], [166, 82], [224, 73], [250, 73], [288, 81]]);
  if (['forest', 'pvpForest'].includes(k)) {
    land.rect(0, 88, W, 8, C.grass);
    trees(land, -5, 95, 84, random, true, true); trees(land, 193, 290, 84, random, true, true);
    trees(land, -5, 81, 91, random, true); trees(land, 210, 290, 91, random, true);
    if (k === 'forest') { land.rect(10, 84, 61, 2, C[s.sky + '2']); land.rect(225, 82, 63, 2, C[s.sky + '2']); }
  }
  if (['river', 'pvpRiver', 'combined'].includes(k)) {
    land.rect(0, 84, W, 12, C.grass);
    trees(land, 0, k === 'pvpRiver' ? 64 : 116, 83, random, true, true);
    trees(land, k === 'pvpRiver' ? 224 : 191, 287, 83, random, true, true);
    land.rect(k === 'pvpRiver' ? 62 : 15, 87, k === 'pvpRiver' ? 164 : 259, 3, C.water);
    for (const [x, w] of [[81, 17], [131, 28], [191, 12]]) land.rect(x, 87, w, 1, C[s.sky + '2']);
    land.rect(0, 90, W, 6, C.grass);
    if (k === 'combined') { hills(land, [[0, 93], [65, 91], [110, 89], [169, 89], [224, 92], [288, 93]]); trees(land, -2, 49, 93, random, true); trees(land, 244, 290, 93, random, true); }
  }
  if (k === 'defense') { land.rect(0, 90, W, 6, C.grass); trees(land, 11, 121, 90, random, true, true); trees(land, 184, 275, 89, random, false, true); }
  if (k === 'fort') { fort(land); land.rect(0, 88, W, 8, C.grass); }
  if (k === 'final') {
    hills(land, [[0, 88], [69, 84], [125, 89], [193, 83], [239, 86], [288, 85]]);
    trees(land, -3, 78, 92, random, true);
    land.rect(198, 80, 90, 3, C.dusk2); land.rect(223, 86, 65, 2, C.dusk2);
  }
  if (k === 'pvpPlain') hills(land, [[0, 86], [48, 83], [96, 86], [144, 89], [192, 86], [240, 83], [288, 86]]);
  if (k === 'pvpHill') hills(land, [[0, 91], [48, 88], [95, 75], [124, 70], [151, 70], [183, 77], [240, 88], [288, 91]]);
  approach(p, s, random);
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
// Sheet-only 16×20 bitmap glyphs; rasterized once from Hiragino, no runtime font/tool dependency.
const LABEL_FONT = {
  "1": '0000000000001c000400040004000400040004000400040004000400040004000000000000000000',
  "2": '0000000000001f003180608060800080010006000c0018003000200060007fc00000000000000000',
  "3": '0000000000001e00310060800080018003000e00018000800080408061801e000000000000000000',
  "4": '0000000000000300030007000d0009001900310021004100ffc00100010001000000000000000000',
  "5": '0000000000003f8020002000200020002f007180008000800080608031001e000000000000000000',
  "-": '00000000000000000000000000000000000000000000f80000000000000000000000000000000000',
  " ": '00000000000000000000000000000000000000000000000000000000000000000000000000000000',
  "初": '00000000100019fe00627c460446044608441a443c44564410841084110413041238000000000000',
  "陣": '000000007c2044204ffe48205bfc52244a244bfc4a244a244bfc582047fe40204020000000000000',
  "盾": '0000000000081ff0304020403ffe208027fc2404240427fc240427fc2404440447fc040400000000',
  "の": '000000000000000003e00db0198811042104210421042204220426081c1800e00000000000000000',
  "壁": '0000000000003e1022fe22403e2820fe3e1050fc50101f1000801ffc008000807ffe000000000000',
  "矢": '0000000004000c0008001ffc1100210001007ffe01800380024006600c30181c7006000000000000',
  "雨": '0000000000007ffe010001003ffc210429642534210421042d24251421042104211c000000000000',
  "両": '0000000000007ffe010001003ffc2104210421042104210421042ff4200420042004201c00000000',
  "翼": '0000000000007ffe31620d1a31621ff811081ff811081ff83ffc04207ffe0420381c000000000000',
  "騎": '0000000000007e2009fe3c30085809863c0009fe3e0402f45a944e944ef4428404040c1c00000000',
  "馬": '0000000000001ffc108010801ff810801ff8108010801ffe100404a4249424944404003800000000',
  "平": '0000000000003ffe0100110811080910093001007ffe010001000100010001000100010000000000',
  "原": '0000000000003ffe2040208027fc240427fc2404240427fc2040224824484c445846038000000000',
  "決": '0000000000402040104003fc004460443044104407fe00c010a011a0211022084c06080000000000',
  "戦": '0000000000004928292402247f8000fe3f90009400947f98001800107fb8004a0d86000000000000',
  "丘": '00000000000800700f801800180018001ffc18201820182018201820182018207ffe000000000000',
  "上": '0000000000000100010001000100010001fc01000100010001000100010001007ffe000000000000',
  "森": '00000000000001003ffc03c005601918710e090008107efe18301c782a9449120810080000000000',
  "待": '000000000840104023fc4040084017fe3008700853fe100811081188108810081070000000000000',
  "ち": '0000000000000200020006183ff00400040008000bf00e18180800080008083007e0000000000000',
  "伏": '000000000000084008481044104037fe7040506010a010a010901110110812041402100000000000',
  "せ": '00000000000000000830083008301ffe7c3008200820082008e00800040003f80000000000000000',
  "川": '00000000000010041084108410841084108410841084308420842084208440044004000000000000',
  "を": '000000000000030002003ff004000c000f801cbc30e021c0064004400400040003f8000000000000',
  "渡": '000000000040206017fe048807fe6488348804f8040005fc148c2cd8287068705b8e000000000000',
  "る": '00000000000000000fe0004000800100020007f01c0830040704048c0448047003e0000000000000',
  "い": '000000000000000000002000201020182008300c30041104110413060a000c000000000000000000',
  "谷": '00000000000004200c101808318601800240042018183ffe48120810081008100ff0081000000000',
  "狭": '0000000000002420282013fe302051240924092818202bfe68600850089009880b06760200000000',
  "道": '000000000100409027fe1040004003fc020473fc120413fc1204120433fc6c0043fe000000000000',
  "寡": '0000000001007ffe40025ffa01000ff80ff000000ff07ffe0c303ff84216041038e0000000000000',
  "兵": '00000000000800f00f00080008000ffe08200820082008207ffe000004201818300c000000000000',
  "柵": '00000000100013fc129412947a9432943a9437fe5294529412941294129412941294120c00000000',
  "守": '00000000010001007ffe40024022002000207ffe002008200c20062002200020002000e000000000',
  "り": '000000000000080009e00b300a100c100c1008100810081000100020006001c00300000000000000',
  "砦": '000000000440044427782440244225427e3e00007ffe040008001ff8280848080ff8080000000000',
  "攻": '00000000000000c07e80108011fe110813081288109010d01660386040d001880706040000000000',
  "め": '0000000000000020086008400be00c581c8c34842584230422042608181800e00000000000000000',
  "挟": '0000000010001020102013fe7c20120411481148384057fe106010b01090110c7606000000000000',
  "み": '00000000000000001f8001000108010802080f8816f8241824164412282030400080000000000000',
  "撃": '0000000008007f7808483f863ffc094c3e387f3808c61ff800803ffc00807ffe0080030000000000',
  "時": '0000000000203c2005fe0420042007fe3c08040807fe0408050804883c4804080008003800000000',
  "稼": '000000000040382013fe120213fe7c4010c43b48347850a85328106410d61312162010e000000000',
  "ぐ": '000000000000004000c00180030806140c10180018000c000200018000c000600020000000000000',
  "天": '00000000000000003ffc0100010001007ffe018003800240024004200810300c6006000000000000',
  "下": '0000000000007ffe01000100018001e00130010c0100010001000100010001000100010000000000',
  "分": '0000000000000420042008101018300c6ff6021002100210061004100810181020e0000000000000',
  "け": '000000000000101010101010101413fc301020102010241028103820182010400080000000000000',
  "目": '0000000000001ff81008100810081ff81008100810081ff81008100810081ff81008000000000000',
  "p": '00000000000000000000000000004f0071806080608040c06080608071804f004000400040000000',
  "v": '0000000000000000000000000000c100410042002200260034001400180008000000000000000000',
  "l": '00000000000060004000400040004000400040004000400040004000400060000000000000000000',
  "a": '00000000000000000000000000001e002300010001003f006100410067003d000000000000000000',
  "i": '00000000000060000000000000006000400040004000400040004000600060000000000000000000',
  "n": '00000000000000000000000000004e00710061806180418041804180418061800000000000000000',
  "h": '00000000000040004000400040004e00710061806180418041804180418061800000000000000000',
  "中": '0000000000000100010001003ffc21042104210421043ffc21040100010001000100010000000000',
  "央": '000000000000018001001ff811081108110811087ffe018002400260043018187006000000000000',
  "r": '00000000000000000000000000004e00700060006000400040004000400060000000000000000000',
  "e": '00000000000000000000000000001e002300410041007f804000400023001e000000000000000000',
  "f": '0000000000001c00300030002000fc00300020002000200020002000300030000000000000000000',
  "o": '00000000000000000000000000001e0021004080408040804080408021001e000000000000000000',
  "s": '00000000000000000000000000003c006200400060001e000300410063003e000000000000000000',
  "t": '0000000000000000000030002000fc0020002000200020002000200030001c000000000000000000',
  "脇": '000000000000382028202bfc2844391c2800290829083bde294a294249524a524fec580000000000',
};
const SCALE = 2, CELL_W = W * SCALE + 32, CELL_H = H * SCALE + 52;
function sheet(images) {
  const p = new Pixels(CELL_W * 4, CELL_H * 5, 0x1d1810);
  images.forEach(({ s, p: src }, i) => {
    const ox = i % 4 * CELL_W + 16, oy = Math.floor(i / 4) * CELL_H + 36;
    let cursor = ox;
    for (const ch of s.id + '  ' + s.name) {
      const glyph = LABEL_FONT[ch];
      assert.ok(glyph, 'missing sheet label glyph: ' + ch);
      for (let y = 0; y < 20; y++) {
        const bits = Number.parseInt(glyph.slice(y * 4, y * 4 + 4), 16);
        for (let x = 0; x < 16; x++) if (bits & (1 << (15 - x))) p.dot(cursor + x, oy - 28 + y, C.cloud);
      }
      cursor += ch.codePointAt(0) < 128 ? 10 : 18;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p.rect(ox + x * SCALE, oy + y * SCALE, SCALE, SCALE, src.data[y * W + x]);
  });
  return p;
}
await mkdir(OUT, { recursive: true });
const images = [], hashes = new Set(), palette = new Set(Object.values(C));
console.log('| 面 | 列数 | 寸法 | 色数 | 半透明/透明画素 | 下端の草（x・幅） | 検証 |');
console.log('|---|---:|---|---:|---:|---|---|');
for (const s of SCENES) {
  assert.ok(Number.isInteger(s.width) && s.width > 0 && s.width <= 12, s.id + ': field width');
  const original = draw(s), path = `${OUT}${s.id}.png`;
  await writeFile(path, encode(original));
  const bytes = await readFile(path), p = decode(bytes), colors = new Set(p.data);
  assert.equal(p.w, W); assert.equal(p.h, H); assert.ok(colors.size <= 16, `${s.id}: ${colors.size} colors`);
  for (const color of colors) assert.ok(palette.has(color), s.id + ': existing palette only');
  assert.deepEqual(p.data, original.data, `${s.id}: pixel roundtrip`);
  assert.deepEqual(encode(draw(s)), bytes, `${s.id}: deterministic regeneration`);
  const hash = createHash('sha256').update(bytes).digest('hex'); assert.ok(!hashes.has(hash), 'duplicate image'); hashes.add(hash);
  for (let x = 0; x < W; x++) {
    assert.equal(p.data[x], C[s.sky + '0']);
    const edge = (W - s.width * TILE) / 2;
    const rock = x < edge || x >= W - edge;
    assert.equal(p.data[(H - 1) * W + x], rock ? C.rock : C.ground, `${s.id}: ground seam ${x}`);
  }
  images.push({ s, p });
  console.log(`| ${s.id} ${s.name} | ${s.width} | ${p.w}×${p.h} | ${colors.size} | 0 | x=${(W - s.width * TILE) / 2}〜${(W + s.width * TILE) / 2 - 1}・${s.width * TILE}px | OK |`);
}
assert.equal(images.length, 19);
await mkdir(fileURLToPath(new URL('.', `file://${SHEET}`)), { recursive: true });
const overview = sheet(images); await writeFile(SHEET, encode(overview));
const reread = decode(await readFile(SHEET)); assert.deepEqual(reread.data, overview.data);
// Verify each enlarged art pixel, excluding the sheet-only labels and gutters.
images.forEach(({ p: src }, i) => {
  const ox = i % 4 * CELL_W + 16, oy = Math.floor(i / 4) * CELL_H + 36;
  for (let y = 0; y < H * SCALE; y++) for (let x = 0; x < W * SCALE; x++)
    assert.equal(reread.data[(oy + y) * reread.w + ox + x], src.data[Math.floor(y / SCALE) * W + Math.floor(x / SCALE)]);
});
console.log(`\nSheet: ${SHEET} (${overview.w}×${overview.h}, nearest 2×; readback verified)`);
console.log('\nPalette: ' + Object.entries(C).map(([k, v]) => `${k}=#${v.toString(16).padStart(6, '0')}`).join(' '));
for (const s of SCENES) console.log(`${s.id} ${s.name}: ${s.intent}`);
