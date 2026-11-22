// 配置の画面の「引っぱって置く」操作の計算（design §15.4〜§15.6）。Phaser を読まない関数だけにして、node --test で確かめる。
// 画面（DeployScene）は、押し始め・動かす・離すの出来事と、離した先（マス・手札の欄・遊軍の枠）をここに渡し、
// 返ってきた配置と遊軍をそのまま使う。検査（対戦は validateArmy、一人用は armyErrors）は、画面から関数で受け取る。

import { applyTemplate, defaultStance, type ArmyError, type Field, type Kind, type Placement, type ReserveSetup, type Roster, type Stance, type TemplateId, type Zone } from '@jinkei/engine';

// ---- 押すか、引っぱるか（§15.4） ----

/** 押し始めの場所から、これだけ（内部の px）動いたら「引っぱっている」とみなす（decisions §23） */
export const DRAG_THRESHOLD = 8;
/** 引っぱっている部隊の絵を、指のこれだけ上に出す（指で隠れないように） */
export const DRAG_LIFT = 24;

/** 押し始めの元（カード・盤の部隊・遊軍の枠） */
export type DragSource = { type: 'card'; kind: Kind } | { type: 'unit'; index: number } | { type: 'reserve' };

/**
 * いま「引っぱっている」か。一度引っぱりになったら戻さない（8px を超えてから元の場所へ戻しても、押したにはならない）。
 * 動かす出来事でも、離す出来事の座標でも、同じこの関数で見分ける
 */
export function isDrag(already: boolean, startX: number, startY: number, x: number, y: number): boolean {
  return already || Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD;
}

// ---- 置けるマス・本陣の初めのマス（§15.6） ----

export interface CellPos {
  col: number;
  row: number;
}

export function inZoneCell(zone: Zone, c: CellPos): boolean {
  return c.col >= zone.col && c.col < zone.col + zone.width && c.row >= zone.row && c.row < zone.row + zone.height;
}

/** 部隊を置けるマス：自分のエリアの中で、城壁でない（通り道の列はエリアの外なので置けない） */
export function placeable(field: Field, zone: Zone, c: CellPos): boolean {
  if (!inZoneCell(zone, c)) return false;
  return field.terrain[c.row * field.width + c.col] !== 'wall';
}

/**
 * 本陣の初めのマス。自分のエリアのいちばん後ろの行の中央（幅 8 なら左から 4 つ目）。
 * 置けない・ふさがっているなら、同じ行で近い列（同じ近さなら左）、なければ 1 つ前の行、の順に探す。見つからなければ null
 */
export function hqHomeCell(field: Field, zone: Zone, occupied: readonly CellPos[] = []): CellPos | null {
  const center = zone.col + Math.floor((zone.width - 1) / 2);
  const taken = (c: CellPos): boolean => occupied.some((o) => o.col === c.col && o.row === c.row);
  for (let row = zone.row + zone.height - 1; row >= zone.row; row--) {
    for (let d = 0; d < zone.width; d++) {
      for (const col of d === 0 ? [center] : [center - d, center + d]) {
        const c = { col, row };
        if (placeable(field, zone, c) && !taken(c)) return c;
      }
    }
  }
  return null;
}

/**
 * 配置に本陣がなければ、初めのマス（ふさがっていれば近い空きマス）に足す（本陣を置く前に保存された配置など）。
 * 足したあとに部隊数（盤＋遊軍）が maxUnits を超えるなら、後ろの部隊（本陣以外）を外す
 */
export function ensureHq(list: readonly Placement[], reserve: ReserveSetup | null, field: Field, zone: Zone, maxUnits: number): Placement[] {
  const out = list.map((p) => ({ ...p }));
  if (out.some((p) => p.kind === 'hq')) return out;
  const cell = hqHomeCell(field, zone, out);
  if (!cell) return out;
  out.push({ kind: 'hq', col: cell.col, row: cell.row, stance: defaultStance('hq') });
  while (out.length + (reserve ? 1 : 0) > maxUnits) {
    const i = out.map((p) => p.kind !== 'hq').lastIndexOf(true);
    if (i < 0) break;
    out.splice(i, 1);
  }
  return out;
}

/** 盤に本陣以外の部隊があるか（本陣だけ・本陣＋遊軍だけでは「開戦」「完了」を押せない） */
export function hasNonHq(list: readonly Placement[]): boolean {
  return list.some((p) => p.kind !== 'hq');
}

// ---- 対戦の予算と部隊数（§15.5） ----

export interface PvpLimits {
  budget: number;
  costs: Partial<Record<Kind, number>>;
  /** 通信で届く rules.maxUnits（本陣以外の上限）。数えるときは本陣を含めて +1 と比べる */
  maxUnits: number;
}

/** 使った予算：盤の部隊のコストの合計（本陣は 0）＋遊軍のコスト */
export function budgetUsed(list: readonly Placement[], reserve: ReserveSetup | null, costs: Partial<Record<Kind, number>>): number {
  const cost = (k: Kind): number => (k === 'hq' ? 0 : (costs[k] ?? 0));
  return list.reduce((n, p) => n + cost(p.kind), 0) + (reserve ? cost(reserve.kind) : 0);
}

/** 部隊数：盤の部隊（本陣を含む）＋遊軍 */
export function unitCount(list: readonly Placement[], reserve: ReserveSetup | null): number {
  return list.length + (reserve ? 1 : 0);
}

/** 本陣を含めた部隊数の上限 */
export function unitCap(lim: PvpLimits): number {
  return lim.maxUnits + 1;
}

/** 盤に足しても予算と部隊数に収まるか */
export function canAdd(kind: Kind, list: readonly Placement[], reserve: ReserveSetup | null, lim: PvpLimits): boolean {
  if (kind === 'hq') return false;
  return budgetUsed(list, reserve, lim.costs) + (lim.costs[kind] ?? Infinity) <= lim.budget && unitCount(list, reserve) < unitCap(lim);
}

/** いまの遊軍と入れ替えると予算に収まるか（部隊数は変わらない）。枠が空なら false */
export function canSwapReserve(kind: Kind, list: readonly Placement[], reserve: ReserveSetup | null, lim: PvpLimits, reserveShown: boolean): boolean {
  if (kind === 'hq' || !reserveShown || !reserve) return false;
  const c = lim.costs;
  return budgetUsed(list, reserve, c) - (c[reserve.kind] ?? 0) + (c[kind] ?? Infinity) <= lim.budget;
}

/** 見出しの文字（「予算 16/24 部隊 8/11」）。部隊は本陣を含めて数える */
export function pvpHeadText(list: readonly Placement[], reserve: ReserveSetup | null, lim: PvpLimits): string {
  return `予算 ${budgetUsed(list, reserve, lim.costs)}/${lim.budget} 部隊 ${unitCount(list, reserve)}/${unitCap(lim)}`;
}

// ---- 離した先ごとの結果（§15.4 の表） ----

export type DropTarget = { type: 'cell'; col: number; row: number } | { type: 'hand' } | { type: 'reserve' } | { type: 'none' };

export type DropResult =
  /** 何も起きない（盤の部隊・遊軍なら元へ戻る） */
  | { type: 'none' }
  /** 元のマス（元の枠）へ戻した：変えない。印は金 */
  | { type: 'same' }
  /** 変える */
  | { type: 'apply'; list: Placement[]; reserve: ReserveSetup | null; sound: 'place' | 'remove' };

export interface DropContext {
  list: readonly Placement[];
  reserve: ReserveSetup | null;
  /** 遊軍を使える場面か（使えない場面では、枠そのものを出さない） */
  reserveShown: boolean;
  /** 部隊を置けるマスか（自分のエリアの中で、城壁でない） */
  canPlace: (c: CellPos) => boolean;
  /** その場で選べる方針か（移った先で選べなければ、兵種の初めの値にする） */
  stanceOk: (kind: Kind, stance: Stance) => boolean;
  /** 結果の配置と遊軍の検査（too_few_units は途中の姿なので見ない） */
  check: (list: Placement[], reserve: ReserveSetup | null) => readonly ArmyError[];
  /** チュートリアルなど、その場面で許す操作だけを通す（省略ならすべて） */
  allow?: (src: DragSource, target: DropTarget) => boolean;
}

function fitStance(kind: Kind, stance: Stance, ok: (k: Kind, s: Stance) => boolean): Stance {
  return ok(kind, stance) ? stance : defaultStance(kind);
}

/** 検査の誤りのうち、途中の姿として見ないもの（盤の部隊が足りない）を除いて残るか */
export function blocking(errors: readonly ArmyError[]): boolean {
  return errors.some((e) => e.code !== 'too_few_units');
}

export function dropResult(src: DragSource, target: DropTarget, ctx: DropContext): DropResult {
  const list = ctx.list;
  const reserve = ctx.reserve;
  // 遊軍の枠は、使える場面だけ（使えない場面では、枠がないものとして扱う）
  if (target.type === 'reserve' && !ctx.reserveShown) target = { type: 'none' };
  if (src.type === 'reserve' && (!ctx.reserveShown || !reserve)) return { type: 'none' };
  const unit = src.type === 'unit' ? list[src.index] : undefined;
  if (src.type === 'unit' && !unit) return { type: 'none' };
  // 元のマス・元の枠へ戻した：変えない
  if (unit && target.type === 'cell' && target.col === unit.col && target.row === unit.row) return { type: 'same' };
  if (src.type === 'reserve' && target.type === 'reserve') return { type: 'same' };
  if (ctx.allow && !ctx.allow(src, target)) return { type: 'none' };
  // 本陣は、外せない・遊軍にできない
  if (unit && unit.kind === 'hq' && (target.type === 'hand' || target.type === 'reserve')) return { type: 'none' };
  const at = target.type === 'cell' ? list.findIndex((p) => p.col === target.col && p.row === target.row) : -1;
  if (target.type === 'cell' && !ctx.canPlace(target)) return { type: 'none' };

  let next: { list: Placement[]; reserve: ReserveSetup | null; sound: 'place' | 'remove' } | null = null;
  const copy = (): Placement[] => list.map((p) => ({ ...p }));
  if (src.type === 'card') {
    if (src.kind === 'hq') return { type: 'none' };
    if (target.type === 'cell' && at < 0) {
      next = { list: [...copy(), { kind: src.kind, col: target.col, row: target.row, stance: defaultStance(src.kind) }], reserve, sound: 'place' };
    } else if (target.type === 'reserve') {
      // 枠が空ならその兵種が遊軍になり、部隊がいれば入れ替える（前の遊軍は外れる）
      next = { list: copy(), reserve: { kind: src.kind, stance: defaultStance(src.kind) }, sound: 'place' };
    }
  } else if (src.type === 'unit' && unit) {
    const i = src.index;
    if (target.type === 'cell') {
      const out = copy();
      const me = out[i]!;
      const other = at >= 0 ? out[at] : undefined;
      if (other) {
        other.col = me.col;
        other.row = me.row;
      }
      me.col = target.col;
      me.row = target.row;
      next = { list: out, reserve, sound: 'place' };
    } else if (target.type === 'hand') {
      next = { list: list.filter((_, j) => j !== i).map((p) => ({ ...p })), reserve, sound: 'remove' };
    } else if (target.type === 'reserve') {
      const rest = list.filter((_, j) => j !== i).map((p) => ({ ...p }));
      // 枠に部隊がいれば、前の遊軍がその部隊のいたマスに置かれる
      if (reserve) rest.push({ kind: reserve.kind, col: unit.col, row: unit.row, stance: fitStance(reserve.kind, reserve.stance, ctx.stanceOk) });
      next = { list: rest, reserve: { kind: unit.kind, stance: fitStance(unit.kind, unit.stance, ctx.stanceOk) }, sound: 'place' };
    }
  } else if (src.type === 'reserve' && reserve) {
    if (target.type === 'cell') {
      const out = copy();
      const placed: Placement = { kind: reserve.kind, col: target.col, row: target.row, stance: fitStance(reserve.kind, reserve.stance, ctx.stanceOk) };
      if (at >= 0) {
        const other = out[at]!;
        // 本陣とは入れ替えない
        if (other.kind === 'hq') return { type: 'none' };
        out.splice(at, 1, placed);
        next = { list: out, reserve: { kind: other.kind, stance: fitStance(other.kind, other.stance, ctx.stanceOk) }, sound: 'place' };
      } else {
        next = { list: [...out, placed], reserve: null, sound: 'place' };
      }
    } else if (target.type === 'hand') {
      next = { list: copy(), reserve: null, sound: 'remove' };
    }
  }
  if (!next) return { type: 'none' };
  if (blocking(ctx.check(next.list, next.reserve))) return { type: 'none' };
  return { type: 'apply', ...next };
}

// ---- ひな形（§15.6） ----

/** 配置の兵種ごとの数 */
export function countKinds(list: readonly Placement[]): Roster {
  const r: Roster = {};
  for (const p of list) r[p.kind] = (r[p.kind] ?? 0) + 1;
  return r;
}

/**
 * ひな形に並べる部隊の数。いま盤に置いている部隊（本陣を含む）の兵種と数。
 * 盤に本陣しかないときは fallback（対戦は標準の編成、一人用は手持ちの全部から遊軍の 1 つを引いたもの）
 */
export function templateRoster(list: readonly Placement[], fallback: Roster): Roster {
  if (hasNonHq(list)) return { ...countKinds(list), hq: 1 };
  return { ...fallback, hq: 1 };
}

/** 手持ちから遊軍の 1 つを引いた数（一人用の、本陣だけのときのひな形） */
export function rosterWithoutReserve(roster: Roster, reserve: ReserveSetup | null): Roster {
  const out: Roster = { ...roster };
  if (reserve && (out[reserve.kind] ?? 0) > 0) out[reserve.kind] = (out[reserve.kind] ?? 0) - 1;
  return out;
}

/**
 * 対戦で、配置と遊軍が予算・部隊数を超えるあいだ、後ろの部隊（本陣以外）を外す（ひな形では遊軍の枠を空に戻さない）。
 * trimmed は外したか
 */
export function trimToLimits(list: readonly Placement[], reserve: ReserveSetup | null, lim: PvpLimits): { list: Placement[]; trimmed: boolean } {
  const out = list.map((p) => ({ ...p }));
  let trimmed = false;
  while (budgetUsed(out, reserve, lim.costs) > lim.budget || unitCount(out, reserve) > unitCap(lim)) {
    const i = out.map((p) => p.kind !== 'hq').lastIndexOf(true);
    if (i < 0) break;
    out.splice(i, 1);
    trimmed = true;
  }
  return { list: out, trimmed };
}

/** ひな形を当てた配置（陣営0の向き。遊軍は返さない） */
export function templatePlacements(id: TemplateId, roster: Roster, zone: Zone): Placement[] {
  return applyTemplate(id, roster, zone, 0);
}

// ---- 保存した陣形の呼び出し（§15.6） ----

export interface RecallInput {
  /** 陣形の部隊（エリアの左上からの位置） */
  units: readonly Placement[];
  reserve: ReserveSetup | null | undefined;
  field: Field;
  zone: Zone;
  /** 遊軍を使える場面か */
  reserveShown: boolean;
  stanceOk: (kind: Kind, stance: Stance) => boolean;
  /** いまの本陣（陣形の本陣がエリアの外などで除かれたとき、これを補う） */
  currentHq: Placement | null;
  /** 対戦：予算と部隊数で収める */
  pvp?: PvpLimits;
  /** 一人用：手持ちの数（これを超える部隊は除く） */
  roster?: Roster;
  check: (list: Placement[], reserve: ReserveSetup | null) => readonly ArmyError[];
}

export interface RecallOutput {
  list: Placement[];
  reserve: ReserveSetup | null;
  /** 置けない部隊を除いた（「置けない部隊を除きました」） */
  skipped: boolean;
  /** 予算・部隊数に合わせて外した（「予算に合わせて部隊を外しました」） */
  trimmed: boolean;
  /** 結果の組が検査を通るか（通らなければ、画面は配置を変えない） */
  ok: boolean;
}

export function recallPlan(inp: RecallInput): RecallOutput {
  const z = inp.zone;
  let skipped = false;
  let trimmed = false;
  const placed: Placement[] = [];
  const used: Roster = {};
  let hq = 0;
  // 1. 陣形の部隊を、配置先のマスに写す（エリアの外・城壁・重なり・2 つ目からの本陣・手持ちを超える兵種は除く）
  for (const u of inp.units) {
    const c = { col: z.col + u.col, row: z.row + u.row };
    const inside = u.col >= 0 && u.row >= 0 && u.col < z.width && u.row < z.height;
    const over = inp.roster ? (used[u.kind] ?? 0) >= (inp.roster[u.kind] ?? 0) : false;
    if (u.kind === 'hq' && hq > 0) {
      // 本陣は1つだけ（2つ目からは除く。いままでも知らせは出していない）
      continue;
    }
    if (!inside || !placeable(inp.field, z, c) || placed.some((p) => p.col === c.col && p.row === c.row) || over) {
      skipped = true;
      continue;
    }
    if (u.kind === 'hq') hq++;
    used[u.kind] = (used[u.kind] ?? 0) + 1;
    placed.push({ kind: u.kind, col: c.col, row: c.row, stance: fitStance(u.kind, u.stance, inp.stanceOk) });
  }
  // 2. 遊軍の候補
  let reserve: ReserveSetup | null = null;
  if (inp.reserve) {
    if (inp.reserve.kind !== 'hq' && inp.reserveShown) reserve = { kind: inp.reserve.kind, stance: fitStance(inp.reserve.kind, inp.reserve.stance, inp.stanceOk) };
    else skipped = true;
  }
  // 3. 本陣を補う（いまのマスが空いていればそこ、ふさがっていれば初めのマスの探し方で近い空きマス）
  if (hq === 0) {
    const cur = inp.currentHq;
    const free = cur && placeable(inp.field, z, cur) && !placed.some((p) => p.col === cur.col && p.row === cur.row);
    const cell = free && cur ? { col: cur.col, row: cur.row } : hqHomeCell(inp.field, z, placed);
    if (cell) placed.push({ kind: 'hq', col: cell.col, row: cell.row, stance: cur ? cur.stance : defaultStance('hq') });
  }
  // 4. 数を収める
  let list = placed;
  if (inp.pvp) {
    const lim = inp.pvp;
    while (budgetUsed(list, reserve, lim.costs) > lim.budget || unitCount(list, reserve) > unitCap(lim)) {
      trimmed = true;
      // 遊軍 → 後ろの部隊（本陣以外）の順に外す
      if (reserve) {
        reserve = null;
        continue;
      }
      const i = list.map((p) => p.kind !== 'hq').lastIndexOf(true);
      if (i < 0) break;
      list = list.filter((_, j) => j !== i);
    }
  } else if (inp.roster && reserve) {
    // 一人用：戦場に置いたあと手持ちが残っていれば、遊軍を枠に入れる
    const left = (inp.roster[reserve.kind] ?? 0) - (used[reserve.kind] ?? 0);
    if (left <= 0) {
      reserve = null;
      skipped = true;
    }
  }
  // 5. 結果の組の検査
  const ok = !blocking(inp.check(list, reserve));
  return { list, reserve, skipped, trimmed, ok };
}
