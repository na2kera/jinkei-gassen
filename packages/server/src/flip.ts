// 「自分が下」の座標と戦場の座標の変換（design §4.4）。返し方はこのファイルにだけ書く。
// 陣営1の人は、戦場を180度回して見る（上下と左右を返す）。陣営0の人は戦場の座標そのまま。
// 180度の回転は2回かけると元に戻るので、行きと帰りに同じ関数を使う。
// cloudflare:workers に触れないので、Node のテストから直接読める。

import type { BattleView, Field, Placement, Side, UnitView, Zone } from '@jinkei/engine';
import type { PackedUnit, RevealUnit } from './protocol.ts';

type Size = Pick<Field, 'width' | 'height'>;

/** マス（列・行）を返す。マスは整数なので、幅から1を引いて返す */
export function flipCell(col: number, row: number, size: Size): { col: number; row: number } {
  return { col: size.width - 1 - col, row: size.height - 1 - row };
}

/** 連続した位置を返す。部隊の中心はマスの中心（col + 0.5）なので、マスの返し方と合う */
export function flipPoint(x: number, y: number, size: Size): { x: number; y: number } {
  return { x: size.width - x, y: size.height - y };
}

/** 配置を返す。viewer が 0 なら写しを返すだけ */
export function placementsFor(viewer: Side, army: readonly Placement[], size: Size): Placement[] {
  return army.map((p) => {
    const c = viewer === 1 ? flipCell(p.col, p.row, size) : { col: p.col, row: p.row };
    return { kind: p.kind, col: c.col, row: c.row, stance: p.stance };
  });
}

/** 配置エリアの矩形を返す */
export function flipZone(z: Zone, size: Size): Zone {
  return { col: size.width - z.col - z.width, row: size.height - z.row - z.height, width: z.width, height: z.height };
}

/**
 * 戦場を viewer から見た形にする。地形は行優先なので、180度の回転は配列を逆順にするだけ。
 * zones は陣営の順のまま返すので、陣営1の人には zones[1] が下側になる。
 */
export function fieldFor(viewer: Side, field: Field): Field {
  if (viewer === 0) {
    return { width: field.width, height: field.height, terrain: field.terrain.slice(), zones: [{ ...field.zones[0] }, { ...field.zones[1] }] };
  }
  return {
    width: field.width,
    height: field.height,
    terrain: field.terrain.slice().reverse(),
    zones: [flipZone(field.zones[0], field), flipZone(field.zones[1], field)],
  };
}

/** 公開の段階の配置。自軍だけ stance を付ける（相手の方針は送らない） */
export function revealFor(viewer: Side, owner: Side, army: readonly Placement[], size: Size): RevealUnit[] {
  return placementsFor(viewer, army, size).map((p) => {
    const u: RevealUnit = { kind: p.kind, col: p.col, row: p.row };
    if (owner === viewer) u.stance = p.stance;
    return u;
  });
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * engine の UnitView を詰めた配列にする。位置と向きは viewer から見た形に返す。
 * 翼は「その部隊の陣営から見た左右」のまま返さない（号令の target と同じ基準を保つため）。
 * 項目は1つずつ書き出す（UnitView に項目が増えても、勝手に外へ出ないようにする）。
 * stance は viewFor(state, viewer) が自軍にだけ付けたものをそのまま使う。
 */
export function packUnit(viewer: Side, u: UnitView, size: Size): PackedUnit {
  const p = viewer === 1 ? flipPoint(u.x, u.y, size) : { x: u.x, y: u.y };
  const fx = viewer === 1 ? -u.fx : u.fx;
  const fy = viewer === 1 ? -u.fy : u.fy;
  return [
    u.id,
    u.side,
    u.kind,
    u.wing,
    r2(p.x),
    r2(p.y),
    // -0 を 0 にそろえる（JSON では同じだが、テストの比較を素直にするため）
    r3(fx) + 0,
    r3(fy) + 0,
    r1(u.men),
    u.maxMen,
    r1(u.morale),
    u.status,
    u.order,
    u.attacking,
    u.side === viewer && u.stance !== undefined ? u.stance : null,
  ];
}

export function packView(viewer: Side, view: BattleView, size: Size): PackedUnit[] {
  return view.units.map((u) => packUnit(viewer, u, size));
}
