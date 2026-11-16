// 部屋の状態（design §4.3）。保存領域の "room" に1つの値として書く。
// ここに置く関数は、時計・保存領域・接続に触れない（呼ぶ側が now を渡す）。

import type { BattleState, BattleSummary, Placement } from '@jinkei/engine';
import type { Timing } from './timing.ts';

export type Phase = 'empty' | 'reserved' | 'waiting' | 'setup' | 'reveal' | 'battle' | 'result';

export interface Seat {
  pid: string;
  name: string;
  /** いま有効な接続の番号。切れていれば null */
  conn: number | null;
  /** 切れた時刻。つながっていれば null */
  goneSince: number | null;
  ready: boolean;
  /** 最後に届いた下書き（戦場の座標） */
  draft: Placement[] | null;
  /** 最後に検査を通った下書き（戦場の座標） */
  lastValid: Placement[] | null;
}

/**
 * 期限の時刻。いちばん近いものをアラームに入れる。
 * design §4.3 の5つに、不在の判定（away）を足した。idle は「誰もつながっていない状態が10分続いたら片付ける」期限。
 */
export interface Deadlines {
  setup?: number;
  reveal?: number;
  reserve?: number;
  idle?: number;
  away?: number;
  watchdog?: number;
}

export interface RoomState {
  v: 1;
  /** 部屋のコード（Durable Object の名前と同じ） */
  code: string;
  /** 部屋の世代。コードが使い回されるたびに増える。接続の添付データにも入れ、前の世代の接続を見分ける */
  gen: number;
  phase: Phase;
  /** この部屋で何戦目か。reveal に入るときに増える */
  battleNo: number;
  seats: [Seat | null, Seat | null];
  /** 陣営0の勝ち、陣営1の勝ち、引き分け */
  score: [number, number, number];
  /** 戦場の id */
  map: string;
  deadlines: Deadlines;
  rematch: [boolean, boolean];
  lastResult: BattleSummary | null;
  /** 部屋を作ったときの秒数（テストでは縮める） */
  timing: Timing;
  /** 接続に振る番号の最後の値（世代をまたいでも増え続ける） */
  connSeq: number;
  /** 入れてあるアラームの時刻（遅らせる分を含む）。保存領域のアラームと合わせておく */
  alarmAt: number | null;
}

/** 戦闘の状態。部屋の状態とは別の鍵 "battle" に書く（毎刻みは書かないため、design §4.2） */
export interface BattleRecord {
  battleNo: number;
  /** 両軍の配置（戦場の座標）。公開の段階で入り直した人に送り直すために持つ */
  armies: [Placement[], Placement[]];
  startsAt: number;
  state: BattleState;
}

export function newRoom(code: string, gen: number, timing: Timing, connSeq: number): RoomState {
  return {
    v: 1,
    code,
    gen,
    phase: 'empty',
    battleNo: 0,
    seats: [null, null],
    score: [0, 0, 0],
    map: 'plain',
    deadlines: {},
    rematch: [false, false],
    lastResult: null,
    timing,
    connSeq,
    alarmAt: null,
  };
}

export function newSeat(pid: string, name: string): Seat {
  return { pid, name, conn: null, goneSince: null, ready: false, draft: null, lastValid: null };
}

/** いちばん近い期限。なければ null */
export function nextDeadline(s: RoomState): number | null {
  let t: number | null = null;
  for (const v of Object.values(s.deadlines)) {
    if (typeof v === 'number' && (t === null || v < t)) t = v;
  }
  return t;
}

/** 席の人が1人でもつながっているか */
export function anyConnected(s: RoomState): boolean {
  return s.seats.some((x) => x !== null && x.conn !== null);
}

/**
 * 外へ見える内容。これが変わったときだけ、全員に room を送り直す。
 * 見張りの期限・アラームの時刻・接続の番号など、内部の値だけが変わったときは送らない（戦闘中に毎秒送らないため）。
 */
export function publicSignature(s: RoomState): string {
  return JSON.stringify([
    s.gen,
    s.phase,
    s.battleNo,
    // 下書きは入れない（下書きのたびに相手へ room を送ると、相手が配置を動かしている様子が伝わるため。
    // 自分の下書き（myArmy）は入り直したときの room で届けば足りる）
    s.seats.map((x) => (x === null ? null : [x.name, x.conn !== null, x.ready])),
    s.score,
    s.map,
    s.deadlines.setup ?? null,
    s.deadlines.reveal ?? null,
    s.rematch,
  ]);
}
