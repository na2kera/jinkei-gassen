// ポスターの描画（generate-poster.mjs が配る）。3508×2480（A4 横・300dpi 相当）の canvas に描いて /save へ送る。
// 兵・タイル・枠は、ゲームの描画関数（textures.ts、formation.ts、panel.ts）をそのまま呼び、整数倍で拡大して置く。
// 色は palette.ts のものだけ。最後に全画素を調べ、ほかの色（にじみ・補間）が1つでもあれば保存しない。
import { buildTextures, soldierKey, soldierSize, standKey, standSize, tileKey, PLAIN_VARIANTS, TILE } from '/src/art/textures.ts';
import { COLOR, SIDE_COLOR, ART, css } from '/src/art/palette.ts';
import { drawFrame } from '/src/ui/panel.ts';
import { slotsOf } from '/src/art/formation.ts';

const W = 3508;
const H = 2480;
/** 家庭用・コンビニのプリンタが刷れない四辺の幅（8mm ≒ 95px）。大事なものはこの内側に置く */
const SAFE = 95;

// QR コード。中身は「https://jinkei-gassen.na2kera.com/」、誤り訂正 M、version 3（29×29）、mask 2。
// 一度だけ、npm の qrcode@1.5.4 で作った並びを写した（'#' が暗い点）。リポジトリに依存は足していない。作り直すときは、
//   npm install qrcode@1.5.4（一時フォルダで）
//   node -e "const q=require('qrcode').create('https://jinkei-gassen.na2kera.com/',{errorCorrectionLevel:'M'});
//            for(let y=0;y<q.modules.size;y++){let s='';for(let x=0;x<q.modules.size;x++)s+=q.modules.get(x,y)?'#':'.';console.log(s)}"
const QR = [
  '#######.##.##...#####.#######',
  '#.....#..##.#..##.....#.....#',
  '#.###.#.##.#..####.##.#.###.#',
  '#.###.#.##..##..#.##..#.###.#',
  '#.###.#.#..##.###.##..#.###.#',
  '#.....#.#...#..#.###..#.....#',
  '#######.#.#.#.#.#.#.#.#######',
  '.........###...#.............',
  '..######.##.####.###.#.####.#',
  '##.##..#.##.#.####.#.#.#...##',
  '..######.#.#..###.#.#.####.#.',
  '##..##.###...##......###.#..#',
  '#....##....####.#...#.##..#..',
  '###......###.....###.....#..#',
  '##.#..##.##.#..#.##.#..#.##..',
  '#####....##...##..#...#.#.#..',
  '.#..#.##..##..##.###.##..#.#.',
  '##.#....#.#.###.#...#.#.#...#',
  '#.#.###.#.##.##..#....##.##.#',
  '#.###..###...#.#.#.#.###.#..#',
  '#.#...##.###.##.###.#####..#.',
  '.........#...##.##..#...#.#..',
  '#######.##...##..##.#.#.#.#.#',
  '#.....#.###..#.#.##.#...#.#..',
  '#.###.#.##...#...##.#####.#..',
  '#.###.#.#..##.#.#....##..###.',
  '#.###.#.#...#.#.###.###.###.#',
  '#.....#....#...#...###.#####.',
  '#######..#...#...#..##.#.#...',
];

// 両軍の陣形。packages/engine/src/templates.ts の applyTemplate を、標準の手持ち R15（本陣1・歩兵5・盾兵3・騎兵3・弓兵3）、
// 標準の戦場（12×16）の配置エリアで走らせた結果を写した [兵種, 列, 行]。藍（陣営0、下側）は鶴翼、朱（陣営1、上側）は魚鱗。
const ARMIES = [
  [['hq', 5, 14], ['shield', 5, 12], ['shield', 6, 12], ['shield', 4, 12], ['archer', 5, 13], ['archer', 6, 13], ['archer', 4, 13],
    ['infantry', 3, 11], ['infantry', 2, 10], ['infantry', 1, 10], ['cavalry', 0, 10], ['infantry', 7, 11], ['infantry', 8, 10],
    ['cavalry', 9, 10], ['cavalry', 10, 10]],
  [['hq', 6, 1], ['infantry', 6, 5], ['infantry', 5, 5], ['infantry', 6, 4], ['infantry', 5, 4], ['infantry', 7, 4],
    ['shield', 4, 4], ['shield', 6, 3], ['shield', 5, 3], ['archer', 7, 3], ['archer', 4, 3], ['archer', 8, 3],
    ['cavalry', 9, 3], ['cavalry', 2, 3], ['cavalry', 10, 2]],
];
const FIELD_COLS = 12;
const FIELD_ROWS = 16;

async function report(message) {
  try { await fetch('/error', { method: 'POST', body: String(message) }); } catch { /* サーバーが止まっていれば何もしない */ }
}
addEventListener('error', (e) => report(e.error?.stack ?? e.message));
addEventListener('unhandledrejection', (e) => report(e.reason?.stack ?? e.reason));

const font = new FontFace('DotGothic16', 'url(/font.ttf)');
document.fonts.add(await font.load());

const textures = new Map();
// Phaser のテクスチャ登録口だけを Canvas で受け、ゲームと同じ描画関数を呼ぶ（OGP と同じ）
buildTextures({ textures: {
  exists: (key) => textures.has(key),
  createCanvas(key, width, height) {
    const canvas = makeCanvas(width, height);
    textures.set(key, canvas);
    return { getContext: () => canvas.getContext('2d'), refresh() {} };
  },
} });

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').imageSmoothingEnabled = false;
  return c;
}
function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = css(color); ctx.fillRect(x, y, w, h);
}
/** ui/panel.ts の drawFrame に渡す、Phaser の Graphics の代わり。座標を k 倍して描く */
function painter(ctx, ox, oy, k) {
  let color = 0;
  return {
    fillStyle(c) { color = c; },
    fillRect(x, y, w, h) { rect(ctx, color, ox + x * k, oy + y * k, w * k, h * k); },
  };
}
/** ゲームの枠（drawFrame の 'line'）を、ゲームの px で w×h の大きさに作り、k 倍して (x, y) に置く */
function frame(ctx, x, y, w, h, k) {
  drawFrame(painter(ctx, x, y, k), { x: 0, y: 0, w, h }, 'line');
}

// ---- 文字 ----
// 文字は、ゲームと同じ DotGothic16 の 16px か 32px（ui/text.ts が使う2つの大きさ）の点を拾い、1点を k×k の正方形で描く
// （ドットの形を崩さず、中間色を残さない）。このフォントの字形は 1/16 em の点の格子でできているが、点どうしをつなぐため
// 各点の輪郭が隣へ 1/100 em ほどはみ出していて、そのまま 16px で描くと画素の格子からずれ、二値化すると線の太さが揃わない。
// そこで8倍の大きさで描き、8×8 のセルの中心の濃さで点を決める（はみ出しはセルの中心まで届かない）。
const OVER = 8;
const masks = new Map();
function textMask(text, size) {
  const key = `${size}:${text}`;
  if (masks.has(key)) return masks.get(key);
  const cellsH = size + size / 4;
  const baseline = size - size / 16;
  const w = (text.length + 1) * size * OVER;
  const h = cellsH * OVER;
  const c = makeCanvas(w, h);
  const m = c.getContext('2d');
  m.font = `${size * OVER}px DotGothic16`; m.textBaseline = 'alphabetic';
  m.fillText(text, (size / 8) * OVER, baseline * OVER);
  const data = m.getImageData(0, 0, w, h).data;
  // セルの中心の 2×2 画素の濃さ（0〜1）
  const fill = (x, y) => {
    const c = OVER / 2 - 1;
    let a = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) a += data[((y + c + dy) * w + x + c + dx) * 4 + 3];
    return a / (4 * 255);
  };
  const cols = Math.floor(w / OVER) - 1;
  const rows = cellsH - 1;
  let best = null;
  for (let oy = 0; oy < OVER; oy++) for (let ox = 0; ox < OVER; ox++) {
    // 点の輪郭のはみ出し（隣の点とつなぐ部分）にセルの中心が乗ると、線が2点の太さになる。
    // 線は1点以上の幅があるので、どのずれでも線の点は必ず拾える。拾った点がいちばん少なく、あいまいさの小さいずれを選ぶ
    let score = 0;
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const f = fill(ox + cx * OVER, oy + cy * OVER);
      score += (f >= 0.5 ? 1 : 0) + 2 * Math.min(f, 1 - f);
    }
    if (!best || score < best.score) best = { ox, oy, score };
  }
  const on = [];
  let minX = cols; let maxX = -1; let minY = rows; let maxY = -1;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    if (fill(best.ox + cx * OVER, best.oy + cy * OVER) < 0.5) continue;
    on.push([cx, cy]);
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
  }
  // 字の枠（size の正方形）の上の行。行の高さを揃えるときに使う
  const top = Math.round((baseline * OVER - (size - size / 8) * OVER - best.oy) / OVER);
  const mask = { on, minX, maxX, minY, maxY, top, w: maxX - minX + 1, h: maxY - minY + 1 };
  masks.set(key, mask);
  return mask;
}
/** 文字のインクの外接矩形の左上を (x, y) にして描く。align は x の意味（左端・中央・右端） */
function text(ctx, str, x, y, k, color, align = 'left', size = 16) {
  const m = textMask(str, size);
  const w = m.w * k;
  const left = align === 'center' ? Math.round(x - w / 2) : align === 'right' ? x - w : x;
  ctx.fillStyle = css(color);
  for (const [px, py] of m.on) ctx.fillRect(left + (px - m.minX) * k, y + (py - m.minY) * k, k, k);
  return place(str, left, y, w, m.h * k);
}
/** 行の高さを揃えるため、文字のインクではなく 16px の字の枠で上を決める版（漢字とかなが混ざる行どうしを並べるとき） */
function line(ctx, str, x, y, k, color, align = 'left', size = 16) {
  const m = textMask(str, size);
  return text(ctx, str, x, y + (m.minY - m.top) * k, k, color, align, size);
}

// ---- 置いたものの記録（四辺の余白と重なりを、保存の前に確かめる） ----
const placed = [];
function place(name, x, y, w, h) {
  const box = { name, x, y, w, h };
  placed.push(box);
  return box;
}
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function validatePlaced() {
  for (const [i, a] of placed.entries()) {
    if (a.x < SAFE || a.y < SAFE || a.x + a.w > W - SAFE || a.y + a.h > H - SAFE) throw new Error(`${a.name} が四辺の余白（${SAFE}px）に入っています`);
    for (const b of placed.slice(i + 1)) if (overlaps(a, b) && !a.container && !b.container) throw new Error(`${a.name} と ${b.name} が重なっています`);
  }
}

// ---- 戦場 ----
// 戦場を横に寝かせて描く（藍が左で右向き、朱が右で左向き）。ゲームの真上の画面を、時計回りに 90° 回した向き。
// ゲームの (列, 行) は、画面の (横 = 15 - 行, 縦 = 列) のマスになる
const SCREEN_COLS = FIELD_ROWS;
const SCREEN_ROWS = FIELD_COLS;
function unitsOnScreen() {
  return ARMIES.flatMap((army, team) => army.map(([kind, col, row]) => ({
    team, kind, cx: (15 - row) * TILE + TILE / 2, cy: col * TILE + TILE / 2,
    // 部隊の向き（画面の上で）。藍は右、朱は左
    f: team === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 },
    dir: team === 0 ? 1 : 3,
  })));
}

/**
 * ゲームの px のままの戦場の絵（16×12 マス = 384×288）。兵は部隊ごとに formation.ts の slotsOf の並び
 * （UnitSprite.apply と同じ計算：右へ lx、前へ -ly）。旗は UnitSprite.drawMarks の寸法を写す（士気は満ち、はためかない）。
 * standing なら、立った兵の絵（standKey）を足もとに置き、旗もその寸法にする
 */
function fieldArt(standing) {
  const c = makeCanvas(SCREEN_COLS * TILE, SCREEN_ROWS * TILE);
  const ctx = c.getContext('2d');
  for (let sy = 0; sy < SCREEN_ROWS; sy++) for (let sx = 0; sx < SCREEN_COLS; sx++) {
    const col = sy; const row = 15 - sx;
    // 平地の模様は、art/field.ts と同じ決まりでマスの位置から選ぶ
    const variant = (col * 7 + row * 13 + ((col * row) % 5)) % PLAIN_VARIANTS;
    ctx.drawImage(textures.get(tileKey('plain', variant)), sx * TILE, sy * TILE);
  }
  const units = unitsOnScreen();
  const sprites = [];
  for (const [u, unit] of units.entries()) {
    const right = { x: -unit.f.y, y: unit.f.x };
    for (const slot of slotsOf(unit.kind)) {
      const wx = unit.cx + slot.lx * right.x - slot.ly * unit.f.x;
      const wy = unit.cy + slot.lx * right.y - slot.ly * unit.f.y;
      if (standing) {
        const size = standSize(slot.shape);
        sprites.push({ u, key: standKey(unit.team, slot.shape, unit.dir, 0), x: Math.round(wx - size.w / 2), y: Math.round(wy - size.h + 1), w: size.w, h: size.h, foot: wy });
      } else {
        const size = soldierSize(slot.shape, unit.dir);
        sprites.push({ u, key: soldierKey(unit.team, slot.shape, unit.dir, 0), x: Math.round(wx - size.w / 2), y: Math.round(wy - size.h / 2), w: size.w, h: size.h, foot: wy });
      }
    }
  }
  // 部隊どうしの兵の絵が重ならないこと（透明な部分も含めた外接矩形で調べる）。立った兵は奥から順に重ねるので調べない
  if (!standing) {
    for (const [i, a] of sprites.entries()) for (const b of sprites.slice(i + 1)) {
      if (a.u !== b.u && overlaps(a, b)) throw new Error(`部隊 ${a.u} と ${b.u} の兵が重なっています`);
    }
  }
  sprites.sort((a, b) => a.foot - b.foot);
  const drawn = [...sprites];
  for (const s of sprites) ctx.drawImage(textures.get(s.key), s.x, s.y);
  // 旗。ほかの部隊の兵に重なり、左なら重ならないときは、竿の左に付け替える（ゲームが戦場の端で付け替えるのと同じ形）
  for (const [u, unit] of units.entries()) {
    const hq = unit.kind === 'hq';
    const flagW = hq ? 10 : 6;
    const flagH = hq ? 8 : 4;
    const poleH = standing ? (hq ? 30 : 26) : hq ? 24 : 20;
    let poleTop = standing ? (hq ? -34 : -30) : hq ? -22 : -18;
    if (unit.cy + poleTop < 0) poleTop = -unit.cy;
    const boxOf = (mirror) => {
      const poleX = mirror ? -12 : 10;
      const x0 = mirror ? poleX - flagW : poleX;
      return { x: unit.cx + x0, y: unit.cy + poleTop, w: flagW + 2, h: poleH };
    };
    const hits = (box) => box.x < 0 || box.x + box.w > c.width || sprites.some((s) => s.u !== u && overlaps(s, box));
    // どちらに付けても重なる（密な並びの中の部隊）ときは、ゲームと同じく竿の右に付け、旗を兵の上に描く
    const mirror = hits(boxOf(false)) && !hits(boxOf(true));
    const poleX = mirror ? -12 : 10;
    const fy = unit.cy + poleTop;
    drawn.push(boxOf(mirror));
    rect(ctx, COLOR.pole, unit.cx + poleX, fy, 2, poleH);
    const color = SIDE_COLOR[unit.team];
    const x0 = unit.cx + (mirror ? poleX - flagW : poleX + 2);
    if (hq) {
      rect(ctx, color.main, x0, fy, flagW, flagH);
      rect(ctx, ART.gold, x0 + 2, fy + 2, flagW - 4, flagH / 2 - 2);
      rect(ctx, ART.gold, x0 + 2, fy + flagH / 2, flagW - 4, flagH / 2 - 2);
    } else if (unit.team === 0) {
      rect(ctx, color.light, x0, fy, flagW, flagH);
    } else {
      for (let i = 0; i < flagH / 2; i++) {
        const w = flagW - i * 2;
        rect(ctx, color.light, unit.cx + (mirror ? poleX - w : poleX + 2), fy + i * 2, w, 2);
      }
    }
  }
  return { canvas: c, drawn };
}

/**
 * 枠つきの戦場を k 倍して (x, y) に置く。枠はゲームの px で 6（輪郭・金の線・地の 2px ずつ）。
 * 戦場の上の隅に、両軍の陣形の名前を、ゲームの箱（drawFrame）と 16px の文字で、戦場と同じ倍率で置く
 */
function framedField(ctx, x, y, k, standing) {
  const { canvas: art, drawn } = fieldArt(standing);
  const fw = art.width + 12; const fh = art.height + 12;
  frame(ctx, x, y, fw, fh, k);
  ctx.drawImage(art, x + 6 * k, y + 6 * k, art.width * k, art.height * k);
  const box = place('戦場', x, y, fw * k, fh * k);
  box.container = true;
  FORMATION_NAMES.forEach((name, team) => {
    // 箱はゲームの px で 48×28（文字 2字 = 32×16 のまわりに 8・6 の余白）。藍は左上、朱は右上の隅
    const bw = 48; const bh = 28;
    const bx = team === 0 ? 4 : art.width - 4 - bw;
    const by = 4;
    if (drawn.some((d) => overlaps(d, { x: bx, y: by, w: bw, h: bh }))) throw new Error(`陣形の名前「${name}」が部隊に重なります`);
    const px = x + (6 + bx) * k; const py = y + (6 + by) * k;
    frame(ctx, px, py, bw, bh, k);
    line(ctx, name, px + (bw / 2) * k, py + 6 * k, k, SIDE_COLOR[team].light, 'center');
  });
  return box;
}

// ---- QR ----
const QR_MODULE = 18;       // 1マスの px。29マスで 522px = 44mm（35mm 以上）
const QR_QUIET = 4;         // まわりの余白（マス）
const QR_FRAME_K = 6;       // 枠の倍率
const QR_SIDE = (QR.length + QR_QUIET * 2) * QR_MODULE;   // 明るい地の一辺 666px
const QR_BOX = QR_SIDE + 12 * QR_FRAME_K;                 // 枠を含めた一辺 738px
function qr(ctx, x, y) {
  if (QR_SIDE % QR_FRAME_K !== 0) throw new Error('QR の地が枠の倍率で割り切れません');
  frame(ctx, x, y, QR_BOX / QR_FRAME_K, QR_BOX / QR_FRAME_K, QR_FRAME_K);
  const ox = x + 6 * QR_FRAME_K; const oy = y + 6 * QR_FRAME_K;
  rect(ctx, COLOR.cream, ox, oy, QR_SIDE, QR_SIDE);
  QR.forEach((row, my) => [...row].forEach((cell, mx) => {
    if (cell === '#') rect(ctx, COLOR.ink, ox + (mx + QR_QUIET) * QR_MODULE, oy + (my + QR_QUIET) * QR_MODULE, QR_MODULE, QR_MODULE);
  }));
  return place('QR', x, y, QR_BOX, QR_BOX);
}

// ---- 文言（依頼主が直せるよう、ここにまとめる） ----
const TITLE = '陣形合戦';
const TAGLINE = '部隊を並べて、動き方を決めて戦わせる陣形シミュレーション。';
const FEATURES = [['1人用 15面'], ['2人でリアルタイム対戦'], ['スマホ・パソコンの', 'ブラウザですぐ遊べる']];
const URL_TEXT = 'jinkei-gassen.na2kera.com';
const QR_CAPTION = 'スマホで読み取って遊ぶ';
const FORMATION_NAMES = ['鶴翼', '魚鱗'];

/** 特徴の箱（ゲームの枠を 6 倍）。各項目の頭に金の四角 */
function features(ctx, x, y, w, k, gap) {
  const lineH = 16 * k;
  const rows = FEATURES.reduce((n, f) => n + f.length, 0);
  const pad = 42;
  const leading = 4 * k;   // 1つの項目が2行のときの行間
  const inner = rows * lineH + FEATURES.reduce((n, f) => n + (f.length - 1) * leading, 0) + (FEATURES.length - 1) * gap;
  const h = Math.ceil((pad * 2 + inner) / 6) * 6;
  if (w % 6) throw new Error(`特徴の箱の幅 ${w} が 6 で割り切れません`);
  frame(ctx, x, y, w / 6, h / 6, 6);
  const box = place('特徴の枠', x, y, w, h);
  box.container = true;
  let cy = y + Math.floor((h - inner) / 2);
  for (const item of FEATURES) {
    rect(ctx, COLOR.gold, x + pad, cy + 6 * k, 3 * k, 3 * k);
    for (const str of item) {
      const t = line(ctx, str, x + pad + 6 * k, cy, k, COLOR.cream);
      if (t.x + t.w > x + w - pad) throw new Error(`「${str}」が特徴の箱からはみ出します`);
      cy += lineH + leading;
    }
    cy += gap - leading;
  }
  return box;
}

/** 右の列の幅（6 の倍数）。戦場の右から 64px あけ、右の端は 3368 */
function column(field) {
  const x = field.x + field.w + 64;
  return { x, w: Math.floor((3368 - x) / 6) * 6 };
}

// ---- 構図 ----
// 題字と一言を左上、戦場を左下に大きく、右の列の上に特徴、下に QR。兵は立った絵（ゲームの「横から」の視点と同じ、
// 藍が左・朱が右）。真上の絵より、離れて見ても兵だと分かる
function layout(ctx) {
  text(ctx, TITLE, 140, 140, 14, COLOR.goldHi);
  line(ctx, TAGLINE, 140, 410, 4, COLOR.cream);
  const field = framedField(ctx, 140, 540, 6, true);
  const col = column(field);
  const mid = col.x + col.w / 2;
  features(ctx, col.x, 540, col.w, 4, 40);
  // QR と、その下の URL・一言は、最後の行の下が戦場の下の端に揃うように置く
  const qrY = field.y + field.h - QR_BOX - 210;
  qr(ctx, col.x + Math.floor((col.w - QR_BOX) / 2), qrY);
  line(ctx, URL_TEXT, mid, qrY + QR_BOX + 40, 3, COLOR.cream, 'center');
  line(ctx, QR_CAPTION, mid, qrY + QR_BOX + 40 + 48 + 58, 4, COLOR.gold, 'center');
}

const allowed = new Set([...Object.values(COLOR), ...Object.values(ART), ...[0, 1].flatMap((t) => Object.values(SIDE_COLOR[t]))]);
function validateColors(ctx) {
  const data = ctx.getImageData(0, 0, W, H).data;
  const bad = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (data[i + 3] !== 255 || !allowed.has(c)) bad.set(c, (bad.get(c) ?? 0) + 1);
  }
  if (bad.size) throw new Error(`palette.ts にない色：${[...bad].slice(0, 8).map(([c, n]) => `#${c.toString(16).padStart(6, '0')}×${n}`).join(' ')}`);
}

try {
  const poster = makeCanvas(W, H);
  const ctx = poster.getContext('2d');
  rect(ctx, COLOR.bg, 0, 0, W, H);
  layout(ctx);
  validatePlaced();
  validateColors(ctx);
  document.body.append(poster);
  const png = await new Promise((resolve) => poster.toBlob(resolve, 'image/png'));
  const response = await fetch('/save', { method: 'POST', body: png });
  if (!response.ok) throw new Error(await response.text());
} catch (error) {
  await report(error.stack ?? error);
}
