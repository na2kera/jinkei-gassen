// 遊軍（design §7）。手持ちの部隊から1つを控えさせ、戦闘中に1回だけ呼ぶと、戦場の端に現れる。
// 呼ぶ前の遊軍は state.units に入れない（部隊を走査するどの決まりにも映らないようにするため）。呼んだ刻みに末尾へ足す。
// 呼ぶ処理は乱数を引かない。

import { freshUnit } from './battle.ts';
import { dist } from './geom.ts';
import { isObject } from './input.ts';
import { KIND_STATS, T } from './tuning.ts';
import type { BattleEvent, BattleState, BattleView, ReserveFrom, ReserveState, Result, Side } from './types.ts';

export const isReserveFrom = (v: unknown): v is ReserveFrom => v === 'left' || v === 'right';

/** 遊軍の欄（古い状態には欄がないので、ないときは両方 null として読む） */
export function reservesOf(state: BattleState): [ReserveState | null, ReserveState | null] {
  const r: unknown = state.reserves;
  return Array.isArray(r) && r.length === 2 ? (r as [ReserveState | null, ReserveState | null]) : [null, null];
}

/**
 * 遊軍が現れるマス（§7.4）。見つからなければ null。
 * 行は「中央の線のすぐ自陣側」から自陣の奥へ。列は、その陣営から見た左右の端。
 * 城壁のマス、城壁の行とその向こう側、戦場にいる部隊（門を含む）から T.spacing 未満のマスは選ばない。
 */
export function spawnCell(state: BattleState, side: Side, from: ReserveFrom): { col: number; row: number } | null {
  const { width, height, terrain } = state.field;
  // 陣営0の左は列 0、陣営1の左は列 width − 1（wingOf と同じ向き）
  const toSmallCol = (side === 0) === (from === 'left');
  const col = toSmallCol ? 0 : width - 1;
  const rows: number[] = [];
  if (side === 0) for (let r = Math.ceil(height / 2); r <= height - 1; r++) rows.push(r);
  else for (let r = Math.floor(height / 2) - 1; r >= 0; r--) rows.push(r);
  // 城壁は門のある戦場だけにある（createBattle で調べ済み）。門が破れて両隣が崩れても、行は state.gate.row のまま
  const wallRow = state.gate ? state.gate.row : null;
  for (const row of rows) {
    if (terrain[row * width + col] === 'wall') continue;
    // 陣営0は下の側（行の大きいほう）、陣営1は上の側。城壁の行そのものと、その向こう側は候補にしない
    if (wallRow !== null && (side === 0 ? row <= wallRow : row >= wallRow)) continue;
    const cx = col + 0.5;
    const cy = row + 0.5;
    const busy = state.units.some((u) => u.status !== 'gone' && dist(u.x, u.y, cx, cy) < T.spacing);
    if (!busy) return { col, row };
  }
  return null;
}

/** 遊軍を呼べるか（状態は変えない）。呼べないときは理由を返す */
export function canSummon(state: BattleState, side: Side, from: ReserveFrom): Result<true> {
  if (!isObject(state) || !Array.isArray(state.units) || !isObject(state.field) || typeof state.tick !== 'number') {
    return { ok: false, error: { code: 'invalid_order', message: '状態が正しくない' } };
  }
  if (side !== 0 && side !== 1) return { ok: false, error: { code: 'invalid_order', message: '陣営が正しくない' } };
  if (!isReserveFrom(from)) return { ok: false, error: { code: 'invalid_order', message: '遊軍を呼ぶ側が正しくない' } };
  if (state.outcome) return { ok: false, error: { code: 'battle_over', message: '決着している' } };
  const r = reservesOf(state)[side];
  if (!isObject(r) || r.used) return { ok: false, error: { code: 'no_reserve', message: '呼べる遊軍がいない' } };
  if (state.tick < T.reserveMinTick) {
    return { ok: false, error: { code: 'reserve_not_ready', message: `遊軍は開戦から ${T.reserveMinTick / 10} 秒たってから呼べる` } };
  }
  if (!spawnCell(state, side, from)) return { ok: false, error: { code: 'no_spawn_cell', message: '遊軍が現れるマスがない' } };
  return { ok: true, value: true };
}

/**
 * 遊軍を呼ぶ。呼べたら true を返し、出来事 reserve を events に足す。条件は canSummon と同じ。
 * step の①（号令を受け付ける前、部隊ごとの配列を作る前）だけから呼ぶ。
 */
export function summonReserve(state: BattleState, side: Side, from: ReserveFrom, events: BattleEvent[]): boolean {
  if (!canSummon(state, side, from).ok) return false;
  const r = reservesOf(state)[side] as ReserveState;
  const cell = spawnCell(state, side, from) as { col: number; row: number };
  const id = state.units.length;
  const men = KIND_STATS[r.kind].men;
  const u = freshUnit(id, side, r.kind, from, cell.col + 0.5, cell.row + 0.5, r.stance, men);
  // 迂回の方針なら、すでに端にいるので「端に沿って進む」から始める
  u.flankPhase = 2;
  u.flankEdgeX = u.x;
  state.units.push(u);
  state.initialMen[side] += men;
  r.used = true;
  r.unit = id;
  events.push({ type: 'reserve', tick: state.tick, side, unit: id, from });
  return true;
}

/**
 * 場面だけから、遊軍を呼べそうかを判定する（対戦の画面用）。見るのは、決着していないことと、自分の遊軍が 'ready' であることだけ。
 * 現れるマスがあるかまでは分からないので、押したあとに server から no_spawn_cell が返ることがある
 */
export function canSummonView(view: BattleView, side: Side): boolean {
  if (!isObject(view)) return false;
  if (side !== 0 && side !== 1) return false;
  if (view.outcome) return false;
  const r: unknown = view.reserve;
  if (!Array.isArray(r)) return false;
  const mine: unknown = r[side];
  return isObject(mine) && mine.state === 'ready';
}
