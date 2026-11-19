// 配置の画面の「遊軍」の枠（design §7.8）で使う数え方。Phaser を使わない計算だけにして、画面なしで確かめられるようにする。
// 遊軍は手持ちから1部隊を回したもの。手持ちの残りは「手持ち − 戦場に置いた数 − 遊軍（その兵種なら1）」で数える。

import { applyTemplate, defaultStance, type Kind, type Placement, type ReserveSetup, type Roster, type Stance, type TemplateId, type Zone } from '@jinkei/engine';

/** その兵種の、まだ置いていない数（戦場と遊軍の枠の両方を引く） */
export function remainingOf(roster: Roster, list: readonly Placement[], reserve: ReserveSetup | null, kind: Kind): number {
  const placed = list.filter((p) => p.kind === kind).length;
  return (roster[kind] ?? 0) - placed - (reserve && reserve.kind === kind ? 1 : 0);
}

/** 選んだ兵種を枠に入れられるか（本陣は入れられない。枠が空で、手持ちが残っているときだけ） */
export function canPutReserve(kind: Kind | null, roster: Roster, list: readonly Placement[], reserve: ReserveSetup | null): kind is Kind {
  return kind !== null && kind !== 'hq' && reserve === null && remainingOf(roster, list, reserve, kind) > 0;
}

/** 枠に入れる遊軍（方針は、戦場に置くときと同じく兵種の初期設定から始める） */
export function newReserve(kind: Kind): ReserveSetup {
  return { kind, stance: defaultStance(kind) };
}

/**
 * ひな形を当てる。ひな形は手持ちの全部隊を並べるので、遊軍の枠は空に戻す（design §7.6。残すと二重に数えるため）
 */
export function templateWithReserve(id: TemplateId, roster: Roster, zone: Zone): { placements: Placement[]; reserve: null } {
  return { placements: applyTemplate(id, roster, zone, 0), reserve: null };
}

/**
 * 保存した陣形の遊軍を、呼び出した配置に足せるか。手持ちが足りないとき・本陣のとき・その場で選べない方針のときは、
 * 方針を兵種の初期設定に直す（方針だけが合わないとき）か、入れない（null）。placed は呼び出して置いた部隊
 */
export function recallReserve(
  saved: ReserveSetup | null | undefined,
  roster: Roster,
  placed: readonly Placement[],
  stanceOk: (kind: Kind, stance: Stance) => boolean,
): ReserveSetup | null {
  if (!saved || saved.kind === 'hq') return null;
  if (remainingOf(roster, placed, null, saved.kind) <= 0) return null;
  return { kind: saved.kind, stance: stanceOk(saved.kind, saved.stance) ? saved.stance : defaultStance(saved.kind) };
}

/**
 * 対戦の編成で、兵種の数を count に減らしたあとの配置と遊軍。置いた数 + 遊軍が count を超えたら、
 * 最後に置いたその兵種の部隊を外す。戦場に置いていなければ、遊軍の枠を空にする
 */
export function shrinkKind(list: readonly Placement[], reserve: ReserveSetup | null, kind: Kind, count: number): { list: Placement[]; reserve: ReserveSetup | null } {
  const out = list.map((p) => ({ ...p }));
  let r = reserve;
  const used = (): number => out.filter((p) => p.kind === kind).length + (r && r.kind === kind ? 1 : 0);
  while (used() > count) {
    const i = out.map((p) => p.kind).lastIndexOf(kind);
    if (i >= 0) out.splice(i, 1);
    else r = null;
  }
  return { list: out, reserve: r };
}
