// 部屋の状態（design §4.3）。保存領域の "room" に1つの値として書く。
// ここに置く関数は、時計・保存領域・接続に触れない（呼ぶ側が now を渡す）。
//
// 部屋がない（empty）ことは、"room" の記録がないことで表す。片付けでは保存領域をすべて消すので、
// 使われていないコードの Durable Object には何も残らない。

import type { BattleState, BattleSummary, Placement } from '@jinkei/engine';
import type { Timing } from './timing.ts';

export type Phase = 'reserved' | 'waiting' | 'setup' | 'reveal' | 'battle' | 'result';

export interface Seat {
  pid: string;
  name: string;
  /** いま有効な接続の番号（乱数）。切れていれば null */
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
 * 期限の時刻。その段階で扱う期限のうち、いちばん近いものをアラームに入れる（nextDeadline）。
 * design §4.3 の期限に、不在の判定（away）を足した。idle は「誰もつながっていない状態が10分続いたら片付ける」期限。
 * 見張り（watchdog）は、戦闘中に数秒ごとに先へ延ばすもので、そのたびに部屋の記録を書かないよう、メモリにだけ持つ（room.ts）。
 */
export interface Deadlines {
  setup?: number;
  reveal?: number;
  reserve?: number;
  idle?: number;
  away?: number;
}

export interface RoomState {
  v: 2;
  /** 部屋のコード（Durable Object の名前と同じ） */
  code: string;
  /**
   * 部屋の世代（32ビットの乱数）。部屋を作るたびに決め直す。接続の添付データにも入れ、前の部屋の接続を見分ける。
   * 片付けでは記録を残さないので、「前の値 + 1」ではなく乱数にしている（前の部屋と同じ値になる見込みは 2^-32）
   */
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
  /** テスト専用：選ぶ戦場を決めておく（本番は常に null で、毎回ランダムに選ぶ） */
  testMap: string | null;
}

/** 戦闘の状態。部屋の状態とは別の鍵 "battle" に書く（毎刻みは書かないため、design §4.2） */
export interface BattleRecord {
  battleNo: number;
  /** 両軍の配置（戦場の座標）。公開の段階で入り直した人に送り直すために持つ */
  armies: [Placement[], Placement[]];
  startsAt: number;
  state: BattleState;
  /**
   * いままでに出た出来事の数（= 次の出来事の通し番号）。state と一緒に保存するので、作り直されたあと保存した刻みから
   * 続けても、同じ出来事には同じ番号が付く（engine は再現でき、号令を受け付けた step の直後は必ず保存するため）
   */
  evCount: number;
}

export function newRoom(code: string, gen: number, timing: Timing): RoomState {
  return {
    v: 2,
    code,
    gen,
    phase: 'reserved',
    battleNo: 0,
    seats: [null, null],
    score: [0, 0, 0],
    map: 'plain',
    deadlines: {},
    rematch: [false, false],
    lastResult: null,
    timing,
    testMap: null,
  };
}

export function newSeat(pid: string, name: string): Seat {
  return { pid, name, conn: null, goneSince: null, ready: false, draft: null, lastValid: null };
}

/**
 * アラームに入れる候補の期限のうち、いちばん近いもの。なければ null。
 * その段階でアラームの処理が扱う期限だけを候補にする。扱わない期限が候補に残ると、過ぎたあとも
 * 「過去の時刻のアラーム」を入れ直し続け、すぐ鳴っては何もしない、をくり返すため。
 * - reserve は reserved、setup は setup、reveal は reveal、away は result のときだけ
 * - idle は battle 以外（戦闘中は片付けない。戦闘は見張りが動かし、終われば result で扱う）
 */
export function nextDeadline(s: RoomState): number | null {
  const d = s.deadlines;
  const list: (number | undefined)[] = [];
  if (s.phase === 'reserved') list.push(d.reserve);
  if (s.phase === 'setup') list.push(d.setup);
  if (s.phase === 'reveal') list.push(d.reveal);
  if (s.phase === 'result') list.push(d.away);
  if (s.phase !== 'battle') list.push(d.idle);
  let t: number | null = null;
  for (const v of list) if (typeof v === 'number' && (t === null || v < t)) t = v;
  return t;
}

/** 席の人が1人でもつながっているか */
export function anyConnected(s: RoomState): boolean {
  return s.seats.some((x) => x !== null && x.conn !== null);
}

/**
 * 外へ見える内容。これが変わったときだけ、全員に room を送り直す。
 * 接続の番号など、内部の値だけが変わったときは送らない。
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
