// 対戦の遊軍（design §7.7、§7.8）で送るメッセージの組み立てと、room から遊軍を読む口。
// 画面なしで確かめられるよう、通信や Phaser に触らない計算だけにする。

import type { Placement, ReserveFrom, ReserveSetup } from '@jinkei/engine';
import type { DraftMessage, ReadyMessage, ReserveMessage, RoomMessage } from '@jinkei/server/protocol';

/**
 * つなぐときの URL に付ける client の版。2 は遊軍を知っている版（server の room.rules.reserve の条件）、
 * 3 は盤を変えた版（design §13.6）。server は MIN_CLIENT_VERSION（3）より小さい版を outdated で断る
 */
export const CLIENT_VERSION = 3;

/** この部屋で遊軍を使えるか。項目がない（古い server）ときは false として読む */
export function reserveAllowed(room: Pick<RoomMessage, 'rules'> | null | undefined): boolean {
  return room?.rules?.reserve === true;
}

/** 部屋が覚えている自分の遊軍（myArmy と組）。使えない部屋・項目がないときは null */
export function roomReserve(room: Pick<RoomMessage, 'rules' | 'myReserve'> | null | undefined): ReserveSetup | null {
  if (!room || !reserveAllowed(room)) return null;
  const r = room.myReserve;
  return r ? { kind: r.kind, stance: r.stance } : null;
}

function copyArmy(list: readonly Placement[]): Placement[] {
  return list.map((p) => ({ ...p }));
}

/**
 * 下書き。遊軍は、使える部屋のときだけ付ける（使えない部屋で値を付けると、server が下書きを組ごと捨てるため）。
 * 使える部屋では、枠が空でも null を付けて送る（前に送った遊軍を外したことを伝えるため）
 */
export function draftMessage(army: readonly Placement[], reserve: ReserveSetup | null, allowed: boolean): DraftMessage {
  const m: DraftMessage = { type: 'draft', army: copyArmy(army) };
  if (allowed) m.reserve = reserve ? { ...reserve } : null;
  return m;
}

/** 確定。配置と遊軍を一組で付ける（遊軍の付け方は下書きと同じ） */
export function readyMessage(army: readonly Placement[], reserve: ReserveSetup | null, allowed: boolean): ReadyMessage {
  const m: ReadyMessage = { type: 'ready', army: copyArmy(army) };
  if (allowed) m.reserve = reserve ? { ...reserve } : null;
  return m;
}

/** 遊軍を呼ぶ。from は自分から見た左右のまま（返さずに送る。server も返さない） */
export function summonMessage(battleNo: number, from: ReserveFrom): ReserveMessage {
  return { type: 'reserve', battleNo, from };
}
