// 配置の下書きの様子（design §15.5）。Cloudflare に頼らない計算だけにして、テストから直に呼べるようにする。

import { pvpArmyLimits, validateArmy, type ArmyError, type Field, type Zone } from '@jinkei/engine';
import type { Deploy, RoomState } from './state.ts';

/** 配置と遊軍の組を検査する（design §7.6。予算・部隊数は戦場の部隊 + 遊軍で数え、遊軍の値は reserveErrors で見る） */
export function deployErrors(d: Deploy, zone: Zone): ArmyError[] {
  return validateArmy(d.army, zone, { ...pvpArmyLimits(), reserve: d.reserve });
}

/**
 * 下書きの様子（design §15.5）。
 *   ok：検査を通る。thin：誤りが「盤に本陣以外の部隊がない」（too_few_units）だけ（本陣だけ、本陣＋遊軍）。bad：それ以外の不正。
 * 配置の画面では本陣が最初から置いてあるので、「置いた部隊を全部外して本陣だけにした」下書きがふつうに届く
 */
export function deployState(d: Deploy, zone: Zone): 'ok' | 'thin' | 'bad' {
  const errors = deployErrors(d, zone);
  if (errors.length === 0) return 'ok';
  return errors.every((e) => e.code === 'too_few_units') ? 'thin' : 'bad';
}

/**
 * 保存領域から読み戻した部屋をそろえる。前の版のサーバーは「足りないだけ」の下書きで lastValid を空にしなかったので、
 * 「下書き＝本陣だけ、lastValid＝外す前の軍」のまま保存されていることがある（ROOM_VERSION は同じ）。
 * 配置の段階で、確定していない席の最新の下書きが「足りないだけ」なら lastValid を空にする（外した部隊を、
 * 読み込み直しや時間切れで生き返らせない）。変えたら true
 */
export function clearThinLastValid(s: RoomState, field: Field): boolean {
  if (s.phase !== 'setup') return false;
  let changed = false;
  s.seats.forEach((seat, side) => {
    if (!seat || seat.ready || seat.draft === null || seat.lastValid === null) return;
    const zone = field.zones[side as 0 | 1];
    if (deployState(seat.draft, zone) === 'thin') {
      seat.lastValid = null;
      changed = true;
    }
  });
  return changed;
}
