// 部屋の Durable Object（design §4.2〜§4.4）。
//
// 決まり:
// - 部屋の状態（RoomState）はメモリに持ち、変わるたびに保存領域の "room" へ書く。コンストラクタで読み戻す。
//   眠ったり作り直されたりするとメモリは消えるが、保存した内容と、接続の添付データ（世代・席・接続の番号）から組み立て直せる。
// - 戦闘の状態（BattleState）は、戦闘中はメモリに持って setInterval で刻み、"battle" へは10刻みごと・号令を受け付けた
//   step の直後・決着時にだけ書く。作り直されたら、保存した刻みから続ける（追いかけない）。
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
  createBattle,
  pvpArmyLimits,
  step,
  summarize,
  validateArmy,
  viewFor,
  type BattleEvent,
  type Field,
  type OrderInput,
  type Placement,
  type Side,
} from '@jinkei/engine';
import { fieldFor, packView, placementsFor, revealFor } from './flip.ts';
import { fieldOf, pickMap } from './maps.ts';
import type { ClientMessage, CloseCode, ErrorMessage, ErrorReason, RoomMessage, ServerMessage, SnapMessage } from './protocol.ts';
import { anyConnected, newRoom, newSeat, nextDeadline, publicSignature, type BattleRecord, type RoomState, type Seat } from './state.ts';
import { LAG_RESET_TICKS, MAX_STEPS_PER_CALL, SAVE_EVERY_TICKS, SNAP_EVERY_TICKS, type Timing } from './timing.ts';
import { isPid, normalizeName, parseClientMessage } from './validate.ts';

const ROOM_KEY = 'room';
const BATTLE_KEY = 'battle';
/** 1つの部屋に同時に開ける接続の数（入り直しの途中で古い接続が残っている間を含む） */
const MAX_SOCKETS = 8;
/** メッセージの頻度の上限（接続ごと）。下書きは0.5秒に1回、号令は1戦に3回なので、ふつうの操作では届かない */
const RATE_BURST = 20;
const RATE_PER_SEC = 10;

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

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 1;
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
  readonly early: ServerMessage[] = [];
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

  error(ws: WebSocket, reason: ErrorReason, message: string, extra?: Pick<ErrorMessage, 'armyErrors'>): void {
    const msg: ErrorMessage = { type: 'error', reason, message };
    if (extra?.armyErrors !== undefined) msg.armyErrors = extra.armyErrors;
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
  /** 前の snap のあとに起きた出来事 */
  private pendingEvents: BattleEvent[] = [];
  private readonly rates = new WeakMap<WebSocket, { tokens: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // "ping" には Durable Object を起こさずに "pong" を返す
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.room = this.ctx.storage.kv.get<RoomState>(ROOM_KEY) ?? null;
    // 起動時の点検：接続の突き合わせ（再起動で消えた接続）、期限、戦闘の再開。
    // ここで戦闘を再開しておけば、起こしたのが見張りのアラームでも、入り直した人の接続でも同じに続く
    void this.ctx.blockConcurrencyWhile(async () => {
      try {
        const s = this.room;
        if (s === null || s.phase === 'empty') return;
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
   * 部屋を作る（design §4.3）。empty のときだけ、世代を増やして reserved にし、作った人の pid を覚える。
   * 空きの確認と予約を、await を挟まない1回の処理で行う（同時に来た2つの作成が両方通ることはない）。
   */
  async create(code: string, pid: string, timing: Timing): Promise<boolean> {
    const cur = this.room;
    if (cur !== null && cur.phase !== 'empty') return false;
    if (!isPid(pid)) return false;
    const now = Date.now();
    const s = newRoom(code, (cur?.gen ?? 0) + 1, timing, cur?.connSeq ?? 0);
    const tx = new Tx(cur ?? s, now);
    s.phase = 'reserved';
    s.seats = [newSeat(pid, ''), null];
    s.deadlines.reserve = now + timing.reserveMs;
    this.room = s;
    this.battle = null;
    this.ctx.storage.kv.delete(BATTLE_KEY);
    this.settle(tx);
    this.commit(tx);
    return true;
  }

  /** テスト用：インスタンスの識別子（作り直されたかを確かめる） */
  async instance(): Promise<string> {
    return this.instanceId;
  }

  /** テスト用：アラームの処理をいま実行する（2回鳴った場合の確認） */
  async runAlarmNow(): Promise<void> {
    await this.alarm();
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
      alarm: await this.ctx.storage.getAlarm(),
    };
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
      const s = this.room;
      if (s === null || s.phase === 'empty') {
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
      this.join(tx, server, side, pid, name);
      this.settle(tx);
      this.commit(tx);
      return new Response(null, { status: 101, webSocket: client });
    } catch (e) {
      console.error('fetch failed', e);
      return new Response('internal error', { status: 500 });
    }
  }

  private reject(ws: WebSocket, reason: 'not_found' | 'full', code: CloseCode): void {
    const msg: ErrorMessage = { type: 'error', reason, message: reason === 'full' ? 'the room is full' : 'no such room' };
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

  private join(tx: Tx, ws: WebSocket, side: Side, pid: string, name: string): void {
    const s = this.room;
    if (s === null) return;
    let seat = s.seats[side];
    if (seat === null) {
      seat = newSeat(pid, name);
      s.seats[side] = seat;
    }
    // 1つの席に有効な接続は1つ。古い接続は閉じ、その「切れた」の知らせは接続の番号の違いで無視する
    for (const o of this.openSockets()) {
      if (o.ws !== ws && o.att.seat === side) tx.closes.push({ ws: o.ws, code: 4001, reason: 'replaced by a newer connection' });
    }
    s.connSeq += 1;
    seat.conn = s.connSeq;
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
      if (!this.takeToken(ws)) return;
      const s = this.room;
      const att = this.attachment(ws);
      if (s === null || s.phase === 'empty' || att === null || att.gen !== s.gen) {
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

  /** 頻度の上限（接続ごとの手桶）。メモリにだけ持つ（眠ると満タンに戻るが、それで困ることはない） */
  private takeToken(ws: WebSocket): boolean {
    const now = Date.now();
    const r = this.rates.get(ws) ?? { tokens: RATE_BURST, at: now };
    r.tokens = Math.min(RATE_BURST, r.tokens + ((now - r.at) / 1000) * RATE_PER_SEC);
    r.at = now;
    this.rates.set(ws, r);
    if (r.tokens < 1) return false;
    r.tokens -= 1;
    return true;
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
        this.takeDraft(seat, side, msg.army, field);
        return;
      }
      case 'ready': {
        if (s.phase !== 'setup' || seat.ready) return;
        if (msg.army !== undefined) this.takeDraft(seat, side, msg.army, field);
        if (seat.draft === null) {
          tx.error(ws, 'invalid_army', 'no army to confirm');
          return;
        }
        const errors = validateArmy(seat.draft, field.zones[side], pvpArmyLimits());
        if (errors.length > 0) {
          tx.error(ws, 'invalid_army', 'the army is not valid', { armyErrors: errors });
          return;
        }
        seat.lastValid = seat.draft;
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
      case 'rematch': {
        if (s.phase !== 'result' || msg.battleNo !== s.battleNo) return;
        s.rematch[side] = true;
        if (s.rematch[0] && s.rematch[1]) this.startSetup(tx);
        return;
      }
    }
  }

  /** 「自分が下」の座標で届いた下書きを、戦場の座標にして持つ。検査を通れば lastValid にもする */
  private takeDraft(seat: Seat, side: Side, army: Placement[], field: Field): void {
    const placed = placementsFor(side, army, field);
    seat.draft = placed;
    if (validateArmy(placed, field.zones[side], pvpArmyLimits()).length === 0) seat.lastValid = placed;
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
      if (s === null || s.phase === 'empty') return;
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
    const s = this.room;
    if (s === null || s.phase === 'empty') {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    const tx = new Tx(s, now);
    tx.alarmFired = true;
    const d = s.deadlines;
    // 段階を移す前に、いまの段階と期限を確かめる（2回呼ばれても、2回目は条件に合わず何もしない）
    if (s.phase === 'reserved' && d.reserve !== undefined && now >= d.reserve) {
      this.wipe(tx);
    } else if (s.phase !== 'battle' && d.idle !== undefined && now >= d.idle && !anyConnected(s)) {
      this.wipe(tx);
    } else if (s.phase === 'setup' && d.setup !== undefined && now >= d.setup) {
      this.toReveal(tx);
    } else if (s.phase === 'reveal' && d.reveal !== undefined && now >= d.reveal) {
      this.toBattle(tx);
    } else if (s.phase === 'battle') {
      // 見張り：作り直された直後なら、ここで戦闘を再開する（誰もつながっていなくても最後まで進める）
      this.ensureBattle(tx);
    }
    this.settle(tx);
    this.commit(tx);
  }

  /** 部屋を片付けて empty に戻す。世代と接続の番号だけは残す（コードを使い回したときに、前の世代の接続を見分けるため） */
  private wipe(tx: Tx): void {
    const s = this.room;
    if (s === null) return;
    this.stopTimer();
    for (const ws of this.ctx.getWebSockets()) tx.closes.push({ ws, code: 4003, reason: 'room closed' });
    this.battle = null;
    this.pendingOrders = [];
    this.pendingEvents = [];
    this.ctx.storage.kv.delete(BATTLE_KEY);
    this.room = newRoom(s.code, s.gen, s.timing, s.connSeq);
  }

  // ---------- 段階の移り変わり ----------

  private startSetup(tx: Tx): void {
    const s = this.room;
    if (s === null) return;
    s.phase = 'setup';
    s.map = pickMap();
    s.deadlines.setup = tx.now + s.timing.setupMs;
    delete s.deadlines.reveal;
    delete s.deadlines.away;
    s.rematch = [false, false];
    for (const seat of s.seats) {
      if (seat === null) continue;
      seat.ready = false;
      seat.draft = null;
      seat.lastValid = null;
    }
  }

  /** 既定の編成（PVP_RULES.standardRoster）を横陣で並べる。applyTemplate は戦場の座標で返す */
  private defaultArmy(side: Side, field: Field): Placement[] {
    return applyTemplate('line', PVP_RULES.standardRoster, field.zones[side], side);
  }

  private toReveal(tx: Tx): void {
    const s = this.room;
    if (s === null || s.phase !== 'setup') return;
    const field = fieldOf(s.map);
    // 確定した人は確定した配置、していない人は最後に検査を通った下書き、それもなければ既定の編成（assumptions S8）
    const armies = SIDES.map((side) => s.seats[side]?.lastValid ?? this.defaultArmy(side, field)) as [Placement[], Placement[]];
    let created = createBattle({ field, armies, seed: randomSeed(), maxTicks: s.timing.maxTicks, timeout: 'compare' });
    if (!created.ok && created.error.side !== undefined) {
      // 検査を通った配置しか持たないので起きないはずだが、起きても戦いは始める
      console.error('createBattle rejected an army', created.error);
      armies[created.error.side] = this.defaultArmy(created.error.side, field);
      created = createBattle({ field, armies, seed: randomSeed(), maxTicks: s.timing.maxTicks, timeout: 'compare' });
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
    const rec: BattleRecord = { battleNo: s.battleNo, armies, startsAt: s.deadlines.reveal, state: created.value };
    this.battle = rec;
    this.ctx.storage.kv.put(BATTLE_KEY, rec);
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
    s.deadlines.watchdog = tx.now + s.timing.watchdogMs;
    this.startTimer(rec, tx.now);
  }

  private loadBattle(): BattleRecord | null {
    const s = this.room;
    if (s === null) return null;
    if (this.battle !== null && this.battle.battleNo === s.battleNo) return this.battle;
    const rec = this.ctx.storage.kv.get<BattleRecord>(BATTLE_KEY) ?? null;
    if (rec === null || rec.battleNo !== s.battleNo) return null;
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
    s.deadlines.watchdog = tx.now + s.timing.watchdogMs;
    if (this.timer !== null) return;
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
    this.timer = setInterval(() => this.onTick(), s.timing.tickMs);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** setInterval から呼ばれる。実時間に追いつく分だけ step を呼ぶ（1回に最大5刻み） */
  private onTick(): void {
    try {
      const s = this.room;
      const rec = this.battle;
      if (s === null || s.phase !== 'battle' || rec === null || rec.battleNo !== s.battleNo) {
        this.stopTimer();
        return;
      }
      const st = rec.state;
      const tickMs = s.timing.tickMs;
      const now = Date.now();
      const due = Math.floor((now - this.clockBase) / tickMs) - st.tick;
      const steps = Math.min(Math.max(due, 0), MAX_STEPS_PER_CALL);
      let save = false;
      let snap = false;
      for (let i = 0; i < steps && st.outcome === null; i++) {
        // 号令は、届いた次の step に渡す
        const orders = this.pendingOrders;
        this.pendingOrders = [];
        const events = step(st, orders);
        for (const e of events) this.pendingEvents.push(e);
        // 号令を受け付けた step の直後は書く（作り直されても、使った回数が巻き戻らないように）
        if (events.some((e) => e.type === 'order')) save = true;
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
      if (snap) this.broadcastSnap(rec);
      if (save) {
        this.ctx.storage.kv.put(BATTLE_KEY, rec);
        // 見張りの期限を先へ延ばす。毎回アラームを入れ直さないよう、残りが半分を切ったときだけ
        const w = s.deadlines.watchdog;
        if (w === undefined || w - now < s.timing.watchdogMs / 2) {
          const tx = new Tx(s, now);
          s.deadlines.watchdog = now + s.timing.watchdogMs;
          this.commit(tx);
        }
      }
    } catch (e) {
      console.error('tick failed', e);
    }
  }

  /** 決着。戦闘の状態と部屋の状態（結果・成績）を、await を挟まず続けて書く。成績は phase が battle のときだけ足す */
  private finish(tx: Tx, rec: BattleRecord): void {
    const s = this.room;
    if (s === null || s.phase !== 'battle' || rec.state.outcome === null) return;
    this.stopTimer();
    this.ctx.storage.kv.put(BATTLE_KEY, rec);
    // 決着した刻みは、2刻みを待たずにすぐ送る
    this.broadcastSnap(rec);
    const o = rec.state.outcome;
    if (o.winner === 0) s.score[0] += 1;
    else if (o.winner === 1) s.score[1] += 1;
    else s.score[2] += 1;
    s.phase = 'result';
    s.lastResult = summarize(rec.state);
    s.rematch = [false, false];
    delete s.deadlines.watchdog;
    this.pendingOrders = [];
    tx.early.push(this.resultMsg(s));
  }

  /**
   * 入力のたびに行う点検：接続と席の突き合わせ、2人の確定、不在の席、片付けの期限。
   * ここも何回呼んでも同じ結果になる（期限と今の時刻と段階だけを見る）。
   */
  private settle(tx: Tx): void {
    const s = this.room;
    if (s === null || s.phase === 'empty') return;
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
    if (s.phase === 'setup' && s.seats[0]?.ready === true && s.seats[1]?.ready === true) this.toReveal(tx);
    // 不在（design §4.3）：result の間、切れてから awayMs たった席を空ける。2人ともなら片付けに任せる
    if (s.phase === 'result') {
      const away = SIDES.filter((side) => {
        const seat = s.seats[side];
        return seat !== null && seat.conn === null && seat.goneSince !== null && now >= seat.goneSince + s.timing.awayMs;
      });
      if (away.length === 1) {
        const side = away[0] as Side;
        s.seats[side] = null;
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
      }
    }
    let awayAt: number | null = null;
    if (s.phase === 'result') {
      for (const seat of s.seats) {
        if (seat === null || seat.conn !== null || seat.goneSince === null) continue;
        const t = seat.goneSince + s.timing.awayMs;
        if (awayAt === null || t < awayAt) awayAt = t;
      }
    }
    if (awayAt === null) delete s.deadlines.away;
    else s.deadlines.away = awayAt;
    // 片付け：誰もつながっていない状態が続いた時間を、期限で持つ
    if (anyConnected(s)) delete s.deadlines.idle;
    else if (s.deadlines.idle === undefined) s.deadlines.idle = now + s.timing.cleanupMs;
  }

  /** 保存・アラーム・送信。間に await を挟まない */
  private commit(tx: Tx): void {
    const s = this.room;
    if (s === null) return;
    const deadline = nextDeadline(s);
    const want = deadline === null ? null : deadline + s.timing.testAlarmLagMs;
    // 期限が過去なら、覚えている時刻と同じでも入れ直す（アラームの処理が失敗して、やり直しが尽きた場合など）
    const alarmChanged = want !== s.alarmAt || tx.alarmFired || (want !== null && want <= tx.now);
    s.alarmAt = want;
    if (JSON.stringify(s) !== tx.beforeJson) this.ctx.storage.kv.put(ROOM_KEY, s);
    if (alarmChanged) {
      if (want === null) void this.ctx.storage.deleteAlarm();
      else void this.ctx.storage.setAlarm(want);
    }
    const publicChanged = publicSignature(s) !== tx.beforePublic;
    const targets = this.currentSockets(tx);
    for (const msg of tx.early) for (const o of targets) this.sendTo(o.ws, msg);
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
      if (s.phase === 'result' && s.lastResult !== null) this.sendTo(o.ws, this.resultMsg(s));
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
      phase: s.phase === 'empty' || s.phase === 'reserved' ? 'waiting' : s.phase,
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
      },
      rematch: [s.rematch[0], s.rematch[1]],
      myArmy: me?.lastValid ? placementsFor(side, me.lastValid, field) : null,
    };
  }

  /** 席の見え方。pid と下書きは含めない */
  private seatView(seat: Seat | null): RoomMessage['seats'][number] {
    if (seat === null) return null;
    return { name: seat.name, connected: seat.conn !== null, ready: seat.ready };
  }

  private revealMsg(side: Side, rec: BattleRecord, field: Field): ServerMessage {
    return {
      type: 'reveal',
      battleNo: rec.battleNo,
      armies: [revealFor(side, 0, rec.armies[0], field), revealFor(side, 1, rec.armies[1], field)],
      startsAt: rec.startsAt,
      serverTime: Date.now(),
    };
  }

  private snapMsg(side: Side, rec: BattleRecord, events: BattleEvent[], field: Field): SnapMessage {
    const view = viewFor(rec.state, side);
    return {
      type: 'snap',
      battleNo: rec.battleNo,
      tick: view.tick,
      maxTicks: view.maxTicks,
      units: packView(side, view, field),
      events,
      ordersLeft: [view.ordersLeft[0], view.ordersLeft[1]],
      outcome: view.outcome,
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

  private resultMsg(s: RoomState): ServerMessage {
    const r = s.lastResult;
    if (r === null) throw new Error('no result');
    return { type: 'result', battleNo: s.battleNo, winner: r.winner, reason: r.reason, summary: r, score: [s.score[0], s.score[1], s.score[2]] };
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
