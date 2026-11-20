import { buildTextures, standKey, soldierKey, tileKey } from './textures.ts';
import { COLOR, SIDE_COLOR, ART, css } from './palette.ts';

const font = new FontFace('DotGothic16', 'url(/font.ttf)');
document.fonts.add(await font.load());
const textures = new Map();
// Phaser のテクスチャ登録口だけを Canvas で受け、ゲームと同じ描画関数を呼ぶ。
buildTextures({ textures: {
  exists: (key) => textures.has(key),
  createCanvas(key, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    textures.set(key, canvas);
    return { getContext: () => canvas.getContext('2d'), refresh() {} };
  },
} });

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = css(color); ctx.fillRect(x, y, w, h);
}
function title(ctx, y) {
  // フォントを原寸32pxで描いて二値化。中間色とアンチエイリアスを残さない。
  const mask = document.createElement('canvas');
  mask.width = 144; mask.height = 40;
  const m = mask.getContext('2d');
  m.font = '32px DotGothic16'; m.textBaseline = 'top';
  m.fillText('陣形合戦', 8, 0);
  const pixels = m.getImageData(0, 0, 144, 40);
  for (let py = 0; py < 40; py++) for (let px = 0; px < 144; px++) {
    // 1px 横に重ねて線を太くする。二値マスクのままなので、ぼかしも中間色もない。
    if (pixels.data[(py * 144 + px) * 4 + 3] >= 128) rect(ctx, COLOR.goldHi, 128 + px, y + py, 2, 1);
  }
}

// packages/engine/src/templates.ts の crane / scale / hqCell を9部隊で展開した座標。
// 幅10、高さ5、歩兵2・盾兵2・弓兵2・騎兵2・本陣1。cx は横幅、cy は前からの深さ。
// OGP では進行方向を横へ写す。本陣の絵には general を使う。
const formations = [
  [
    ['general', 4, 4],
    ['shield', 4, 2], ['shield', 5, 2],
    ['archer', 4, 3], ['archer', 5, 3],
    ['infantry', 3, 1], ['infantry', 6, 1],
    ['cavalry', 2, 0], ['cavalry', 7, 0],
  ],
  [
    ['general', 4, 4],
    // scale の先頭の歩兵と中段の盾兵を交換し、盾で先端を作る。
    ['shield', 4, 0], ['shield', 5, 0],
    ['infantry', 4, 1], ['infantry', 5, 1],
    // scale の弓兵 (3,1), (6,1) は一段後ろへ。くさびの幅は維持する。
    ['archer', 3, 2], ['archer', 6, 2],
    ['cavalry', 2, 1], ['cavalry', 7, 1],
  ],
];

// 400×210 の整数座標。題字は二値マスク全体と太字化の1pxを含む保守的な領域。
const layouts = {
  selected: { fieldTop: 62, fieldBottom: 198, titleY: 12, titleBox: [128, 12, 145, 40],
    front: [160, 224], depth: 24, step: 22, baseline: [82, 82], flat: false,
    flags: [[40, 112], [350, 112]],
    terrain: [['forest', 16, 62], ['hill', 352, 62], ['fence', 16, 174], ['forest', 352, 174]] },
  banner: { fieldTop: 8, fieldBottom: 204, titleY: 88, titleBox: [16, 86, 368, 44],
    front: [160, 224], depth: 24, step: 12, baseline: [22, 142], flat: true,
    flags: [[40, 24], [350, 160]],
    terrain: [['forest', 16, 8], ['hill', 352, 8], ['hill', 16, 180], ['fence', 352, 132]] },
  field: { fieldTop: 54, fieldBottom: 198, titleY: 6, titleBox: [128, 6, 145, 40],
    front: [174, 226], depth: 28, step: 24, baseline: [68, 68], flat: true,
    flags: [[34, 112], [362, 112]],
    terrain: [['forest', 16, 54], ['forest', 40, 54], ['hill', 352, 54],
      ['fence', 16, 174], ['hill', 328, 174], ['hill', 352, 174]] },
};

function unitsFor(layout) {
  return formations.flatMap((formation, team) => formation.map(([shape, cx, cy]) => {
    const dir = team === 0 ? 1 : 3; // 藍は右向き、朱は左向き。
    const image = textures.get((layout.flat ? soldierKey : standKey)(team, shape, dir, 0));
    const x = layout.front[team] + (team === 0 ? -1 : 1) * cy * layout.depth;
    const bottom = layout.baseline[team] + (cx - 2) * layout.step;
    return { image, team, shape, x, y: bottom - image.height * 2, w: image.width * 2, h: image.height * 2 };
  }));
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// 描画前にも実テクスチャの外接矩形で検査する。透明部分も含む厳しい判定。
function validateLayout(name, layout, units) {
  const [x, y, w, h] = layout.titleBox;
  const obstacles = [{ x, y, w, h },
    ...layout.terrain.map(([, x, y]) => ({ x, y, w: 24, h: 24 })),
    ...layout.flags.map(([x, y]) => ({ x, y, w: 16, h: 30 }))];
  for (const [i, unit] of units.entries()) {
    if (![unit.x, unit.y, unit.w, unit.h].every(Number.isInteger)
      || unit.x < 16 || unit.x + unit.w > 384
      || unit.y < layout.fieldTop || unit.y + unit.h > layout.fieldBottom) {
      throw new Error(`${name}: 部隊${i}が戦場外`);
    }
    if (obstacles.some((box) => overlaps(unit, box)) || units.slice(i + 1).some((other) => overlaps(unit, other))) {
      throw new Error(`${name}: 部隊${i}が題字・地形・旗・他部隊と重なる`);
    }
  }
}

// 地形の直書き色も palette.ts の色だけに制限。ゲームのタイルの形は変えない。
const terrainColors = new Map([
  [0x7d9a40, COLOR.grass3], [0x9cb456, COLOR.grass1], [0x5a7430, COLOR.grass2],
  [0x2a4418, COLOR.grass2], [0x3a5a22, COLOR.grass1], [0x4e7430, COLOR.grass3],
  [0xb07a3a, ART.bronze],
]);
function terrainImage(terrain) {
  const source = textures.get(tileKey(terrain));
  const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 24;
  const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, 24, 24);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const color = terrainColors.get((pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2]);
    if (color === undefined) continue;
    pixels.data[i] = (color >> 16) & 255;
    pixels.data[i + 1] = (color >> 8) & 255;
    pixels.data[i + 2] = color & 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
function flag(ctx, team, x, y) {
  rect(ctx, COLOR.pole, x, y, 2, 30);
  rect(ctx, SIDE_COLOR[team].main, x + 2, y, 14, 10);
  rect(ctx, ART.gold, x + 4, y + 2, 10, 6);
}
for (const [name, layout] of Object.entries(layouts)) {
  const units = unitsFor(layout);
  validateLayout(name, layout, units);
  const base = document.createElement('canvas'); base.width = 400; base.height = 210;
  const ctx = base.getContext('2d'); ctx.imageSmoothingEnabled = false;
  rect(ctx, COLOR.bg, 0, 0, 400, 210);
  const { fieldTop, fieldBottom } = layout;
  for (let y = fieldTop; y < fieldBottom; y += 24) for (let x = 16; x < 384; x += 24) {
    ctx.drawImage(textures.get(tileKey('plain', (Math.floor(x / 24) + Math.floor(y / 24)) % 4)), x, y);
  }
  for (const [terrain, x, y] of layout.terrain) ctx.drawImage(terrainImage(terrain), x, y);
  // 周縁は余白。切り抜きで失われても題字と両軍は中央に残る。
  rect(ctx, COLOR.bg, 0, 0, 400, fieldTop);
  rect(ctx, COLOR.bg, 0, fieldBottom, 400, 210 - fieldBottom);
  rect(ctx, COLOR.bg, 384, 0, 16, 210);
  rect(ctx, COLOR.goldLo, 16, fieldTop - 2, 368, 2);
  rect(ctx, COLOR.goldLo, 16, fieldBottom, 368, 2);
  for (const unit of units) ctx.drawImage(unit.image, unit.x, unit.y, unit.w, unit.h);
  layout.flags.forEach(([x, y], team) => flag(ctx, team, x, y));
  if (name === 'banner') {
    rect(ctx, COLOR.panel, 16, 86, 368, 44);
    rect(ctx, COLOR.gold, 16, 86, 368, 2);
    rect(ctx, COLOR.gold, 16, 128, 368, 2);
  }
  title(ctx, layout.titleY);
  const output = document.createElement('canvas'); output.width = 1200; output.height = 630;
  const out = output.getContext('2d'); out.imageSmoothingEnabled = false;
  out.drawImage(base, 0, 0, 1200, 630);
  document.body.append(output);
  const png = await new Promise((resolve) => output.toBlob(resolve, 'image/png'));
  const response = await fetch(`/save/${name}`, { method: 'POST', body: png });
  if (!response.ok) throw new Error(await response.text());
}

// favicon（64×64）。画面の地の色の上に、藍の本陣の立ち姿を整数倍で置き、金の枠で囲む
{
  const icon = document.createElement('canvas'); icon.width = 64; icon.height = 64;
  const ctx = icon.getContext('2d'); ctx.imageSmoothingEnabled = false;
  rect(ctx, COLOR.gold, 0, 0, 64, 64);
  rect(ctx, COLOR.bg, 4, 4, 56, 56);
  const image = textures.get(standKey(0, 'general', 1, 0));
  const scale = Math.max(1, Math.floor(48 / Math.max(image.width, image.height)));
  const w = image.width * scale; const h = image.height * scale;
  ctx.drawImage(image, Math.floor((64 - w) / 2), Math.floor((64 - h) / 2), w, h);
  document.body.append(icon);
  const png = await new Promise((resolve) => icon.toBlob(resolve, 'image/png'));
  const response = await fetch('/save/favicon', { method: 'POST', body: png });
  if (!response.ok) throw new Error(await response.text());
}

// ホーム画面用のアイコン（180・192・512）。端末が角を丸く切るので枠は付けず、地の色の上に本陣だけを置く
// （絵は中央の 7 割ほどに収める。丸く切られても欠けない）
for (const size of [180, 192, 512]) {
  const icon = document.createElement('canvas'); icon.width = size; icon.height = size;
  const ctx = icon.getContext('2d'); ctx.imageSmoothingEnabled = false;
  rect(ctx, COLOR.bg, 0, 0, size, size);
  const image = textures.get(standKey(0, 'general', 1, 0));
  const scale = Math.max(1, Math.floor((size * 0.7) / Math.max(image.width, image.height)));
  const w = image.width * scale; const h = image.height * scale;
  ctx.drawImage(image, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  document.body.append(icon);
  const png = await new Promise((resolve) => icon.toBlob(resolve, 'image/png'));
  const response = await fetch(`/save/icon-${size}`, { method: 'POST', body: png });
  if (!response.ok) throw new Error(await response.text());
}
