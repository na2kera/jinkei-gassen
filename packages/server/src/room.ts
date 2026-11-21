// 部屋の Durable Object（design §4.2〜§4.4）。
//
// 決まり:
// - 部屋の状態（RoomState）はメモリに持ち、変わるたびに保存領域の "room" へ書く。コンストラクタで読み戻す。
//   眠ったり作り直されたりするとメモリは消えるが、保存した内容と、接続の添付データ（世代・席・接続の番号）から組み立て直せる。
// - 戦闘の状態（BattleState）は、戦闘中はメモリに持って setInterval で刻み、"battle" へは SAVE_EVERY_TICKS 刻みごと・
//   号令を受け付けた step の直後・決着時にだけ書く。作り直されたら、保存した刻みから続ける（追いかけない）。
//   保存が要る刻みでは、書いてから snap を送る（送信は書き込みが終わるまで保留されるので、保存できなかった場面は相手に届かない）。
// - 部屋がないことは、保存領域に何もないことで表す。片付けでは deleteAll で全部消す。
// - 1つの入力の処理は、計算を終えてから、保存・アラーム・送信を await を挟まずに続けて行う（Tx と commit）。
//   同期の保存領域（ctx.storage.kv）への書き込みはまとめて反映され、送信はその書き込みが終わるまで保留される。
// - 期限はアラームで扱う。アラームの処理は「今の時刻・保存した期限・今の段階」だけを見て進めるので、
//   何回呼ばれても、段階の移り変わりと成績の加算は1回だけになる。
// - 外へ送るのは、許可した項目だけを書き出したもの（相手の方針・狙い・下書き・pid は送らない）。

import { DurableObject } from 'cloudflare:workers';
import {
  MAX_ORDERS,
  PVP_RULES,
  applyTemplate,
  canOrder,
  canSummon,
  createBattle,
  pvpArmyLimits,
  step,
  summarize,
  validateArmy,
  viewFor,
  type ArmyError,
  type BattleEvent,
  type BattleSummary,
  type Field,
  type OrderInput,
  type Placement,
  type ReserveInput,
  type ReserveSetup,
  type ReserveView,
  type Side,
  type Zone,
} from '@jinkei/engine';
import { fieldFor, packView, placementsFor, revealFor } from './flip.ts';
import { fieldOf, pickMap } from './maps.ts';
import type {
  ClientMessage,
  CloseCode,
  ErrorMessage,
  ErrorReason,
  ReserveErrorCode,
  ResultMessage,
  RoomMessage,
  ServerMessage,
  SnapMessage,
} from './protocol.ts';
import {
  anyConnected,
  newRoom,
  newSeat,
  nextDeadline,
  loadRoom,
  MIN_CLIENT_VERSION,
  publicSignature,
  reserveAllowed,
  type BattleRecord,
  type Deploy,
  type RoomState,
  type Seat,
} from './state.ts';
import { LAG_RESET_TICKS, MAX_STEPS_PER_CALL, SAVE_EVERY_TICKS, SNAP_EVERY_TICKS, type Timing } from './timing.ts';
import { MAX_MESSAGE_LENGTH, isPid, normalizeName, parseClientMessage, parseClientVersion } from './validate.ts';

const ROOM_KEY = 'room';
const BATTLE_KEY = 'battle';
/** 1つの部屋に同時に開ける接続の数（入り直しの途中で古い接続が残っている間を含む） */
const MAX_SOCKETS = 8;
/** メッセージの頻度の上限（接続ごと）。下書きは0.5秒に1回、号令は1戦に3回なので、ふつうの操作では届かない */
const RATE_BURST = 20;
const RATE_PER_SEC = 10;
/** 手桶が空のまま、さらにこれだけ届いたら接続を閉じる（ふつうの操作では起きない量） */
const RATE_OVERFLOW_CLOSE = 20;

const SIDES: readonly Side[] = [0, 1];

/** 接続の添付データ（眠っても残る）。世代と席と接続の番号で、どの席の、いま有効な接続かを見分ける */
type Attachment = { gen: number; seat: Side; conn: number };

type Open = { ws: WebSocket; att: Attachment };

function isAttachment(v: unknown): v is Attachment {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return typeof a['gen'] === 'number' && (a['seat'] === 0 || a['seat'] === 1) && typeof a['conn'] === 'number';
}

function randomId(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 32ビットの乱数（0 を除く）。部屋の世代と接続の番号に使う */
function randomU32(): number {
  for (;;) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    const v = a[0] ?? 0;
    if (v !== 0) return v;
  }
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 1;
}

/** 配置と遊軍の組を検査する（design §7.6。予算・部隊数は戦場の部隊 + 遊軍で数え、遊軍の値は reserveErrors で見る） */
function deployErrors(d: Deploy, zone: Zone): ArmyError[] {
  return validateArmy(d.army, zone, { ...pvpArmyLimits(), reserve: d.reserve });
}

/**
 * 見る人に渡す振り返り（design §7.7）。相手の呼ばなかった遊軍を消し、相手の星の割合を判定の割合と同じ値にする
 * （呼ばなかった遊軍がいたことを、戦いのあとも相手に知らせない）。保存してある振り返りは書き換えず、写しを作る。
 * 遊軍の前に保存した振り返り（項目がない）は、そのまま写す
 */
function summaryFor(viewer: Side, r: BattleSummary): BattleSummary {
  const out: BattleSummary = structuredClone(r);
  const other: Side = viewer === 0 ? 1 : 0;
  if (Array.isArray(out.unusedReserve)) out.unusedReserve[other] = null;
  if (Array.isArray(out.remainingForStars) && Array.isArray(out.remaining)) out.remainingForStars[other] = out.remaining[other];
  return out;
}

/** 遊軍の様子を、決まった項目だけ写す（engine の ReserveView に項目が増えても、勝手に外へ出ないように） */
function reserveViewOf(r: ReserveView | null): ReserveView | null {
  return r === null ? null : { kind: r.kind, stance: r.stance, state: r.state };
}

/** 1つの入力の処理の作業領域 */
class Tx {
  readonly beforeJson: string;
  readonly beforePublic: string;
  /** room と、いまの段階の続き（reveal・snap・result）を送る接続（入ったばかりの人） */
  readonly fullFor = new Set<WebSocket>();
  /** room のあとに送るもの。ws を指定したものはその接続に、しないものは席の全員に、席ごとに作って送る */
  readonly sends: ({ ws: WebSocket; msg: ServerMessage } | { all: (side: Side) => ServerMessage })[] = [];
  /**
   * room より先に、席の全員へ送るもの（決着の result）。決着と同時に不在の席が空いて waiting に戻る場合でも、
   * 「戦いの結果 → 部屋の様子」の順で届くようにする
   */
  readonly early: ((side: Side) => ServerMessage)[] = [];
  readonly closes: { ws: WebSocket; code: CloseCode | 1000; reason: string }[] = [];
  /** アラームが鳴った（保存領域のアラームは消えているので、同じ時刻でも入れ直す） */
  alarmFired = false;

  constructor(
    s: RoomState,
    readonly now: number,
  ) {
    this.beforeJson = JSON.stringify(s);
    this.beforePublic = publicSignature(s);
  }

  error(ws: WebSocket, reason: ErrorReason, message: string, extra?: Pick<ErrorMessage, 'armyErrors' | 'op' | 'code'>): void {
    const msg: ErrorMessage = { type: 'error', reason, message };
    if (extra?.armyErrors !== undefined) msg.armyErrors = extra.armyErrors;
    if (extra?.op !== undefined) msg.op = extra.op;
    if (extra?.code !== undefined) msg.code = extra.code;
    this.sends.push({ ws, msg });
  }

  closing(ws: WebSocket): boolean {
    return this.closes.some((c) => c.ws === ws);
  }
}

export class Room extends DurableObject<Env> {
  /** このインスタンス（メモリ上の Durable Object）の識別子。作り直されると変わる。テスト用の経路でだけ外へ出す */
  private readonly instanceId = randomId();
  private room: RoomState | null;
  /** 戦闘中・公開中の戦闘の状態（保存した "battle" の写し。戦闘中は step で書き換わる） */
  private battle: BattleRecord | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 刻み0にあたる実時刻（design §4.2）。メモリにだけ持ち、作り直されたら保存した刻みから合わせ直す */
  private clockBase = 0;
  /** 届いて、まだ step に渡していない号令 */
  private pendingOrders: OrderInput[] = [];
  /** 届いて、まだ step に渡していない遊軍の入力（陣営ごとに1つまで。design §7.7） */
  private pendingSummons: ReserveInput[] = [];
  /** 前の snap のあとに起きた出来事 */
  private pendingEvents: BattleEvent[] = [];
  private readonly rates = new WeakMap<WebSocket, { tokens: number; at: number; over: number }>();
  /**
   * 見張りのアラームの時刻（戦闘中だけ）。数秒ごとに先へ延ばすので、部屋の記録には書かずメモリにだけ持つ
   * （延ばすたびに部屋の記録を書くと、書き込みの行数が増えるため）。作り直されたら、再開のときに入れ直す
   */
  private watchdogAt: number | null = null;
  /** 入れてあるアラームの時刻（遅らせる分を含む）。メモリにだけ持つ。作り直された直後は不明なので、最初の commit で入れ直す */
  private alarmAt: number | null | undefined = undefined;
  /** テスト用：このインスタンスでの書き込みの回数（保存領域の put・delete と、アラームの設定・削除）と、アラームの処理の回数 */
  private readonly counts = { put: 0, alarmSet: 0, alarmRuns: 0, skippedPastAlarm: 0 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // "ping" には Durable Object を起こさずに "pong" を返す
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    const saved = this.ctx.storage.kv.get<unknown>(ROOM_KEY) ?? null;
    // 盤が変わる前の形（v が 3 以下）の部屋は、配置と戦闘の記録が古い座標なので使わない（design §13.6）。
    // ないものとして扱い（room は null）、下の点検で保存領域とアラームを消す
    this.room = saved === null ? null : loadRoom(saved);
    const stale = saved !== null && this.room === null;
    // 起動時の点検：接続の突き合わせ（再起動で消えた接続）、期限、戦闘の再開。
    // ここで戦闘を再開しておけば、起こしたのが見張りのアラームでも、入り直した人の接続でも同じに続く
    void this.ctx.blockConcurrencyWhile(async () => {
      try {
        // 古い部屋は、部屋を片付けるときと同じ処理で消す。blockConcurrencyWhile の中で待つので、消し終わる前に
        // 入室や部屋の作成が割り込んで、作った新しい部屋を遅れた削除が消すことはない
        if (stale) {
          await this.wipe();
          return;
        }
        const s = this.room;
        if (s === null) return;
        const tx = new Tx(s, Date.now());
        this.ensureBattle(tx);
        this.settle(tx);
        this.commit(tx);
      } catch (e) {
        console.error('startup check failed', e);
      }
    });
  }

  // ---------- 接続の一覧 ----------

  private attachment(ws: WebSocket): Attachment | null {
    try {
      const a: unknown = ws.deserializeAttachment();
      return isAttachment(a) ? a : null;
    } catch {
      return null;
    }
  }

  /** いまの世代の、開いている接続（添付データから組み立て直す） */
  private openSockets(): Open[] {
    const s = this.room;
    const out: Open[] = [];
    if (s === null) return out;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const att = this.attachment(ws);
      if (att !== null && att.gen === s.gen) out.push({ ws, att });
    }
    return out;
  }

  /** その席の、いま有効な接続か（同じ pid で入り直す前の古い接続は含まない） */
  private isCurrent(s: RoomState, att: Attachment): boolean {
    return att.gen === s.gen && s.seats[att.seat]?.conn === att.conn;
  }

  private currentSockets(tx: Tx): Open[] {
    const s = this.room;
    if (s === null) return [];
    return this.openSockets().filter((o) => !tx.closing(o.ws) && this.isCurrent(s, o.att));
  }

  // ---------- RPC（Worker から） ----------

  /**
   * 部屋を作る（design §4.3）。部屋がないときだけ、世代を乱数で決めて reserved にし、作った人の pid を覚える。
   * 空きの確認と予約を、await を挟まない1回の処理で行う（同時に来た2つの作成が両方通ることはない）。
   */
  async create(code: string, pid: string, timing: Timing, testMap: string | null = null, testSeed: number | null = null): Promise<boolean> {
    if (this.room !== null) return false;
    if (!isPid(pid)) return false;
    const now = Date.now();
    const s = newRoom(code, randomU32(), timing);
    const tx = new Tx(s, now);
    s.seats = [newSeat(pid, ''), null];
    s.deadlines.reserve = now + timing.reserveMs;
    s.testMap = testMap;
    s.testSeed = testSeed;
    this.room = s;
    this.battle = null;
    this.settle(tx);
    this.commit(tx);
    return true;
  }

  /**
   * この pid が、いまこの部屋の席にいるか（design §11.1）。Worker が、入室の回数に数えるかを決めるために聞く。
   * 部屋がない・その pid の席がないときは false。何も書き換えない（settle・commit を呼ばず、保存もアラームも触らない）。
   * 席にいない人が聞いただけで、部屋が作られたり長生きしたりしないように。
   * 保存のある部屋を起こしたときの constructor の点検（戦闘の再開と見張り）は、これとは別に、聞く前に走る（design §11.5-4）
   */
  async isSeated(pid: string): Promise<boolean> {
    const s = this.room;
    if (s === null || !isPid(pid)) return false;
    return s.seats.some((x) => x !== null && x.pid === pid);
  }

  /** テスト用：インスタンスの識別子（作り直されたかを確かめる） */
  async instance(): Promise<string> {
    return this.instanceId;
  }

  /** テスト用：アラームの処理をいま実行する（2回鳴った場合の確認） */
  async runAlarmNow(): Promise<void> {
    await this.alarm();
  }

  /**
   * テスト用：刻みを手で進める（timing.testManualTicks が 1 の部屋だけ。戦闘中でなければ何もしない）。
   * 実時間で刻むときと同じ処理（advance）を、steps 回ぶん通す。進めたあとの刻みを返す
   */
  async stepNow(steps: number): Promise<number | null> {
    const s = this.room;
    if (s === null || s.timing.testManualTicks !== 1 || s.phase !== 'battle') return this.battle?.state.tick ?? null;
    const tx = new Tx(s, Date.now());
    this.ensureBattle(tx);
    this.settle(tx);
    this.commit(tx);
    this.advance(Math.max(0, Math.min(steps, 100)), Date.now());
    return this.battle?.state.tick ?? null;
  }

  /** テスト用：保存してある内容（段階・成績・保存した刻み）と、メモリの刻み */
  async debugState(): Promise<unknown> {
    const s = this.ctx.storage.kv.get<RoomState>(ROOM_KEY) ?? null;
    const b = this.ctx.storage.kv.get<BattleRecord>(BATTLE_KEY) ?? null;
    return {
      instance: this.instanceId,
      phase: s?.phase ?? null,
      battleNo: s?.battleNo ?? null,
      score: s?.score ?? null,
      deadlines: s?.deadlines ?? null,
      savedTick: b?.state.tick ?? null,
      savedBattleNo: b?.battleNo ?? null,
      liveTick: this.battle?.state.tick ?? null,
      running: this.timer !== null,
      gen: s?.gen ?? null,
      alarm: await this.ctx.storage.getAlarm(),
      watchdogAt: this.watchdogAt,
      keys: [...this.ctx.storage.kv.list()].length,
      counts: { ...this.counts },
    };
  }

  /**
   * テスト用：保存してある部屋の形の版（v）だけを書き換える（盤が変わる前の部屋を作るため。design §13.6）。
   * メモリの部屋はそのままなので、続けて abortNow で作り直させ、読み込みの処理を通す。保存した部屋がなければ false
   */
  async setSavedVersionNow(v: number): Promise<boolean> {
    const saved = this.ctx.storage.kv.get<RoomState>(ROOM_KEY);
    if (saved === undefined) return false;
    this.ctx.storage.kv.put(ROOM_KEY, { ...saved, v });
    return true;
  }

  /** テスト用：Durable Object を作り直させる（メモリの中身と setInterval が消える。保存領域とアラームは残る） */
  async abortNow(): Promise<void> {
    this.ctx.abort('test: reset the Durable Object');
  }

  // ---------- 入室 ----------

  override async fetch(request: Request): Promise<Response> {
    try {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
      const url = new URL(request.url);
      const pid = url.searchParams.get('pid');
      const name = normalizeName(url.searchParams.get('name'));
      if (!isPid(pid) || name === null) return new Response('bad pid or name', { status: 400 });
      if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('too many connections', { status: 503 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      // 断るときも、いったん受けてから error を送って閉じる（ブラウザは upgrade の失敗の理由を読めないため）
      this.ctx.acceptWebSocket(server);
      // 古い版の画面は、部屋や席を見る前に断る（design §13.6）。保存領域にも、席のいまの接続にも触れない
      const cv = parseClientVersion(url.searchParams.get('cv'));
      if (cv < MIN_CLIENT_VERSION) {
        this.reject(server, 'outdated', 1008);
        return new Response(null, { status: 101, webSocket: client });
      }
      const s = this.room;
      if (s === null) {
        // 部屋がない。保存領域には何も書かない（存在しないコードを叩かれるたびに書き込みが増えないように）
        this.reject(server, 'not_found', 4003);
        return new Response(null, { status: 101, webSocket: client });
      }
      const tx = new Tx(s, Date.now());
      this.ensureBattle(tx);
      const side = this.seatFor(s, pid);
      if (side === 'not_found' || side === 'full') {
        this.reject(server, side, side === 'full' ? 4002 : 4003);
        return new Response(null, { status: 101, webSocket: client });
      }
      this.join(tx, server, side, pid, name, cv);
      this.settle(tx);
      this.commit(tx);
      return new Response(null, { status: 101, webSocket: client });
    } catch (e) {
      console.error('fetch failed', e);
      return new Response('internal error', { status: 500 });
    }
  }

  private reject(ws: WebSocket, reason: 'not_found' | 'full' | 'outdated', code: CloseCode): void {
    const message = reason === 'full' ? 'the room is full' : reason === 'outdated' ? 'please reload the page' : 'no such room';
    const msg: ErrorMessage = { type: 'error', reason, message };
    this.safeSend(ws, JSON.stringify(msg));
    this.safeClose(ws, code, reason);
  }

  /** 入る席を決める（design §4.3「入る」） */
  private seatFor(s: RoomState, pid: string): Side | 'not_found' | 'full' {
    const mine = SIDES.find((i) => s.seats[i]?.pid === pid);
    if (s.phase === 'reserved') return mine === 0 ? 0 : 'not_found';
    if (mine !== undefined) return mine;
    // 新しい人が空いた席に着けるのは、相手を待っている間だけ
    if (s.phase === 'waiting') {
      const free = SIDES.find((i) => s.seats[i] === null);
      if (free !== undefined) return free;
    }
    return 'full';
  }

  private join(tx: Tx, ws: WebSocket, side: Side, pid: string, name: string, cv: number): void {
    const s = this.room;
    if (s === null) return;
    let seat = s.seats[side];
    if (seat === null) {
      seat = newSeat(pid, name, cv);
      s.seats[side] = seat;
    }
    // client の版は下げない（design §7.7）。同じ席（同じ pid）が、いまより小さい cv（cv なしを含む）で入り直しても、
    // 大きいほうのまま（接続は受け付ける）。下げると、古い画面を装って入り直すだけで、相手の遊軍を封じられるため。
    // 本物の利用者が新しい画面から古い画面へ戻ることは起きない。席が空いて別の人が座ったときは、newSeat でその人の cv から始まる
    seat.cv = Math.max(seat.cv, cv);
    // 自分で出た人が、席が残っているうちに（戦闘中・結果の leftMs の前）同じ pid で入り直した：ふつうの入り直しとして扱い、
    // 出た印と、その席を空ける期限を消す（design §11.5-2）
    if (seat.left) {
      seat.left = false;
      delete s.deadlines.left;
    }
    // 1つの席に有効な接続は1つ。古い接続は閉じ、その「切れた」の知らせは接続の番号の違いで無視する
    for (const o of this.openSockets()) {
      if (o.ws !== ws && o.att.seat === side) tx.closes.push({ ws: o.ws, code: 4001, reason: 'replaced by a newer connection' });
    }
    // 接続の番号は乱数（片付けで記録を残さないので、通し番号にはできない）。前の接続と同じ値は避ける
    let conn = randomU32();
    while (conn === seat.conn) conn = randomU32();
    seat.conn = conn;
    seat.goneSince = null;
    seat.name = name;
    const att: Attachment = { gen: s.gen, seat: side, conn: seat.conn };
    ws.serializeAttachment(att);
    tx.fullFor.add(ws);
    if (s.phase === 'reserved') {
      s.phase = 'waiting';
      delete s.deadlines.reserve;
    }
    if (s.phase === 'waiting' && s.seats[0] !== null && s.seats[1] !== null) this.startSetup(tx);
  }

  // ---------- メッセージ ----------

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      if (raw === 'ping') {
        // 自動応答が効かなかった場合の保険
        this.safeSend(ws, 'pong');
        return;
      }
      // 大きさの超過とバイナリは、すぐ閉じる。頻度の超過は、続いたら閉じる。閉じた席は「切れた」として扱う（同じ pid で入り直せる）
      if (typeof raw !== 'string') {
        this.kick(ws, 1003, 'binary messages are not accepted');
        return;
      }
      if (raw.length > MAX_MESSAGE_LENGTH) {
        this.kick(ws, 1009, 'message too large');
        return;
      }
      const rate = this.takeToken(ws);
      if (rate === 'close') {
        this.kick(ws, 1008, 'too many messages');
        return;
      }
      if (rate === 'drop') return;
      const s = this.room;
      const att = this.attachment(ws);
      if (s === null || att === null || att.gen !== s.gen) {
        this.safeClose(ws, 4003, 'room closed');
        return;
      }
      if (!this.isCurrent(s, att)) {
        this.safeClose(ws, 4001, 'replaced by a newer connection');
        return;
      }
      const msg = parseClientMessage(raw);
      // 形の違うメッセージは黙って捨てる
      if (msg === null) return;
      const tx = new Tx(s, Date.now());
      this.ensureBattle(tx);
      this.handle(tx, ws, att.seat, msg);
      this.settle(tx);
      this.commit(tx);
    } catch (e) {
      console.error('webSocketMessage failed', e);
    }
  }

  /**
   * 頻度の上限（接続ごとの手桶）。メモリにだけ持つ（眠ると満タンに戻るが、それで困ることはない）。
   * 手桶が空なら捨て、空のままさらに RATE_OVERFLOW_CLOSE 通届いたら閉じる
   */
  private takeToken(ws: WebSocket): 'ok' | 'drop' | 'close' {
    const now = Date.now();
    const r = this.rates.get(ws) ?? { tokens: RATE_BURST, at: now, over: 0 };
    r.tokens = Math.min(RATE_BURST, r.tokens + ((now - r.at) / 1000) * RATE_PER_SEC);
    r.at = now;
    this.rates.set(ws, r);
    if (r.tokens < 1) {
      r.over += 1;
      return r.over >= RATE_OVERFLOW_CLOSE ? 'close' : 'drop';
    }
    r.tokens -= 1;
    r.over = 0;
    return 'ok';
  }

  /** 決まりを破った接続を閉じる。いま有効な接続なら、その席を「切れた」にする */
  private kick(ws: WebSocket, code: CloseCode, reason: string): void {
    const s = this.room;
    if (s === null) {
      this.safeClose(ws, code, reason);
      return;
    }
    const att = this.attachment(ws);
    const tx = new Tx(s, Date.now());
    if (att !== null && this.isCurrent(s, att)) {
      const seat = s.seats[att.seat];
      if (seat !== null) {
        seat.conn = null;
        seat.goneSince = tx.now;
      }
    }
    tx.closes.push({ ws, code, reason });
    this.settle(tx);
    this.commit(tx);
  }

  /**
   * 受け付ける段階と battleNo を確かめてから処理する（design §4.4）。それ以外は黙って捨てる
   * （前の戦いから遅れて届いたメッセージが、今の戦いに効かないようにする）。
   */
  private handle(tx: Tx, ws: WebSocket, side: Side, msg: ClientMessage): void {
    const s = this.room;
    if (s === null) return;
    const seat = s.seats[side];
    if (seat === null) return;
    const field = fieldOf(s.map);
    switch (msg.type) {
      case 'draft': {
        if (s.phase !== 'setup' || seat.ready) return;
        // 遊軍を使えない部屋では、遊軍つきの下書きを組ごと捨てる（配置だけを受け取ることもしない。組で扱うため）
        if (msg.reserve != null && !reserveAllowed(s)) {
          tx.error(ws, 'reserve_disabled', 'reserves are not available in this room');
          return;
        }
        this.takeDraft(seat, side, { army: msg.army, reserve: msg.reserve ?? null }, field);
        return;
      }
      case 'ready': {
        if (s.phase !== 'setup' || seat.ready) return;
        // army を付けたときは、同じメッセージの reserve（省略なら「なし」）と組にする。付けなければ、いまの下書きの組のまま
        if (msg.army !== undefined) {
          if (msg.reserve != null && !reserveAllowed(s)) {
            tx.error(ws, 'reserve_disabled', 'reserves are not available in this room');
            return;
          }
          this.takeDraft(seat, side, { army: msg.army, reserve: msg.reserve ?? null }, field);
        }
        const draft = seat.draft;
        if (draft === null) {
          tx.error(ws, 'invalid_army', 'no army to confirm');
          return;
        }
        // 遊軍を使えなくなった部屋では、下書きの遊軍を settle で外しているので、ここには来ないはず（念のため断る）
        if (draft.reserve !== null && !reserveAllowed(s)) {
          tx.error(ws, 'reserve_disabled', 'reserves are not available in this room');
          return;
        }
        const errors = deployErrors(draft, field.zones[side]);
        if (errors.length > 0) {
          tx.error(ws, 'invalid_army', 'the army is not valid', { armyErrors: errors });
          return;
        }
        seat.lastValid = draft;
        seat.ready = true;
        return;
      }
      case 'unready':
        if (s.phase === 'setup') seat.ready = false;
        return;
      case 'order': {
        if (s.phase !== 'battle' || msg.battleNo !== s.battleNo) return;
        const b = this.battle;
        if (b === null || b.battleNo !== s.battleNo) return;
        const r = canOrder(b.state, side, msg.target, msg.kind);
        // まだ step に渡していない号令も回数に数える（4回目を受け付けない。
        // engine は1刻みに先頭8件しか見ないので、片方が詰め込んで相手の号令を押し出すこともできなくなる）
        const pending = this.pendingOrders.filter((o) => o.side === side).length;
        const left = MAX_ORDERS - b.state.ordersUsed[side];
        if (!r.ok) {
          tx.error(ws, 'invalid_order', r.error.message);
          return;
        }
        if (pending >= left) {
          tx.error(ws, 'invalid_order', 'no orders left');
          return;
        }
        this.pendingOrders.push({ side, target: msg.target, kind: msg.kind });
        return;
      }
      case 'reserve': {
        // 受け付けの作りは号令と同じ（design §7.7）。段階と battleNo が違えば黙って捨てる
        if (s.phase !== 'battle' || msg.battleNo !== s.battleNo) return;
        const b = this.battle;
        if (b === null || b.battleNo !== s.battleNo) return;
        // 遊軍を使えるかは、戦いを作った時点の可否（rec.reserveOk）で決め、その戦いが終わるまで変えない（design §7.7）。
        // 受け付けたあとに渡す刻みで扱いが変わらないよう、step に渡すときは見直さない。遊軍の前の記録（項目なし）は使えない扱い
        if (b.reserveOk !== true) {
          tx.error(ws, 'reserve_disabled', 'reserves are not available in this room', { op: 'reserve' });
          return;
        }
        const r = canSummon(b.state, side, msg.from);
        if (!r.ok) {
          tx.error(ws, 'invalid_reserve', r.error.message, { op: 'reserve', code: r.error.code as ReserveErrorCode });
          return;
        }
        // まだ step に渡していない入力は陣営ごとに1つまで（2つ目は渡さない。号令の4回目と同じく、本人にだけ断りを返す）
        if (this.pendingSummons.some((o) => o.side === side)) {
          tx.error(ws, 'invalid_reserve', 'a reserve call is already pending', { op: 'reserve', code: 'no_reserve' });
          return;
        }
        this.pendingSummons.push({ side, from: msg.from });
        return;
      }
      case 'rematch': {
        if (s.phase !== 'result' || msg.battleNo !== s.battleNo) return;
        // 相手が自分で出ていれば、「2人とも押したか」を見る前に、待たずにその席を空けて待機へ戻す（design §11.5-2）
        if (s.seats.some((x) => x?.left === true)) {
          this.toWaiting(true);
          return;
        }
        s.rematch[side] = true;
        if (s.rematch[0] && s.rematch[1]) this.startSetup(tx);
        return;
      }
      case 'leave':
        this.leave(tx, ws, side);
        return;
    }
  }

  /**
   * 自分で部屋を出た（design §11.2）。ただ切れたのとは別に扱う。どの段階でも、その接続は server から閉じる（1000）。
   *   waiting：席を空ける。
   *   setup・result：席を空けて待機に戻す（不在で席を空けるときと同じ後始末。残った席があれば opponentLeft を立てる）。
   *   reveal・battle：公開したあとは戦いを最後まで進めるので、席は残して left を立てる（号令が出ないだけ。design §11.5-10）。
   *     結果に入ったあと、残った人の rematch か leftMs で席を空ける（settle）
   */
  private leave(tx: Tx, ws: WebSocket, side: Side): void {
    const s = this.room;
    const seat = s?.seats[side] ?? null;
    if (s === null || seat === null) return;
    tx.closes.push({ ws, code: 1000, reason: 'left the room' });
    switch (s.phase) {
      case 'waiting':
        s.seats[side] = null;
        if (s.seats.every((x) => x === null)) s.opponentLeft = false;
        return;
      case 'setup':
      case 'result':
        s.seats[side] = null;
        this.toWaiting(true);
        return;
      case 'reveal':
      case 'battle':
        seat.left = true;
        seat.conn = null;
        seat.goneSince = tx.now;
        return;
      case 'reserved':
        // 席に着いた接続は waiting から始まるので、ここには来ない
        return;
    }
  }

  /**
   * 「自分が下」の座標で届いた下書きの組を、戦場の座標にして持つ。組ごと検査を通れば lastValid にもする
   * （配置だけ、遊軍だけを入れ替えることはしない）。遊軍の値は座標を持たないので返さない
   */
  private takeDraft(seat: Seat, side: Side, d: Deploy, field: Field): void {
    const placed: Deploy = { army: placementsFor(side, d.army, field), reserve: d.reserve === null ? null : { kind: d.reserve.kind, stance: d.reserve.stance } };
    seat.draft = placed;
    if (deployErrors(placed, field.zones[side]).length === 0) seat.lastValid = placed;
  }

  // ---------- 切断 ----------

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.onSocketGone(ws);
    this.safeClose(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.onSocketGone(ws);
  }

  private onSocketGone(ws: WebSocket): void {
    try {
      const s = this.room;
      if (s === null) return;
      const att = this.attachment(ws);
      const tx = new Tx(s, Date.now());
      this.ensureBattle(tx);
      // いま有効な接続の「切れた」だけを扱う（入り直したあとに、古い接続の知らせで切断扱いにしない）
      if (att !== null && this.isCurrent(s, att)) {
        const seat = s.seats[att.seat];
        if (seat !== null) {
          seat.conn = null;
          seat.goneSince = tx.now;
        }
      }
      tx.closes.push({ ws, code: 1000, reason: 'closed' });
      this.settle(tx);
      this.commit(tx);
    } catch (e) {
      console.error('socket close handling failed', e);
    }
  }

  // ---------- アラーム ----------

  override async alarm(): Promise<void> {
    this.counts.alarmRuns += 1;
    // アラームは鳴ると消える
    this.alarmAt = null;
    const s = this.room;
    if (s === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    const d = s.deadlines;
    // 段階を移す前に、いまの段階と期限を確かめる（2回呼ばれても、2回目は条件に合わず何もしない）
    if (
      (s.phase === 'reserved' && d.reserve !== undefined && now >= d.reserve) ||
      (s.phase !== 'battle' && d.idle !== undefined && now >= d.idle && !anyConnected(s))
    ) {
      await this.wipe();
      return;
    }
    const tx = new Tx(s, now);
    tx.alarmFired = true;
    if (s.phase === 'setup' && d.setup !== undefined && now >= d.setup) {
      this.toReveal(tx);
    } else if (s.phase === 'reveal' && d.reveal !== undefined && now >= d.reveal) {
      this.toBattle(tx);
    } else if (s.phase === 'battle') {
      // 見張り：作り直された直後なら、ここで戦闘を再開する（誰もつながっていなくても最後まで進める）。
      // 動いていれば、次の見張りを入れ直すだけ
      this.ensureBattle(tx);
      if (this.room?.phase === 'battle') this.watchdogAt = now + s.timing.watchdogMs;
    }
    this.settle(tx);
    this.commit(tx);
  }

  /**
   * 部屋を片付ける（design §4.3）。保存領域を全部消し、アラームも消す。何も残さないので、次にこのコードで作る部屋は
   * 世代を乱数で決め直す（前の部屋の接続が残っていても、添付データの世代が合わず効かない）
   */
  private async wipe(): Promise<void> {
    this.stopTimer();
    for (const ws of this.ctx.getWebSockets()) this.safeClose(ws, 4003, 'room closed');
    this.room = null;
    this.battle = null;
    this.watchdogAt = null;
    this.pendingOrders = [];
    this.pendingSummons = [];
    this.pendingEvents = [];
    this.alarmAt = null;
    this.counts.alarmSet += 1;
    this.counts.put += 1;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---------- 段階の移り変わり ----------

  private startSetup(tx: Tx): void {
    const s = this.room;
    if (s === null) return;
    s.phase = 'setup';
    s.map = pickMap(s.testMap);
    s.deadlines.setup = tx.now + s.timing.setupMs;
    delete s.deadlines.reveal;
    delete s.deadlines.away;
    delete s.deadlines.left;
    s.rematch = [false, false];
    // 新しい相手と（または同じ相手ともう一戦）配置に入った。待機に戻ったわけの知らせは、もう要らない
    s.opponentLeft = false;
    for (const seat of s.seats) {
      if (seat === null) continue;
      seat.ready = false;
      seat.draft = null;
      seat.lastValid = null;
    }
  }

  /**
   * 部屋を待機に戻す、ただ1つの後始末（design §11.5-5）。不在で席を空けたとき・自分で出た人の席を空けたときに使う。
   * 呼ぶ側が、空ける席を null にしてから呼ぶ。自分で出た席（left）も、ここで一緒に空ける（待機に残すと席が埋まったままになり、
   * 新しい人が入れないため）。成績・結果・もう一戦・両席の確定と下書き、段階の期限（setup・reveal・away・left）を消す。
   * 誰もいないときの期限（idle）と次のアラームは、このあとのいつもの settle・commit で決め直す。
   * byLeave：相手が自分で出たために戻すか。残った席があるときだけ opponentLeft を立てる（不在で戻すときは立てない）
   */
  private toWaiting(byLeave: boolean): void {
    const s = this.room;
    if (s === null) return;
    for (const side of SIDES) if (s.seats[side]?.left === true) s.seats[side] = null;
    // 配置の途中から戻るときは、対戦の番号を進める。client は配置を「コード + 番号」で見分けていて、番号は公開に入るまで増えない。
    // 進めないと、公開の前から開いたままの古い画面（待機で配置の覚えを捨てない）が、次の相手との配置を前の続きと取り違え、
    // 前の「完了」を送り直してしまう（結果から戻るときは、公開のときに番号が進んでいるので要らない）
    if (s.phase === 'setup') s.battleNo += 1;
    s.phase = 'waiting';
    s.score = [0, 0, 0];
    s.lastResult = null;
    s.rematch = [false, false];
    for (const seat of s.seats) {
      if (seat === null) continue;
      seat.ready = false;
      seat.draft = null;
      seat.lastValid = null;
    }
    delete s.deadlines.setup;
    delete s.deadlines.reveal;
    delete s.deadlines.away;
    delete s.deadlines.left;
    s.opponentLeft = byLeave && s.seats.some((x) => x !== null);
  }

  /** 既定の編成（PVP_RULES.standardRoster）を横陣で並べる。applyTemplate は戦場の座標で返す */
  private defaultArmy(side: Side, field: Field): Placement[] {
    return applyTemplate('line', PVP_RULES.standardRoster, field.zones[side], side);
  }

  private toReveal(tx: Tx): void {
    const s = this.room;
    if (s === null || s.phase !== 'setup') return;
    const field = fieldOf(s.map);
    // 確定した人は確定した組、していない人は最後に検査を通った下書きの組、それもなければ既定の編成で遊軍なし（assumptions S8）。
    // 配置と遊軍は組で選ぶ（design §7.7）。遊軍を使えない部屋では遊軍を外す（settle で外してあるはずだが、念のため）
    const allowed = reserveAllowed(s);
    const armies = SIDES.map((side) => s.seats[side]?.lastValid?.army ?? this.defaultArmy(side, field)) as [Placement[], Placement[]];
    const reserves = SIDES.map((side) => (allowed ? (s.seats[side]?.lastValid?.reserve ?? null) : null)) as [ReserveSetup | null, ReserveSetup | null];
    // 遊軍がどちらにもなければ、reserves の項目を書かない（遊軍のない戦いを、いままでとまったく同じ設定で作る。design §7.1）
    const make = () =>
      createBattle({
        field,
        armies,
        // テスト専用の決めた種（本番は常に null で、毎回乱数）
        seed: s.testSeed ?? randomSeed(),
        maxTicks: s.timing.maxTicks,
        timeout: 'compare',
        ...(reserves[0] !== null || reserves[1] !== null ? { reserves } : {}),
      });
    let created = make();
    if (!created.ok && created.error.side !== undefined) {
      // 検査を通った組しか持たないので起きないはずだが、起きても戦いは始める（その陣営は既定の編成・遊軍なしにする）
      console.error('createBattle rejected an army', created.error);
      armies[created.error.side] = this.defaultArmy(created.error.side, field);
      reserves[created.error.side] = null;
      created = make();
    }
    if (!created.ok) {
      console.error('createBattle failed', created.error);
      return;
    }
    s.battleNo += 1;
    s.phase = 'reveal';
    delete s.deadlines.setup;
    s.deadlines.reveal = tx.now + s.timing.revealMs;
    for (const seat of s.seats) if (seat !== null) seat.ready = false;
    const rec: BattleRecord = {
      battleNo: s.battleNo,
      armies,
      reserves,
      reserveOk: allowed,
      startsAt: s.deadlines.reveal,
      state: created.value,
      evCount: 0,
    };
    this.battle = rec;
    this.put(BATTLE_KEY, rec);
    tx.sends.push({ all: (side) => this.revealMsg(side, rec, field) });
  }

  private toBattle(tx: Tx): void {
    const s = this.room;
    if (s === null || s.phase !== 'reveal') return;
    const rec = this.loadBattle();
    if (rec === null) {
      console.error('no battle record at reveal end');
      return;
    }
    s.phase = 'battle';
    delete s.deadlines.reveal;
    this.watchdogAt = tx.now + s.timing.watchdogMs;
    this.startTimer(rec, tx.now);
  }

  private loadBattle(): BattleRecord | null {
    const s = this.room;
    if (s === null) return null;
    if (this.battle !== null && this.battle.battleNo === s.battleNo) return this.battle;
    const rec = this.ctx.storage.kv.get<BattleRecord>(BATTLE_KEY) ?? null;
    if (rec === null || rec.battleNo !== s.battleNo) return null;
    // 通し番号を持たない古い記録（この変更の前に保存したもの）は 0 から数える
    if (typeof rec.evCount !== 'number') rec.evCount = 0;
    this.battle = rec;
    return rec;
  }

  /**
   * 戦闘を動かす（何回呼んでも同じ結果）。戦闘中なのに setInterval が動いていなければ（作り直された直後）、
   * 保存した刻みから続ける。保存した状態がすでに決着していれば、結果の段階へ移す。
   */
  private ensureBattle(tx: Tx): void {
    const s = this.room;
    if (s === null || s.phase !== 'battle') return;
    if (this.timer !== null) return;
    // 作り直された直後。見張りを入れ直してから再開する
    this.watchdogAt = tx.now + s.timing.watchdogMs;
    const rec = this.loadBattle();
    if (rec === null) {
      console.error('battle phase without a battle record');
      return;
    }
    if (rec.state.outcome !== null) {
      this.finish(tx, rec);
      return;
    }
    this.startTimer(rec, tx.now);
  }

  private startTimer(rec: BattleRecord, now: number): void {
    const s = this.room;
    if (s === null) return;
    this.stopTimer();
    this.battle = rec;
    // 追いかけない：保存した刻みが「いま」になるように時計を合わせる（design §4.2「作り直されたあとの再開」）
    this.clockBase = now - rec.state.tick * s.timing.tickMs;
    this.pendingEvents = [];
    this.pendingOrders = [];
    this.pendingSummons = [];
    this.timer = setInterval(() => this.onTick(), s.timing.tickMs);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * setInterval から呼ばれる。実時間に追いつく分だけ step を呼ぶ（1回に最大5刻み）。
   * テストで刻みを手で進める部屋（timing.testManualTicks が 1）では、ここでは進めない（stepNow で進める）
   */
  private onTick(): void {
    const s = this.room;
    const rec = this.battle;
    if (s === null || s.phase !== 'battle' || rec === null || rec.battleNo !== s.battleNo) {
      this.stopTimer();
      return;
    }
    if (s.timing.testManualTicks === 1) return;
    const now = Date.now();
    const due = Math.floor((now - this.clockBase) / s.timing.tickMs) - rec.state.tick;
    this.advance(Math.min(Math.max(due, 0), MAX_STEPS_PER_CALL), now);
  }

  /** steps 回 step を呼び、保存・決着・snap の送信まで行う（実時間で刻むときも、テストで手で進めるときも、これを通す） */
  private advance(steps: number, now: number): void {
    try {
      const s = this.room;
      const rec = this.battle;
      if (s === null || s.phase !== 'battle' || rec === null || rec.battleNo !== s.battleNo) return;
      const st = rec.state;
      const tickMs = s.timing.tickMs;
      let save = false;
      let snap = false;
      for (let i = 0; i < steps && st.outcome === null; i++) {
        // 号令と遊軍の入力は、届いた次の step に渡す（engine は遊軍を先に呼び、続けて号令を受け付ける。design §7.3）
        const orders = this.pendingOrders;
        this.pendingOrders = [];
        const summons = this.pendingSummons;
        this.pendingSummons = [];
        const events = summons.length > 0 ? step(st, orders, summons) : step(st, orders);
        for (const e of events) this.pendingEvents.push(e);
        // 出来事の通し番号は、state と同じ記録に持つ（保存した刻みと、そこまでの出来事の数が必ずそろう）
        rec.evCount += events.length;
        // 号令を受け付けた step と、遊軍が現れた step の直後は書く（作り直されても、使った回数が巻き戻らず、
        // 相手に見せた遊軍が消えて二度呼べることがないように。design §7.7）
        if (events.some((e) => e.type === 'order' || e.type === 'reserve')) save = true;
        if (st.tick % SAVE_EVERY_TICKS === 0) save = true;
        if (st.tick % SNAP_EVERY_TICKS === 0) snap = true;
      }
      if (st.outcome !== null) {
        const tx = new Tx(s, now);
        this.finish(tx, rec);
        this.settle(tx);
        this.commit(tx);
        return;
      }
      // それでも大きく遅れていたら追いかけず、止まっていたことにする（design §4.2）
      if (Math.floor((now - this.clockBase) / tickMs) - st.tick > LAG_RESET_TICKS) this.clockBase = now - st.tick * tickMs;
      // 保存が要る刻みでは、保存してから送る（相手に見せた号令が、作り直されたあとに巻き戻らないように）
      if (save) {
        this.put(BATTLE_KEY, rec);
        // 見張りの期限を先へ延ばす。アラームの入れ直しも1行の書き込みになるので、保存と同じ機会に、残りが半分を切ったときだけ
        const w = this.watchdogAt;
        if (w === null || w - now < s.timing.watchdogMs / 2) {
          const tx = new Tx(s, now);
          this.watchdogAt = now + s.timing.watchdogMs;
          this.commit(tx);
        }
      }
      if (snap) this.broadcastSnap(rec);
    } catch (e) {
      console.error('tick failed', e);
    }
  }

  /** 決着。戦闘の状態と部屋の状態（結果・成績）を、await を挟まず続けて書く。成績は phase が battle のときだけ足す */
  private finish(tx: Tx, rec: BattleRecord): void {
    const s = this.room;
    if (s === null || s.phase !== 'battle' || rec.state.outcome === null) return;
    this.stopTimer();
    this.put(BATTLE_KEY, rec);
    // 決着した刻みは、2刻みを待たずにすぐ送る
    this.broadcastSnap(rec);
    const o = rec.state.outcome;
    if (o.winner === 0) s.score[0] += 1;
    else if (o.winner === 1) s.score[1] += 1;
    else s.score[2] += 1;
    s.phase = 'result';
    s.lastResult = summarize(rec.state);
    s.rematch = [false, false];
    this.watchdogAt = null;
    this.pendingOrders = [];
    this.pendingSummons = [];
    // 結果は見る人ごとに作る（相手の呼ばなかった遊軍を消す。design §7.7）。いま作っておく
    // （送るのは settle のあと。不在の席が空くと lastResult が消えるため、送るときに作ると作れない）
    const results = [this.resultMsg(s, 0), this.resultMsg(s, 1)] as const;
    tx.early.push((side) => results[side]);
  }

  /**
   * 入力のたびに行う点検：接続と席の突き合わせ、2人の確定、不在の席、片付けの期限。
   * ここも何回呼んでも同じ結果になる（期限と今の時刻と段階だけを見る）。
   */
  private settle(tx: Tx): void {
    const s = this.room;
    if (s === null) return;
    const now = tx.now;
    // つながっているはずなのに接続がない席（開発サーバーの再起動などで「切れた」の知らせが来なかった）
    const open = this.openSockets().filter((o) => !tx.closing(o.ws));
    for (const side of SIDES) {
      const seat = s.seats[side];
      if (seat === null || seat.conn === null) continue;
      if (!open.some((o) => o.att.seat === side && o.att.conn === seat.conn)) {
        seat.conn = null;
        seat.goneSince = now;
      }
    }
    // 遊軍を使えない部屋の setup では、両者の下書きと確定した組から遊軍を外す（design §7.7）。
    // 席の cv は下げないので（join）、同じ顔ぶれのあいだに true から false に変わることはなく、ふだんは何も外れない（念のための守り）。確定はそのまま（取り消すと、遊軍を持っていた側だけ確定が外れ、相手に遊軍があったことが伝わるため）。
    // room は rules.reserve が変わったことで両者に送り直される（publicSignature）。遊軍を外したかどうかでは送り分けない
    if (s.phase === 'setup' && !reserveAllowed(s)) {
      for (const seat of s.seats) {
        if (seat === null) continue;
        if (seat.draft !== null && seat.draft.reserve !== null) seat.draft = { army: seat.draft.army, reserve: null };
        if (seat.lastValid !== null && seat.lastValid.reserve !== null) seat.lastValid = { army: seat.lastValid.army, reserve: null };
      }
    }
    if (s.phase === 'setup' && s.seats[0]?.ready === true && s.seats[1]?.ready === true) this.toReveal(tx);
    // 自分で出た席（design §11.5-2）：result に入ってから leftMs たったら、その席を空けて待機に戻す（残った人が切れていても行う）
    if (s.phase === 'result' && s.deadlines.left !== undefined && now >= s.deadlines.left) this.toWaiting(true);
    // 不在（design §4.3）：result の間、切れてから awayMs たった席を空ける。2人ともなら片付けに任せる。
    // 自分で出た席（left）は数えない（数えると、退出から awayMs より長く戦闘が続いたとき、決着した瞬間に待機へ戻り、
    // 結果を見せる leftMs が飛ぶため）
    if (s.phase === 'result') {
      const away = SIDES.filter((side) => {
        const seat = s.seats[side];
        return seat !== null && !seat.left && seat.conn === null && seat.goneSince !== null && now >= seat.goneSince + s.timing.awayMs;
      });
      if (away.length === 1) {
        s.seats[away[0] as Side] = null;
        this.toWaiting(false);
      }
    }
    // 自分で出た席を空ける期限は、result の間、出た席が1つで、もう1つの席（切れていてもよい）があるときに、まだなければ決める。
    // 一度決めたら延ばさない（保存するので、作り直されても同じ時刻）。2人とも出た（か、席がない）ときは置かず、片付けに任せる
    if (s.phase === 'result' && s.deadlines.left === undefined) {
      const left = s.seats.filter((x) => x?.left === true).length;
      const stay = s.seats.filter((x) => x !== null && !x.left).length;
      if (left === 1 && stay === 1) s.deadlines.left = now + s.timing.leftMs;
    }
    // 次の不在の期限は、まだ来ていないものだけ。2人とも過ぎていたら（片付けに任せる場合）、away は残さない
    // （過ぎた期限を残すと、過去の時刻のアラームを入れ直し続けるため）
    let awayAt: number | null = null;
    if (s.phase === 'result') {
      for (const seat of s.seats) {
        if (seat === null || seat.left || seat.conn !== null || seat.goneSince === null) continue;
        const t = seat.goneSince + s.timing.awayMs;
        if (t > now && (awayAt === null || t < awayAt)) awayAt = t;
      }
    }
    if (awayAt === null) delete s.deadlines.away;
    else s.deadlines.away = awayAt;
    // 片付け：誰もつながっていない状態が続いた時間を、期限で持つ
    if (anyConnected(s)) delete s.deadlines.idle;
    else if (s.deadlines.idle === undefined) s.deadlines.idle = now + s.timing.cleanupMs;
  }

  /** 保存領域へ書く（テスト用に回数を数える） */
  private put(key: string, value: unknown): void {
    this.counts.put += 1;
    this.ctx.storage.kv.put(key, value);
  }

  /** 次に入れるアラームの時刻（期限）。その段階で扱う期限と、戦闘中の見張り */
  private nextAlarm(s: RoomState): number | null {
    let t = nextDeadline(s);
    if (s.phase === 'battle' && this.watchdogAt !== null && (t === null || this.watchdogAt < t)) t = this.watchdogAt;
    return t;
  }

  /** 保存・アラーム・送信。間に await を挟まない */
  private commit(tx: Tx): void {
    const s = this.room;
    if (s === null) return;
    let deadline = this.nextAlarm(s);
    // 安全弁：アラームの処理を終えたあとに、次の期限が今以前のままなら、その期限は処理されないまま残っている。
    // 入れるとすぐ鳴って何もしない、をくり返すので入れずに記録を残す（次の入力の commit でもう一度選び直す）
    if (tx.alarmFired && deadline !== null && deadline <= tx.now) {
      console.error('alarm: a deadline at or before now is still pending after processing; not re-arming', {
        phase: s.phase,
        deadlines: s.deadlines,
        watchdogAt: this.watchdogAt,
      });
      this.counts.skippedPastAlarm += 1;
      deadline = null;
    }
    const want = deadline === null ? null : deadline + s.timing.testAlarmLagMs;
    // 期限が過去なら、覚えている時刻と同じでも入れ直す（アラームの処理が失敗して、やり直しが尽きた場合など）
    const alarmChanged = want !== this.alarmAt || (want !== null && want <= tx.now);
    if (JSON.stringify(s) !== tx.beforeJson) this.put(ROOM_KEY, s);
    if (alarmChanged) {
      this.alarmAt = want;
      this.counts.alarmSet += 1;
      if (want === null) void this.ctx.storage.deleteAlarm();
      else void this.ctx.storage.setAlarm(want);
    }
    const publicChanged = publicSignature(s) !== tx.beforePublic;
    const targets = this.currentSockets(tx);
    for (const make of tx.early) for (const o of targets) this.sendTo(o.ws, make(o.att.seat));
    for (const o of targets) {
      if (publicChanged || tx.fullFor.has(o.ws)) this.sendTo(o.ws, this.roomMsg(s, o.att.seat, tx.now));
    }
    for (const item of tx.sends) {
      if ('ws' in item) this.sendTo(item.ws, item.msg);
      else for (const o of targets) this.sendTo(o.ws, item.all(o.att.seat));
    }
    // 入ったばかりの人には、いまの段階の続きを送る
    for (const o of targets) {
      if (!tx.fullFor.has(o.ws)) continue;
      const field = fieldOf(s.map);
      const rec = s.phase === 'reveal' || s.phase === 'battle' ? this.loadBattle() : null;
      if (s.phase === 'reveal' && rec !== null) this.sendTo(o.ws, this.revealMsg(o.att.seat, rec, field));
      if (s.phase === 'battle' && rec !== null) this.sendTo(o.ws, this.snapMsg(o.att.seat, rec, [], field));
      if (s.phase === 'result' && s.lastResult !== null) this.sendTo(o.ws, this.resultMsg(s, o.att.seat));
    }
    for (const c of tx.closes) this.safeClose(c.ws, c.code, c.reason);
  }

  // ---------- 外へ出す形 ----------

  private roomMsg(s: RoomState, side: Side, now: number): RoomMessage {
    const field = fieldOf(s.map);
    const me = s.seats[side];
    return {
      type: 'room',
      code: s.code,
      // reserved の部屋には、席に着いた接続がない（作った人がつないだ時点で waiting になる）
      phase: s.phase === 'reserved' ? 'waiting' : s.phase,
      battleNo: s.battleNo,
      you: side,
      seats: [this.seatView(s.seats[0]), this.seatView(s.seats[1])],
      score: [s.score[0], s.score[1], s.score[2]],
      deadlines: { setup: s.deadlines.setup ?? null, reveal: s.deadlines.reveal ?? null },
      serverTime: now,
      map: s.map,
      field: fieldFor(side, field),
      rules: {
        budget: PVP_RULES.budget,
        costs: { ...PVP_RULES.costs },
        maxUnits: PVP_RULES.maxUnits,
        standardRoster: { ...PVP_RULES.standardRoster },
        reserve: reserveAllowed(s),
      },
      rematch: [s.rematch[0], s.rematch[1]],
      // 配置と遊軍は、同じ組（最後に検査を通った組）から返す。相手の遊軍は入れない
      myArmy: me?.lastValid ? placementsFor(side, me.lastValid.army, field) : null,
      myReserve: me?.lastValid?.reserve ? { kind: me.lastValid.reserve.kind, stance: me.lastValid.reserve.stance } : null,
      opponentLeft: s.opponentLeft,
    };
  }

  /** 席の見え方。pid と下書きは含めない */
  private seatView(seat: Seat | null): RoomMessage['seats'][number] {
    if (seat === null) return null;
    return { name: seat.name, connected: seat.conn !== null, ready: seat.ready, left: seat.left };
  }

  private revealMsg(side: Side, rec: BattleRecord, field: Field): ServerMessage {
    // 自分の遊軍だけ。相手の遊軍は、あるかないかも含めて入れない（遊軍の前の記録には reserves がない）
    const mine = rec.reserves?.[side] ?? null;
    return {
      type: 'reveal',
      battleNo: rec.battleNo,
      armies: [revealFor(side, 0, rec.armies[0], field), revealFor(side, 1, rec.armies[1], field)],
      myReserve: mine === null ? null : { kind: mine.kind, stance: mine.stance },
      startsAt: rec.startsAt,
      serverTime: Date.now(),
    };
  }

  /**
   * evBase は events の先頭の通し番号。events は、いままでに出た出来事（rec.evCount 個）の最後の部分なので、
   * 先頭の番号は「出た数 − 送る数」になる。入り直した人には events を空にして送るので、evBase は出た数そのもの
   */
  private snapMsg(side: Side, rec: BattleRecord, events: BattleEvent[], field: Field): SnapMessage {
    const view = viewFor(rec.state, side);
    return {
      type: 'snap',
      battleNo: rec.battleNo,
      evBase: rec.evCount - events.length,
      tick: view.tick,
      maxTicks: view.maxTicks,
      units: packView(side, view, field),
      events,
      ordersLeft: [view.ordersLeft[0], view.ordersLeft[1]],
      outcome: view.outcome,
      // 自分の遊軍の様子だけ（viewFor は相手のぶんを入れないが、ここでも自分の側だけを取り出す）
      reserve: reserveViewOf(view.reserve?.[side] ?? null),
    };
  }

  /** 場面を席ごとに viewFor を通して送り、ためていた出来事を空にする */
  private broadcastSnap(rec: BattleRecord): void {
    const s = this.room;
    if (s === null) return;
    const field = fieldOf(s.map);
    const events = this.pendingEvents;
    this.pendingEvents = [];
    for (const o of this.openSockets()) {
      if (this.isCurrent(s, o.att)) this.sendTo(o.ws, this.snapMsg(o.att.seat, rec, events, field));
    }
  }

  /** 結果。見る人ごとに作る（相手の呼ばなかった遊軍を消す。design §7.7） */
  private resultMsg(s: RoomState, side: Side): ResultMessage {
    const r = s.lastResult;
    if (r === null) throw new Error('no result');
    return { type: 'result', battleNo: s.battleNo, winner: r.winner, reason: r.reason, summary: summaryFor(side, r), score: [s.score[0], s.score[1], s.score[2]] };
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    this.safeSend(ws, JSON.stringify(msg));
  }

  private safeSend(ws: WebSocket, text: string): void {
    try {
      ws.send(text);
    } catch (e) {
      console.warn('send failed', e);
    }
  }

  private safeClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // すでに閉じている
    }
  }
}
