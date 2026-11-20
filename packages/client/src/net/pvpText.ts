// 対戦の画面に出す文のうち、届いた値から決まるもの（design §11）。
// Phaser を読まない関数にして、画面なしで確かめられるようにする。

import type { BattleSummary, Side } from '@jinkei/engine';
import type { RoomMessage } from '@jinkei/server/protocol';
import { percent } from '../ui/labels.ts';

/** 相手の印：ただ切れているとき（電波・画面を閉じた。戻るのを待つ） */
export const OPPONENT_GONE_MARK = '相手 切断';
/** 相手の印：相手が自分で部屋を出たとき（戦闘の途中。戦いは最後まで進む。design §11.2） */
export const OPPONENT_LEFT_MARK = '相手 退出';
/** 部屋の画面のいちばん下の行：相手が自分で部屋を出たので、待機に戻ったとき（design §11.2） */
export const OPPONENT_LEFT_NOTICE = '相手が部屋を出ました';

/**
 * 戦場の左下（結果の画面では左上）に出す相手の印。対戦の途中（active）で、待機でなく、相手の席が切れているときだけ出す。
 * 相手の席が left（自分で出た）なら「相手 退出」、そうでなければ「相手 切断」。つながっていれば空。
 * 古い server は left を送らないので、ないときは切れているだけとして読む
 */
export function opponentMark(room: Pick<RoomMessage, 'phase' | 'you' | 'seats'> | null, active: boolean): string {
  if (!active || !room || room.phase === 'waiting') return '';
  const other = room.seats[room.you === 0 ? 1 : 0];
  if (!other || other.connected) return '';
  return other.left === true ? OPPONENT_LEFT_MARK : OPPONENT_GONE_MARK;
}

/**
 * 部屋の画面のいちばん下の行（design §11.5-8）。毎フレーム、次の順で決める：
 *   (1) 生きている知らせ（notice。失敗の文・「写しました」など）、(2) 部屋にいて待機中で、相手が自分で出たなら「相手が部屋を出ました」、
 *   (3) 何もなければ空。退出の文は notice に入れない（notice は時間で消え、シーンをまたいで残るため）。
 * 自分が部屋を出たあと（room がない・active でない）は出さない。error は、その文を失敗の色で出すか
 */
export function lobbyStatusLine(
  notice: { text: string; until: number; error: boolean },
  now: number,
  room: Pick<RoomMessage, 'phase' | 'opponentLeft'> | null,
  active: boolean,
): { text: string; error: boolean } {
  if (now < notice.until) return { text: notice.text, error: notice.error };
  // 失敗ではなく知らせなので、失敗の色（赤）ではなく「写しました」と同じ色で出す
  if (active && room && room.phase === 'waiting' && room.opponentLeft === true) return { text: OPPONENT_LEFT_NOTICE, error: false };
  return { text: '', error: true };
}

/**
 * 対戦の結果の「残った兵」の1行（design §11.3）。自軍・敵軍とも remaining（時間切れの勝ち負けを決める数え方。
 * 呼ばなかった遊軍を数に入れない）を出す。2人の画面で同じ数字になり、勝ち負けと必ず合う。
 * 1人用の結果の画面は星の条件と同じ数え方（remainingShown）のままで、ここは使わない
 */
export function pvpRemainingText(s: Pick<BattleSummary, 'remaining'>, you: Side): string {
  const enemy: Side = you === 0 ? 1 : 0;
  return `残った兵 自軍${percent(s.remaining[you])} 敵軍${percent(s.remaining[enemy])}`;
}
