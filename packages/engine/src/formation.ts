// 陣形名の判定（design §3.7）。表示だけに使い、戦いには効かない。
// 本陣を除いた配置のマスの集合 P と、同じ手持ちで作った各ひな形のマスの集合 T を比べる。
// 横に ±2、縦に ±1 ずらした中で |P∩T| ÷ max(|P|, |T|) がいちばん大きい値を、そのひな形の点とする。
// 点が 0.75 以上で、2番目との差が 0.05 以上あるひな形の名前を返す。兵種と方針は見ない。雁行は左右どちら向きも同じ名前。

import { isDenseArray, isInt, isKind, isObject } from './input.ts';
import { applyTemplate, listTemplates } from './templates.ts';
import type { Placement, Roster, Side, TemplateId, Zone } from './types.ts';

export const FORMATION_MIN_SCORE = 0.75;
export const FORMATION_MIN_MARGIN = 0.05;
const SHIFT_X = 2;
const SHIFT_Y = 1;

const key = (col: number, row: number): string => `${col},${row}`;

/** 2つのマスの集合の点：横 ±2・縦 ±1 ずらした中でいちばん大きい |P∩T| ÷ max(|P|, |T|) */
function overlapScore(p: Set<string>, t: { col: number; row: number }[]): number {
  const denom = Math.max(p.size, t.length);
  if (denom === 0) return 0;
  let best = 0;
  for (let dy = -SHIFT_Y; dy <= SHIFT_Y; dy++) {
    for (let dx = -SHIFT_X; dx <= SHIFT_X; dx++) {
      let hit = 0;
      for (const c of t) if (p.has(key(c.col + dx, c.row + dy))) hit++;
      if (hit > best) best = hit;
    }
  }
  return best / denom;
}

/** 各ひな形の点（判定の中身を見るため・テスト用にも公開する） */
export function formationScores(placements: readonly Placement[], zone: Zone, side: Side): { id: TemplateId; name: string; score: number }[] {
  if (!isDenseArray(placements) || !isObject(zone) || !isInt(zone.col) || !isInt(zone.row) || !isInt(zone.width) || !isInt(zone.height)) return [];
  if (side !== 0 && side !== 1) return [];
  const roster: Roster = {};
  const p = new Set<string>();
  for (const x of placements as unknown[]) {
    if (!isObject(x) || !isKind(x.kind) || !isInt(x.col) || !isInt(x.row)) return [];
    roster[x.kind] = (roster[x.kind] ?? 0) + 1;
    if (x.kind !== 'hq') p.add(key(x.col, x.row));
  }
  if (p.size === 0) return [];
  return listTemplates().map(({ id, name }) => {
    const t = applyTemplate(id, roster, zone, side)
      .filter((c) => c.kind !== 'hq')
      .map((c) => ({ col: c.col, row: c.row }));
    let score = overlapScore(p, t);
    if (id === 'echelon') {
      // 雁行は、左右を返した向きも同じ名前で数える
      const mirrored = t.map((c) => ({ col: zone.col + (zone.width - 1 - (c.col - zone.col)), row: c.row }));
      score = Math.max(score, overlapScore(p, mirrored));
    }
    return { id, name, score };
  });
}

/** 並べ方が有名な型に近ければ、その名前を返す。近いものがなければ null。どんな値を渡されても例外を投げない */
export function recognizeFormation(placements: readonly Placement[], zone: Zone, side: Side): { id: TemplateId; name: string } | null {
  const scores = formationScores(placements, zone, side)
    .slice()
    .sort((a, b) => b.score - a.score);
  const first = scores[0];
  if (!first) return null;
  const second = scores[1]?.score ?? 0;
  if (first.score + 1e-9 < FORMATION_MIN_SCORE) return null;
  if (first.score - second + 1e-9 < FORMATION_MIN_MARGIN) return null;
  return { id: first.id, name: first.name };
}
