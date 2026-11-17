// ひな形（design §3.7）。手持ちと配置エリアから、配置と方針を返す。
// 形は「自軍から見た」座標（cx: 自分から見て左が 0、cy: 敵に近い前の行が 0）で組み立て、最後に戦場の座標へ写す。
// 組み立てた先が埋まっている・エリアの外のときは、いちばん近い空きマスへずらすので、6〜16 部隊のどの手持ちでも
// エリアに収まり、重ならず、全部隊を使い切る。乱数は使わないので、同じ入力からはいつも同じ配置になる。

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

function counts(roster: Roster): Counts {
  const n = (k: Kind): number => {
    const v = roster[k] ?? 0;
    // 部隊数の上限を超える数は、上限で切る（巨大な数で時間を使わないため）
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_UNITS, Math.max(0, Math.floor(v))) : 0;
  };
  return { infantry: n('infantry'), shield: n('shield'), cavalry: n('cavalry'), archer: n('archer'), hq: n('hq') };
}

/** 列を中央から外へ並べた順（12列なら 5,6,4,7,3,8,...）。左を先にする */
function centerOut(width: number): number[] {
  const out: number[] = [];
  const c = (width - 1) / 2;
  const cols = Array.from({ length: width }, (_, i) => i);
  cols.sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b);
  for (const x of cols) out.push(x);
  return out;
}

function centerCol(width: number): number {
  return Math.floor((width - 1) / 2);
}

function repeat(kind: Kind, n: number): Kind[] {
  return new Array<Kind>(n).fill(kind);
}

type Layout = (c: Counts, w: number, h: number) => Want[];

/** n 部隊を、行 row から中央から外へ並べる。1行に収まらなければ、後ろの行へ続ける */
function rowsFrom(n: number, row: number, w: number): { cx: number; cy: number }[] {
  const order = centerOut(w);
  return Array.from({ length: n }, (_, i) => ({ cx: order[i % w] as number, cy: row + Math.floor(i / w) }));
}

/** 横陣：前列に歩兵（中央）と盾兵（外側）、後列に弓兵、両端に騎兵。あふれた前列の部隊は、後列の両端の後ろへ */
const line: Layout = (c, w, h) => {
  const wants: Want[] = [];
  const order = centerOut(w);
  const front = [...repeat('infantry', c.infantry), ...repeat('shield', c.shield)];
  // 前列は、騎兵がいれば幅 - 5（12列なら7。両端に騎兵が並ぶ分を空ける）、いなければ幅 - 4（8）。
  // あふれた分は後列の両端の後ろに置き、列の端の後ろを守らせる
  const cap = Math.max(1, c.cavalry > 0 ? w - 5 : w - 4);
  const frontRow = front.slice(0, cap);
  const overflow = front.slice(cap);
  const frontXs = order.slice(0, frontRow.length);
  frontRow.forEach((k, i) => wants.push({ kind: k, stance: 'advance', cx: frontXs[i] as number, cy: 0 }));
  let minX = frontXs.length ? Math.min(...frontXs) : centerCol(w);
  let maxX = frontXs.length ? Math.max(...frontXs) : centerCol(w);
  for (let i = 0; i < c.cavalry; i++) {
    // 左右交互に、列の外側へ
    if (i % 2 === 0) wants.push({ kind: 'cavalry', stance: 'flank', cx: --minX, cy: 0 });
    else wants.push({ kind: 'cavalry', stance: 'flank', cx: ++maxX, cy: 0 });
  }
  rowsFrom(c.archer, 1, w).forEach((q) => wants.push({ kind: 'archer', stance: 'advance', ...q }));
  // あふれた前列の部隊は、前列の両端のすぐ後ろから内へ（左右交互）。回り込んでくる敵を受ける
  const fMin = frontXs.length ? Math.min(...frontXs) : centerCol(w);
  const fMax = frontXs.length ? Math.max(...frontXs) : centerCol(w);
  overflow.forEach((k, i) => {
    const step = Math.floor(i / 2);
    wants.push({ kind: k, stance: 'advance', cx: i % 2 === 0 ? fMin + step : fMax - step, cy: 1 });
  });
  void h;
  return wants;
};

/**
 * 鶴翼：中央に盾兵（守備）と弓兵（守備。盾の陰から撃つ）、両翼に歩兵（前進）が前へ張り出し、翼の先に騎兵（迂回）。
 * 弓兵は 2026-11-17 に前進から守備に替えた（design §3.6.6）。前進のままだと、守備の味方の並びを回り込む決まりで弓兵が戦いに加わり、
 * 鶴翼の得点率が 0.47 → 0.76 に上がって、方円がほかの6つすべてに負け（A7）、総当たりで時間切れが出なくなる（A9）。
 * 守備にすると鶴翼は 0.48 で、数字を変えずに A6・A7・A9・A11 と対戦用の戦場の釣り合いが通る
 */
const crane: Layout = (c, w) => {
  const wants: Want[] = [];
  const order = centerOut(w);
  const sx = order.slice(0, Math.min(c.shield, w));
  rowsFrom(c.shield, 2, w).forEach((q) => wants.push({ kind: 'shield', stance: 'hold', ...q }));
  rowsFrom(c.archer, 3, w).forEach((q) => wants.push({ kind: 'archer', stance: 'hold', ...q }));
  const cc = centerCol(w);
  const sMin = sx.length ? Math.min(...sx) : cc + 1;
  const sMax = sx.length ? Math.max(...sx) : cc;
  const leftInf = Math.ceil(c.infantry / 2);
  const rightInf = c.infantry - leftInf;
  const rightCav = Math.ceil(c.cavalry / 2);
  const leftCav = c.cavalry - rightCav;
  // 翼は、盾兵の外側から外へ1列ずつ、前（cy が小さいほう）へせり出す
  const wing = (dir: -1 | 1, inf: number, cav: number, start: number): void => {
    let k = 0;
    for (let i = 0; i < inf; i++, k++) wants.push({ kind: 'infantry', stance: 'advance', cx: start + dir * (k + 1), cy: Math.max(0, 1 - k) });
    for (let i = 0; i < cav; i++, k++) wants.push({ kind: 'cavalry', stance: 'flank', cx: start + dir * (k + 1), cy: Math.max(0, 1 - k) });
  };
  wing(-1, leftInf, leftCav, sMin);
  wing(1, rightInf, rightCav, sMax);
  return wants;
};

/** 魚鱗：先に歩兵、中に盾兵、後ろに弓兵の三角形。騎兵は後ろの両脇（前進） */
const scale: Layout = (c, w, h) => {
  const wants: Want[] = [];
  const order = centerOut(w);
  const body = [...repeat('infantry', c.infantry), ...repeat('shield', c.shield), ...repeat('archer', c.archer)];
  let i = 0;
  let row = 0;
  let lastRow = 0;
  let rowMin = centerCol(w);
  let rowMax = centerCol(w);
  while (i < body.length && row < h) {
    const width = Math.min(w, 2 * row + 2);
    const xs = order.slice(0, width);
    for (const x of xs) {
      if (i >= body.length) break;
      wants.push({ kind: body[i] as Kind, stance: 'advance', cx: x, cy: row });
      i++;
    }
    lastRow = row;
    rowMin = Math.min(...xs);
    rowMax = Math.max(...xs);
    row++;
  }
  for (let k = 0; k < c.cavalry; k++) {
    const r = Math.min(h - 1, lastRow + Math.floor(k / 2));
    const off = Math.floor(k / 2);
    wants.push({ kind: 'cavalry', stance: 'advance', cx: k % 2 === 0 ? rowMin - 1 - off : rowMax + 1 + off, cy: r });
  }
  return wants;
};

/** 鋒矢：矢じりに歩兵（前進）、そのすぐ後ろに騎兵（1騎は本陣狙い、残りは迂回）、軸に盾兵（前進）、弓兵は後ろ */
const arrow: Layout = (c, w, h) => {
  const wants: Want[] = [];
  const order = centerOut(w);
  // 矢じり：先頭の2マスに歩兵、その次の行に残りの歩兵。騎兵（本陣狙い）は、矢じりのすぐ後ろ（4行目）の、中央の2列の両脇。
  // 騎兵を矢じりの横に並べると、先頭の歩兵と敵の列のあいだに挟まって滑れず、詰まって戦うことになるため、後ろに控えさせる
  const tipInf = Math.min(2, c.infantry);
  const cav: { cx: number; cy: number }[] = order.slice(2, 6).map((x) => ({ cx: x, cy: 3 }));
  const tip = order.slice(0, 2).map((x) => ({ cx: x, cy: 0 }));
  const rest: Kind[] = [];
  for (let i = 0; i < tipInf; i++) wants.push({ kind: 'infantry', stance: 'advance', ...(tip[i] as { cx: number; cy: number }) });
  for (let i = 0; i < c.cavalry; i++) {
    const q = i < cav.length ? (cav[i] as { cx: number; cy: number }) : i - cav.length < 2 - tipInf ? (tip[tipInf + i - cav.length] as { cx: number; cy: number }) : { cx: order[i % w] as number, cy: 2 };
    // 1騎目は本陣狙い、ほかは迂回（全部が本陣狙いだと、矢じりの後ろで列に詰まって戦い、溶けるため）
    wants.push({ kind: 'cavalry', stance: i === 0 ? 'hunt' : 'flank', ...q });
  }
  const innerRow = order.slice(0, 2).map((x) => ({ cx: x, cy: 1 }));
  for (let i = 0; i < c.infantry - tipInf; i++) {
    if (i < innerRow.length) wants.push({ kind: 'infantry', stance: 'advance', ...(innerRow[i] as { cx: number; cy: number }) });
    else rest.push('infantry');
  }
  // 軸：中央の2列を後ろへ。足りなければその外の列
  const shaft: { cx: number; cy: number }[] = [];
  const cc = centerCol(w);
  for (let y = 2; y < h; y++) for (const x of order.slice(0, 2)) if (!(y === h - 1 && x === cc)) shaft.push({ cx: x, cy: y });
  for (let y = 2; y < h; y++) for (const x of order.slice(2, 4)) shaft.push({ cx: x, cy: y });
  const shaftKinds: Kind[] = [...rest, ...repeat('shield', c.shield), ...repeat('archer', c.archer)];
  shaftKinds.forEach((k, i) => {
    const p = shaft[i] ?? { cx: cc, cy: h - 1 };
    wants.push({ kind: k, stance: k === 'cavalry' ? 'hunt' : 'advance', cx: p.cx, cy: p.cy });
  });
  return wants;
};

/** 輪のマス（中心から、チェビシェフ距離 r）を、前の中央から時計回りに並べる */
function ringCells(cx: number, cy: number, r: number): { cx: number; cy: number }[] {
  const cells: { cx: number; cy: number; a: number }[] = [];
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
      // 前（cy が小さいほう）を 0 として時計回りの角度
      let a = Math.atan2(x - cx, -(y - cy));
      if (a < 0) a += 2 * Math.PI;
      cells.push({ cx: x, cy: y, a });
    }
  }
  cells.sort((p, q) => p.a - q.a || p.cx - q.cx);
  return cells.map(({ cx: x, cy: y }) => ({ cx: x, cy: y }));
}

/** 輪の上に n 個を、なるべく等しい間隔で選ぶ（前の中央から） */
function spreadOnRing(cells: { cx: number; cy: number }[], n: number): { cx: number; cy: number }[] {
  if (n >= cells.length) return cells.slice();
  const out: { cx: number; cy: number }[] = [];
  for (let k = 0; k < n; k++) out.push(cells[Math.floor((k * cells.length) / n)] as { cx: number; cy: number });
  return out;
}

/** 方円：本陣を囲む輪。外側に盾兵と歩兵、内側に弓兵、騎兵は輪の中。すべて守備 */
const ring: Layout = (c, w, h) => {
  const wants: Want[] = [];
  const hx = centerCol(w);
  const hy = Math.min(h - 1, 2);
  const inner = ringCells(hx, hy, 1);
  const outer = ringCells(hx, hy, 2);
  const innerKinds: Kind[] = [...repeat('archer', c.archer), ...repeat('cavalry', c.cavalry)];
  const innerUse = innerKinds.slice(0, inner.length);
  const outerKinds: Kind[] = [...repeat('shield', c.shield), ...repeat('infantry', c.infantry), ...innerKinds.slice(inner.length)];
  const ic = spreadOnRing(inner, innerUse.length);
  innerUse.forEach((k, i) => wants.push({ kind: k, stance: 'hold', ...(ic[i] as { cx: number; cy: number }) }));
  // 外側の輪：選んだマスのうち前に近いものから盾兵を置く
  const oc = spreadOnRing(outer, Math.min(outerKinds.length, outer.length));
  const ocSorted = oc.slice().sort((p, q) => p.cy - q.cy || Math.abs(p.cx - hx) - Math.abs(q.cx - hx) || p.cx - q.cx);
  outerKinds.forEach((k, i) => {
    const p = ocSorted[i] ?? { cx: hx, cy: h - 1 };
    wants.push({ kind: k, stance: 'hold', cx: p.cx, cy: p.cy });
  });
  return wants;
};

/** 偃月：中央の前に歩兵と騎兵（前進）、両翼に盾兵（守備）、弓兵は後ろ */
const crescent: Layout = (c, w) => {
  const wants: Want[] = [];
  const order = centerOut(w);
  const mid = (w - 1) / 2;
  const arcRow = (x: number): number => Math.floor(Math.abs(x - mid) / 2);
  const arc = [...repeat('infantry', c.infantry), ...repeat('cavalry', c.cavalry), ...repeat('shield', c.shield)];
  const front = arc.slice(0, w);
  const extra = arc.slice(w);
  front.forEach((k, i) => {
    const x = order[i] as number;
    wants.push({ kind: k, stance: k === 'shield' ? 'hold' : 'advance', cx: x, cy: arcRow(x) });
  });
  const back = [...extra, ...repeat('archer', c.archer)];
  back.forEach((k, i) => {
    const x = order[i % w] as number;
    wants.push({ kind: k, stance: k === 'shield' ? 'hold' : 'advance', cx: x, cy: arcRow(x) + 2 + Math.floor(i / w) });
  });
  return wants;
};

/** 雁行：右前から左後ろへの斜めの段々。前の段から歩兵、盾兵、弓兵。騎兵は前に出た側（右）の端（先頭の1騎は本陣狙い、残りは迂回） */
const echelon: Layout = (c, w, h) => {
  const wants: Want[] = [];
  const diag: { cx: number; cy: number }[] = [];
  for (let s = 0; s < h; s++) {
    for (const off of [2, 3]) {
      const x = w - off - 2 * s;
      if (x >= 0) diag.push({ cx: x, cy: s });
    }
  }
  // 足りなければ、各段のすぐ後ろ
  const second = diag.map((p) => ({ cx: p.cx, cy: p.cy + 1 }));
  const cells = [...diag, ...second];
  const body = [...repeat('infantry', c.infantry), ...repeat('shield', c.shield), ...repeat('archer', c.archer)];
  body.forEach((k, i) => {
    const p = cells[i] ?? { cx: 0, cy: h - 1 };
    wants.push({ kind: k, stance: 'advance', cx: p.cx, cy: p.cy });
  });
  // 騎兵：右前の角から、すぐ後ろ・その左へ
  for (let k = 0; k < c.cavalry; k++) {
    // 先頭の1騎は本陣狙い、残りは迂回（雁行が横陣に勝ち、鶴翼に負ける関係にするため）
    if (k === 0) wants.push({ kind: 'cavalry', stance: 'hunt', cx: w - 1, cy: 0 });
    else wants.push({ kind: 'cavalry', stance: 'flank', cx: w - 1 - ((k - 1) % 2), cy: 1 + Math.floor((k - 1) / 2) });
  }
  return wants;
};

const LAYOUTS: Record<TemplateId, Layout> = { line, crane, scale, arrow, ring, crescent, echelon };

/** 本陣の置き場所（後ろの中央。方円は輪の中心） */
function hqCell(id: TemplateId, w: number, h: number): { cx: number; cy: number } {
  if (id === 'ring') return { cx: centerCol(w), cy: Math.min(h - 1, 2) };
  if (id === 'arrow') return { cx: centerCol(w), cy: h - 1 };
  if (id === 'line') return { cx: centerCol(w), cy: Math.min(h - 1, 3) };
  return { cx: centerCol(w), cy: Math.min(h - 1, 4) };
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

  if (c.hq > 0) {
    const hc = hqCell(id, w, h);
    for (let i = 0; i < c.hq; i++) place({ kind: 'hq', stance: 'hold', cx: hc.cx, cy: hc.cy });
  }
  for (const want of layout(c, w, h)) place(want);

  // 自軍から見た座標 → 戦場の座標。陣営0は前が上（row が小さい）、陣営1は前が下で左右も逆。
  return local.map((p) => ({
    kind: p.kind,
    stance: p.stance,
    col: side === 0 ? zone.col + p.cx : zone.col + (w - 1 - p.cx),
    row: side === 0 ? zone.row + p.cy : zone.row + (h - 1 - p.cy),
  }));
}
