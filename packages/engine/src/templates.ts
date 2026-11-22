// ひな形（design §3.7）。手持ちと配置エリアから、配置と方針を返す。
// 形は「自軍から見た」座標（cx: 自分から見て左が 0、cy: 敵に近い前の行が 0）で組み立て、最後に戦場の座標へ写す。
// 組み立てた先が埋まっている・エリアの外のときは、いちばん近い空きマスへずらすので、6〜12 部隊のどの手持ちでも
// エリアに収まり、重ならず、全部隊を使い切る。乱数は使わないので、同じ入力からはいつも同じ配置になる。
//
// 仮の形（design §13.1 の 2）：通り道つきの盤の配置エリア 8×4 に合わせて、実験の枝（exp/grid-tuning）で作り直した形を、
// 実験用の切り替えを外して写したもの。最終の形は design §13.3 で決めて差し替える。
// - 列は「中央から外への左右の組」（8列なら [3,4]・[2,5]・[1,6]・[0,7]）で選び、偶数の幅でも左へ寄らないようにする。
// - 組の片方だけが余ったとき（奇数）は、本陣の隣（本陣と左右対称になるマス）へ回せる形では回す（mate）。
// - 奥行きは 4 行を前提にした形だが、行がエリアの外に出るときは、いちばん近い空きマスへずらすだけで止まらない（幅 4〜7 でも同じ）。

import type { Kind, Placement, Roster, Side, Stance, TemplateId, TemplateInfo, Zone } from './types.ts';
import { isInt, isObject, MAX_FIELD_SIDE } from './input.ts';
import { MAX_UNITS } from './army.ts';

const TEMPLATES: TemplateInfo[] = [
  { id: 'line', name: '横陣', description: '横一列に2段。前列に盾兵と歩兵、後列に弓兵、両端に騎兵' },
  { id: 'crane', name: '鶴翼', description: 'V字。両翼が前に張り出し、中央が下がる' },
  { id: 'scale', name: '魚鱗', description: '先がとがった三角形で、中央が厚い' },
  { id: 'arrow', name: '鋒矢', description: '細く深い縦の列で、先が矢じり' },
  { id: 'ring', name: '方円', description: '本陣を囲む輪' },
  { id: 'crescent', name: '偃月', description: '弓なり。中央が前に出て、両翼が下がる' },
  { id: 'echelon', name: '雁行', description: '斜めの段々' },
];

export function listTemplates(): TemplateInfo[] {
  return TEMPLATES.map((t) => ({ ...t }));
}

interface Want {
  kind: Kind;
  stance: Stance;
  cx: number;
  cy: number;
}

interface Counts {
  infantry: number;
  shield: number;
  cavalry: number;
  archer: number;
  hq: number;
}

interface Cell {
  cx: number;
  cy: number;
}

function counts(roster: Roster): Counts {
  const n = (k: Kind): number => {
    const v = roster[k] ?? 0;
    // 部隊数の上限を超える数は、上限で切る（巨大な数で時間を使わないため）
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_UNITS, Math.max(0, Math.floor(v))) : 0;
  };
  return { infantry: n('infantry'), shield: n('shield'), cavalry: n('cavalry'), archer: n('archer'), hq: n('hq') };
}

function centerCol(width: number): number {
  return Math.floor((width - 1) / 2);
}

function repeat(kind: Kind, n: number): Kind[] {
  return new Array<Kind>(n).fill(kind);
}

/** 列の組を中央から外へ。偶数の幅は [w/2-1, w/2] から、奇数の幅は [中央] のあと [c-1, c+1] から。組の中は左を先にする */
function colPairs(w: number): number[][] {
  const out: number[][] = [];
  if (w % 2 === 0) {
    for (let k = 0; k < w / 2; k++) out.push([w / 2 - 1 - k, w / 2 + k]);
  } else {
    const c = (w - 1) / 2;
    out.push([c]);
    for (let k = 1; k <= c; k++) out.push([c - k, c + k]);
  }
  return out;
}

/** 行 row の、組 from から組 to（含まない）までのマス（中央から外へ） */
function rowCells(row: number, w: number, from = 0, to = Infinity): Cell[] {
  const out: Cell[] = [];
  colPairs(w).forEach((p, i) => {
    if (i < from || i >= to) return;
    for (const x of p) out.push({ cx: x, cy: row });
  });
  return out;
}

/** 本陣の隣の、本陣と左右対称になるマス（偶数の幅だけ）。奇数で組の片方が余った部隊の置き場所 */
type Mate = Cell | null;

/**
 * cells（左右の組が順に並んだもの）の先頭から n 個を選ぶ。最後の組の片方だけが余るときは、その1個を mate へ回す（mate が使えれば）。
 * used は、すでに使ったマス（mate を2回使わないため）。
 */
function takeSym(cells: Cell[], n: number, mate: Mate, used: Set<string>): Cell[] {
  const out = cells.slice(0, n);
  // 足りない分は最後のマスを繰り返す（applyTemplate がいちばん近い空きマスへずらす）
  while (out.length < n) out.push((cells[cells.length - 1] ?? { cx: 0, cy: 0 }) as Cell);
  if (n % 2 === 1 && mate && n <= cells.length) {
    const last = out[out.length - 1] as Cell;
    const partner = cells[n];
    // 最後の1個が組の左側で、組の右側（次のマス）が同じ行にあるとき＝組が割れたとき
    if (partner && partner.cy === last.cy && !used.has(`${mate.cx},${mate.cy}`)) {
      out[out.length - 1] = mate;
      used.add(`${mate.cx},${mate.cy}`);
    }
  }
  return out;
}

type Layout = (c: Counts, w: number, h: number, mate: Mate) => Want[];

/** 中央の組 p の、行 y のマス（無いときは空） */
function pairAt(w: number, p: number, y: number): Cell[] {
  const pr = colPairs(w)[p];
  return pr ? pr.map((x) => ({ cx: x, cy: y })) : [];
}

/** 横陣：前列に歩兵（中央）と盾兵（外側）、後列に弓兵、両端に騎兵。あふれた前列の部隊は、後列の、前列の両端のすぐ後ろから外へ */
const line: Layout = (c, w) => {
  const wants: Want[] = [];
  const used = new Set<string>();
  const front = [...repeat('infantry', c.infantry), ...repeat('shield', c.shield)];
  // 前列は、騎兵がいれば幅 - 4（8列なら4。両端に騎兵が並ぶ分と、1列ずつの余白を空ける）、いなければ幅 - 2（6）
  // 幅 7 以下（狭い面）は、騎兵がいれば幅 - 2、いなければ幅いっぱい
  const cap = Math.min(w, Math.max(2, w >= 8 ? (c.cavalry > 0 ? w - 4 : w - 2) : c.cavalry > 0 ? w - 2 : w));
  const nFront = Math.min(cap, front.length);
  const frontCells = takeSym(rowCells(0, w), nFront, null, used);
  // 中央から外へ並んだマスに、歩兵を内側、盾兵を外側
  frontCells.forEach((q, i) => wants.push({ kind: front[i] as Kind, stance: 'advance', ...q }));
  const xs = frontCells.map((q) => q.cx);
  let minX = xs.length ? Math.min(...xs) : centerCol(w);
  let maxX = xs.length ? Math.max(...xs) : centerCol(w);
  for (let i = 0; i < c.cavalry; i++) {
    // 左右交互に、列の外側へ
    if (i % 2 === 0) wants.push({ kind: 'cavalry', stance: 'flank', cx: --minX, cy: 0 });
    else wants.push({ kind: 'cavalry', stance: 'flank', cx: ++maxX, cy: 0 });
  }
  takeSym([...rowCells(1, w), ...rowCells(2, w)], c.archer, null, used).forEach((q) => wants.push({ kind: 'archer', stance: 'advance', ...q }));
  // あふれた前列の部隊：前列の端の組の後ろから外へ（回り込んでくる敵を受ける）
  const edge = Math.max(0, Math.ceil(nFront / (w % 2 === 0 ? 2 : 1)) - 1);
  const over = [...rowCells(1, w, edge), ...rowCells(1, w, 0, edge)];
  front.slice(nFront).forEach((k, i) => wants.push({ kind: k, stance: 'advance', ...(over[i] ?? { cx: centerCol(w), cy: 2 }) }));
  return wants;
};

/**
 * 鶴翼：V 字。中央（盾兵。守備）が下がり、両翼（歩兵。前進）が前に張り出す。左右の翼は同じ数にする。
 * 中央は中央の行（2 行目）。翼は中央の外の列から外へ、外ほど前（いちばん外の翼の先が 0 行目）。
 * 騎兵（迂回）は2騎ずつ、翼の後ろ（1 行目のいちばん外から内へ）。弓兵（守備）は中央の後ろ。
 * 組にならない歩兵1つ・騎兵1騎は、中央の後ろ（本陣と左右対称のマス）、それも埋まれば中央の脇。
 * 歩兵と騎兵がどちらも奇数のときは、その2つを左右の翼の組（左に歩兵・右に騎兵）にする。
 */
const crane: Layout = (c, w, h, mate) => {
  const wants: Want[] = [];
  const used = new Set<string>();
  const cRow = Math.min(h - 2, 2);
  if (mate) used.add(`${w - 1 - mate.cx},${mate.cy}`);
  const wSt: Stance = 'advance';
  const cSt: Stance = 'hold';
  const aSt: Stance = 'hold';
  const cavSt: Stance = 'flank';
  const pairs = colPairs(w);
  // 中央：盾兵が2より少なければ歩兵で埋める
  const nCenter = Math.max(c.shield, Math.min(2, c.shield + c.infantry));
  const centerKinds: Kind[] = [...repeat('shield', c.shield), ...repeat('infantry', Math.max(0, nCenter - c.shield))];
  const wingInf = c.infantry - (nCenter - c.shield);
  // 中央のマス：cRow の中央の組から外へ、次に cRow+1 の中央の組
  const centerCells = takeSym([...rowCells(cRow, w, 0, 2), ...rowCells(cRow + 1, w, 0, 1)], nCenter, mate, used);
  centerCells.forEach((q, i) => wants.push({ kind: centerKinds[i] as Kind, stance: cSt, ...q }));
  const cMin = Math.min(...centerCells.map((q) => q.cx), pairs[0]?.[0] ?? 0);
  const cMax = Math.max(...centerCells.map((q) => q.cx), pairs[0]?.[pairs[0].length - 1] ?? 0);
  // 翼の組：歩兵の組、奇数の歩兵と奇数の騎兵の組（左に歩兵・右に騎兵）
  const wingPairs: [Want, Want][] = [];
  const iw = (): Want => ({ kind: 'infantry', stance: wSt, cx: 0, cy: 0 });
  const cw = (): Want => ({ kind: 'cavalry', stance: cavSt, cx: 0, cy: 0 });
  for (let i = 0; i + 1 < wingInf; i += 2) wingPairs.push([iw(), iw()]);
  const extra: Kind[] = [];
  let cavLeft = c.cavalry;
  const backCav: [Want, Want][] = [];
  if (wingInf % 2 === 1) {
    if (cavLeft % 2 === 1) {
      wingPairs.push([iw(), cw()]);
      cavLeft--;
    } else extra.push('infantry');
  }
  for (; cavLeft >= 2; cavLeft -= 2) backCav.push([cw(), cw()]);
  if (cavLeft === 1) extra.push('cavalry');
  // 翼のマス（左。右は鏡）：中央の外の列から外へ、内へ1つごとに1行後ろ（cRow-1 から 0 へ）。そのあとは 1 行目
  const wingCells = (dir: -1 | 1, start: number): Cell[] => {
    const out: Cell[] = [];
    let k = 0;
    for (let x = start + dir; x >= 0 && x < w; x += dir, k++) out.push({ cx: x, cy: Math.max(0, cRow - 1 - k) });
    for (let x = dir < 0 ? 0 : w - 1; dir < 0 ? x <= start : x >= start; x -= dir) out.push({ cx: x, cy: 1 });
    return out;
  };
  const L = wingCells(-1, cMin);
  const R = wingCells(1, cMax);
  let li = 0;
  let ri = 0;
  for (const [l, r] of wingPairs) {
    wants.push({ ...l, ...(L[li++] ?? { cx: 0, cy: 1 }) });
    wants.push({ ...r, ...(R[ri++] ?? { cx: w - 1, cy: 1 }) });
  }
  // 翼の後ろの騎兵（1 行目のいちばん外から内へ）
  backCav.forEach(([l, r], i) => {
    wants.push({ ...l, cx: i, cy: 1 });
    wants.push({ ...r, cx: w - 1 - i, cy: 1 });
  });
  // 弓兵：中央の後ろ（cRow+1 から）
  const archCells = [...rowCells(cRow + 1, w), ...rowCells(cRow + 2, w)];
  takeSym(archCells.filter((q) => !used.has(`${q.cx},${q.cy}`)), c.archer, mate, used).forEach((q) => wants.push({ kind: 'archer', stance: aSt, ...q }));
  // 余り（奇数の歩兵・騎兵）は中央の後ろ・本陣の隣
  const extraCells: Cell[] = [...(mate ? [mate] : []), ...rowCells(cRow + 1, w, 0, 2)].filter((q) => !used.has(`${q.cx},${q.cy}`));
  extra.forEach((k, i) => wants.push({ kind: k, stance: k === 'cavalry' ? cavSt : wSt, ...(extraCells[i] ?? { cx: centerCol(w), cy: h - 1 }) }));
  return wants;
};

/**
 * 魚鱗：先がとがった三角形（幅 2・4・6・8 の行）。三角形の輪郭（各行の外の組）から先に埋め、そのあと内側を埋める（少ない数でも裾が広い）。
 * 埋めたマスのうち、前の中央から歩兵・盾兵・弓兵（前進）。騎兵は、いちばん後ろの外のマス（後ろの両脇。前進）。
 */
const scale: Layout = (c, w, h) => {
  const wants: Want[] = [];
  const pairs = colPairs(w).length;
  const tri: Cell[] = [];
  for (let r = 0; r < h; r++) {
    const n = Math.min(pairs, r + 1);
    for (let p = n - 1; p >= 0; p--) tri.push(...pairAt(w, p, r));
  }
  const total = c.infantry + c.shield + c.archer + c.cavalry;
  const cells = tri.slice(0, total);
  while (cells.length < total) cells.push({ cx: 0, cy: h - 1 });
  const mid = (w - 1) / 2;
  const back = cells.slice().sort((a, b) => b.cy - a.cy || Math.abs(b.cx - mid) - Math.abs(a.cx - mid) || a.cx - b.cx);
  const cavCells = back.slice(0, c.cavalry);
  const rest = cells.filter((q) => !cavCells.includes(q)).sort((a, b) => a.cy - b.cy || Math.abs(a.cx - mid) - Math.abs(b.cx - mid) || a.cx - b.cx);
  for (const q of cavCells) wants.push({ kind: 'cavalry', stance: 'advance', ...q });
  const body = [...repeat('infantry', c.infantry), ...repeat('shield', c.shield), ...repeat('archer', c.archer)];
  body.forEach((k, i) => wants.push({ kind: k, stance: 'advance', ...(rest[i] as Cell) }));
  return wants;
};

/**
 * 鋒矢：矢じり（先頭の中央の組に歩兵、そのすぐ後ろの行の外の組＝返し）、軸（中央の組を後ろへ）に歩兵・盾兵（前進）、弓兵は軸の後ろ。
 * 返しは騎兵（1騎目が本陣狙い、ほかは迂回）。騎兵が2騎に満たなければ、歩兵・盾兵・弓兵の順で返しを埋める（どの数でも矢じりの形にする）。
 * 軸に入りきらない分は、いちばん後ろの行の外の組（矢羽根）。部隊が奇数で組が割れるときは、本陣の隣へ。
 */
const arrow: Layout = (c, w, h, mate) => {
  const wants: Want[] = [];
  const used = new Set<string>();
  const tipInf = Math.min(2, c.infantry);
  const pool: Kind[] = [...repeat('infantry', c.infantry - tipInf), ...repeat('shield', c.shield), ...repeat('archer', c.archer)];
  const nbCav = Math.min(2, c.cavalry);
  const barbKinds: Kind[] = repeat('cavalry', nbCav);
  // 返しを埋める（軸の兵種の前から）。全部で 4 部隊に満たないときは返しを作らない
  while (barbKinds.length < 2 && pool.length > 0 && tipInf + barbKinds.length + pool.length >= 3) barbKinds.push(pool.shift() as Kind);
  const seq: Kind[] = [...repeat('infantry', tipInf), ...barbKinds, ...repeat('cavalry', c.cavalry - nbCav), ...pool];
  // マス：矢じり（中央の組の 0 行）→ 返し（外の組の 1 行）→ 軸（中央の組の 1 行から後ろへ。最後の行は本陣の隣だけ）→ 矢羽根 → さらに外
  // 軸は 2 行目を 1 行目より先に埋める（少ない数でも、矢じりの後ろに柄が見える。魚鱗の2段と区別する）
  const cells: Cell[] = [...pairAt(w, 0, 0), ...pairAt(w, 1, 1)];
  for (const r of [2, 1]) if (r < h - 1) cells.push(...pairAt(w, 0, r));
  for (let r = 3; r < h - 1; r++) cells.push(...pairAt(w, 0, r));
  cells.push(...pairAt(w, 1, h - 1), ...pairAt(w, 1, h - 2));
  for (let r = 1; r < h; r++) cells.push(...rowCells(r, w, 2));
  const raw = takeSym(cells, seq.length, mate, used);
  // 矢じりと返しのあとは、前の行から兵種を置く（歩兵・盾兵が前、弓兵が後ろ）
  const head = tipInf + barbKinds.length;
  const mid = (w - 1) / 2;
  const picked = [...raw.slice(0, head), ...raw.slice(head).sort((p, q) => p.cy - q.cy || Math.abs(p.cx - mid) - Math.abs(q.cx - mid) || p.cx - q.cx)];
  let firstCav = true;
  seq.forEach((k, i) => {
    let stance: Stance = 'advance';
    if (k === 'cavalry') { stance = firstCav ? 'hunt' : 'flank'; firstCav = false; }
    wants.push({ kind: k, stance, ...(picked[i] ?? { cx: 0, cy: h - 1 }) });
  });
  return wants;
};

/**
 * 方円：本陣を囲む輪。幅 6・奥行き 4 の輪（8列なら 1〜6 列）の上に、前の組・横・後ろの組…と左右の組ずつ散らして、盾兵（前から）と歩兵を置く。
 * 本陣のまわりの 2×2 に弓兵と騎兵。輪の上が6つに満たなければ、弓兵・騎兵も輪へ出す。すべて守備。
 */
const ring: Layout = (c, w, h) => {
  const wants: Want[] = [];
  const hc = ringHq(w, h);
  const x0 = hc.cx; // 中央の 2 列：x0, x0 + 1
  const y0 = hc.cy - 1; // 中央の 2 行：y0, y0 + 1
  const L = x0 - 2;
  const R = x0 + 3;
  const top = y0 - 1;
  const bot = y0 + 2;
  const inner: Cell[] = [
    { cx: x0, cy: y0 },
    { cx: x0 + 1, cy: y0 },
    { cx: x0 + 1, cy: y0 + 1 },
  ];
  const loopPairs: Cell[][] = [
    [{ cx: x0, cy: top }, { cx: x0 + 1, cy: top }],
    [{ cx: L, cy: y0 }, { cx: R, cy: y0 }],
    [{ cx: x0, cy: bot }, { cx: x0 + 1, cy: bot }],
    [{ cx: L, cy: y0 + 1 }, { cx: R, cy: y0 + 1 }],
    [{ cx: x0 - 1, cy: top }, { cx: x0 + 2, cy: top }],
    [{ cx: x0 - 1, cy: bot }, { cx: x0 + 2, cy: bot }],
    [{ cx: L, cy: top }, { cx: R, cy: top }],
    [{ cx: L, cy: bot }, { cx: R, cy: bot }],
    // 輪と中央のあいだ（あふれたとき）
    [{ cx: x0 - 1, cy: y0 }, { cx: x0 + 2, cy: y0 }],
    [{ cx: x0 - 1, cy: y0 + 1 }, { cx: x0 + 2, cy: y0 + 1 }],
  ];
  const loop = loopPairs.flat();
  const ins: Kind[] = [...repeat('archer', c.archer), ...repeat('cavalry', c.cavalry)];
  const outs: Kind[] = [...repeat('shield', c.shield), ...repeat('infantry', c.infantry)];
  // 輪の上は、少なくとも 6（3組）。足りなければ内側の兵種を輪へ出す
  while (outs.length < 6 && ins.length > 0) outs.push(ins.pop() as Kind);
  while (ins.length > inner.length) outs.push(ins.pop() as Kind);
  ins.forEach((k, i) => wants.push({ kind: k, stance: 'hold', ...(inner[i] as Cell) }));
  // 輪の数が奇数のときは、最後の1個を、空いた内側のマスへ（輪の形を左右対称に保つ）
  const freeInner = inner.slice(ins.length);
  outs.forEach((k, i) => {
    let p = loop[i] ?? { cx: x0, cy: h - 1 };
    if (i === outs.length - 1 && outs.length % 2 === 1 && outs.length <= loop.length) {
      // 輪の後ろの組がまだ空なら本陣のすぐ後ろ（本陣の後ろを空けない）、埋まっていれば空いた内側のマス
      if (outs.length < 6 && bot < h) p = { cx: x0, cy: bot };
      else if (freeInner.length > 0) p = freeInner[0] as Cell;
    }
    wants.push({ kind: k, stance: 'hold', ...p });
  });
  return wants;
};

/**
 * 偃月：弓なり。中央の組が前（0 行目）、外の組ほど1行ずつ後ろへ下がる。弧に歩兵と騎兵（前進）、両翼（弧の外のほう）に盾兵（守備）。
 * 弓兵は、弧の中央のさらに2行後ろ（弧の内側の奥）。弧に入りきらない部隊も、そこから外へ。
 */
const crescent: Layout = (c, w, h, mate) => {
  const wants: Want[] = [];
  const used = new Set<string>();
  const pairs = colPairs(w);
  const arcRow = (p: number): number => Math.min(h - 1, p === 0 ? 0 : p === 1 ? 1 : Math.max(1, p - 1));
  const arcCells: Cell[] = [];
  // 弧は中央の組のあと、いちばん外の組（両翼の端）を先に埋める（少ない数でも、両翼まで届いた弓なりに見える）
  const arcOrder = pairs.length > 2 ? [0, pairs.length - 1, ...pairs.map((_, p) => p).slice(1, -1)] : pairs.map((_, p) => p);
  for (const p of arcOrder) arcCells.push(...pairAt(w, p, arcRow(p)));
  const arc = [...repeat('infantry', c.infantry), ...repeat('cavalry', c.cavalry), ...repeat('shield', c.shield)];
  const nArc = Math.min(arc.length, arcCells.length);
  takeSym(arcCells, nArc, null, used)
    .sort((a, b) => Math.abs(a.cx - (w - 1) / 2) - Math.abs(b.cx - (w - 1) / 2) || a.cx - b.cx)
    .forEach((q, i) => {
    const k = arc[i] as Kind;
    wants.push({ kind: k, stance: k === 'shield' ? 'hold' : 'advance', ...q });
  });
  // 弧の内側の奥：中央の組の 2 行目、その外の組の 3 行目、…（弧の 2 行後ろ）、それでも足りなければ弧の 1 行後ろ
  const back: Cell[] = [];
  // 弧の 1 行後ろ（中央の組を除き、内から外へ）→ 中央の組の 2 行後ろ → 中央の組の 1 行後ろ → さらに後ろ
  for (let p = 1; p < pairs.length; p++) if (arcRow(p) + 1 < h) back.push(...pairAt(w, p, arcRow(p) + 1));
  for (const d of [2, 1, 3]) if (d < h) back.push(...pairAt(w, 0, d));
  for (let p = 1; p < pairs.length; p++) if (arcRow(p) + 2 < h) back.push(...pairAt(w, p, arcRow(p) + 2));
  const rest = [...arc.slice(nArc), ...repeat('archer', c.archer)];
  takeSym(back, rest.length, mate, used).forEach((q, i) => {
    const k = rest[i] as Kind;
    wants.push({ kind: k, stance: k === 'shield' ? 'hold' : 'advance', ...q });
  });
  return wants;
};

/**
 * 雁行：右前から左後ろへの斜めの段々（1段は横2マス、段ごとに左へ2列・後ろへ1行）。前の段から歩兵・盾兵（前進）、弓兵（守備）。
 * 騎兵（迂回）は前に出た側（右）の端の列。入りきらない部隊は、段のすぐ後ろ。
 */
const echelon: Layout = (c, w, h) => {
  const wants: Want[] = [];
  const diag: Cell[] = [];
  for (let s = 0; s < h; s++) {
    for (const off of [2, 3]) {
      const x = w - off - 2 * s;
      if (x >= 0) diag.push({ cx: x, cy: s });
    }
  }
  const second = diag.map((p) => ({ cx: p.cx, cy: p.cy + 1 })).filter((p) => p.cy < h);
  const cells = [...diag, ...second];
  const body = [...repeat('infantry', c.infantry), ...repeat('shield', c.shield), ...repeat('archer', c.archer)];
  const st = (k: Kind): Stance => (k === 'archer' ? 'hold' : 'advance');
  body.forEach((k, i) => {
    const p = cells[i] ?? { cx: 0, cy: h - 1 };
    wants.push({ kind: k, stance: st(k), cx: p.cx, cy: p.cy });
  });
  for (let k = 0; k < c.cavalry; k++) wants.push({ kind: 'cavalry', stance: 'flank', cx: w - 1, cy: k });
  return wants;
};

const LAYOUTS: Record<TemplateId, Layout> = { line, crane, scale, arrow, ring, crescent, echelon };

/** 方円の本陣：中央の 2×2 の、左下（8列×4行なら (3, 2)） */
function ringHq(w: number, h: number): Cell {
  return { cx: centerCol(w), cy: Math.max(0, Math.min(h - 2, 2)) };
}

/** 本陣の置き場所（いちばん後ろの行の中央。横陣も同じ。方円は輪の中心） */
function hqCell(id: TemplateId, w: number, h: number): Cell {
  if (id === 'ring') return ringHq(w, h);
  return { cx: centerCol(w), cy: h - 1 };
}

/**
 * ひな形を手持ちに当てはめる。未知の id のときは空の配列を返す。
 * 置けるマスより部隊が多いときは、置けるところまで置く（validateArmy で弾かれる）。
 */
export function applyTemplate(id: TemplateId, roster: Roster, zone: Zone, side: Side): Placement[] {
  // どんな値が来ても例外を投げない。知らない id（'constructor' などの継いだ鍵を含む）・正しくないエリアや陣営は空の配列
  if (typeof id !== 'string' || !Object.hasOwn(LAYOUTS, id)) return [];
  const layout = LAYOUTS[id];
  if (!isObject(zone) || !isInt(zone.col) || !isInt(zone.row) || !isInt(zone.width) || !isInt(zone.height)) return [];
  if (zone.width < 1 || zone.height < 1 || zone.width > MAX_FIELD_SIDE || zone.height > MAX_FIELD_SIDE) return [];
  if (side !== 0 && side !== 1) return [];
  const w = zone.width;
  const h = zone.height;
  const c = counts(isObject(roster) ? roster : {});
  const taken = new Set<number>();
  const local: Want[] = [];
  const key = (x: number, y: number): number => y * w + x;

  const place = (want: Want): void => {
    let { cx, cy } = want;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h || taken.has(key(cx, cy))) {
      // いちばん近い空きマス。同じ近さなら後ろ（cy が大きい）、それも同じなら左
      let best: { cx: number; cy: number } | null = null;
      let bestD = Infinity;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (taken.has(key(x, y))) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2;
          if (d < bestD || (d === bestD && best && (y > best.cy || (y === best.cy && x < best.cx)))) {
            best = { cx: x, cy: y };
            bestD = d;
          }
        }
      }
      if (!best) return;
      cx = best.cx;
      cy = best.cy;
    }
    taken.add(key(cx, cy));
    local.push({ ...want, cx, cy });
  };

  const hc = hqCell(id, w, h);
  if (c.hq > 0) for (let i = 0; i < c.hq; i++) place({ kind: 'hq', stance: 'hold', cx: hc.cx, cy: hc.cy });
  // 本陣と左右対称になるマス（偶数の幅で、本陣がいるときだけ）
  const mate: Mate = c.hq > 0 && w % 2 === 0 && id !== 'ring' ? { cx: w - 1 - hc.cx, cy: hc.cy } : null;
  for (const want of layout(c, w, h, mate)) place(want);

  // 自軍から見た座標 → 戦場の座標。陣営0は前が上（row が小さい）、陣営1は前が下で左右も逆。
  return local.map((p) => ({
    kind: p.kind,
    stance: p.stance,
    col: side === 0 ? zone.col + p.cx : zone.col + (w - 1 - p.cx),
    row: side === 0 ? zone.row + p.cy : zone.row + (h - 1 - p.cy),
  }));
}
