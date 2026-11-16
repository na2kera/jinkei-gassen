// 対戦の部屋とのつながり（design §4.3、§4.4）。WebSocket の接続・つなぎ直し・メッセージの送受信を受け持つ。
// 画面（シーン）はこのクラスを見るだけにして、自分で WebSocket に触らない。
// 届いたメッセージは種類ごとに覚えておき、あとから画面を作り直しても最後の状態を読めるようにする。

import type {
  ClientMessage,
  CloseCode,
  CreateRoomResponse,
  ErrorMessage,
  ResultMessage,
  RevealMessage,
  RoomMessage,
  ServerMessage,
  SnapMessage,
} from '@jinkei/server/protocol';

export type NetStatus =
  /** 部屋に入っていない */
  | 'idle'
  /** 初めてつないでいる（まだ room が届いていない） */
  | 'joining'
  /** つながっていて、room が届いている */
  | 'open'
  /** 切れたので、つなぎ直している */
  | 'reconnecting';

/** 入室・作成の失敗の理由（画面に出す1行に直す） */
export type JoinFailure = 'not_found' | 'full' | 'busy' | 'wait' | 'network' | 'lost' | 'replaced';

export function failureText(f: JoinFailure): string {
  switch (f) {
    case 'not_found':
      return '部屋が見つかりません';
    case 'full':
      return '部屋が満員です';
    case 'busy':
      return '混み合っています';
    case 'wait':
      return '少し待ってください';
    case 'network':
      return 'つながりません';
    case 'lost':
      return 'つながりが切れました';
    case 'replaced':
      return '別の画面で開かれました';
  }
}

type Listener = () => void;

/** つなぎ直しの間隔（ミリ秒）。少しずつ空け、使い切ったらあきらめる */
const RETRY_DELAYS = [500, 1000, 2000, 4000, 8000];
/** これだけ何も届かなければ、切れたとみなしてつなぎ直す（手元の開発環境では close が届かないことがあるため） */
const SILENCE_MS = 12000;
const PING_MS = 4000;
/** error のあと close が届くのを待つ長さ（ミリ秒） */
const ERROR_GRACE_MS = 400;

export class RoomClient {
  status: NetStatus = 'idle';
  code: string | null = null;
  room: RoomMessage | null = null;
  reveal: RevealMessage | null = null;
  snap: SnapMessage | null = null;
  result: ResultMessage | null = null;
  /** server の時計 − 自分の時計（ミリ秒） */
  clockOffset = 0;
  /** 最後の入室の失敗（画面に1行で出すため。出したら消す） */
  failure: JoinFailure | null = null;
  /** 部屋を作っている途中か（画面を作り直しても、作成を2つ始めないよう、シーンの外に持つ） */
  creating = false;
  /**
   * 部屋に入り直した回数（room が届くたびではなく、つながり直して最初の room が届いたときに増える）。
   * 号令の数え方などを、つなぎ直したあとの最初の場面で正し直すために使う
   */
  session = 0;

  /** 開発用：届いたメッセージの種類ごとの数と、送ったメッセージの記録 */
  readonly received: Record<string, number> = {};
  readonly sentLog: string[] = [];
  lastType = '';

  private ws: WebSocket | null = null;
  private pid = '';
  private name = '';
  private retry = 0;
  private retryTimer = 0;
  private errorTimer = 0;
  /** 作成・入室・退室のたびに増える番号。古い操作の遅れた応答を捨てるため */
  private opGen = 0;
  /** いまのつながりで、まだ room が届いていないか */
  private freshSocket = false;
  private pingTimer = 0;
  private lastHeard = 0;
  private readonly listeners = new Set<Listener>();
  private readonly snapListeners = new Set<(m: SnapMessage) => void>();
  private readonly errorListeners = new Set<(m: ErrorMessage) => void>();

  /** 状態が変わったら呼ぶ（room・reveal・result・status・failure のどれか） */
  /** 購読の数（開発用：解放し忘れがないかを確かめるため） */
  get listenerCounts(): { room: number; snap: number; error: number } {
    return { room: this.listeners.size, snap: this.snapListeners.size, error: this.errorListeners.size };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onSnap(fn: (m: SnapMessage) => void): () => void {
    this.snapListeners.add(fn);
    return () => this.snapListeners.delete(fn);
  }

  onError(fn: (m: ErrorMessage) => void): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  /** server の時計での今 */
  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  /** 部屋を作る。成功すればコードを返し、そのまま入る */
  async create(pid: string, name: string): Promise<boolean> {
    if (this.creating) return false;
    this.leaveQuietly();
    const gen = ++this.opGen;
    this.failure = null;
    this.creating = true;
    this.emit();
    try {
      return await this.createWith(gen, pid, name);
    } finally {
      if (gen === this.opGen) {
        this.creating = false;
        this.emit();
      }
    }
  }

  private async createWith(gen: number, pid: string, name: string): Promise<boolean> {
    let res: Response;
    try {
      res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid }) });
    } catch {
      // 出たあと・別の操作のあとに届いた応答は捨てる
      if (gen !== this.opGen) return false;
      return this.fail('network');
    }
    if (gen !== this.opGen) return false;
    if (res.status === 503) return this.fail('busy');
    if (res.status === 429) return this.fail('wait');
    if (res.status !== 201) return this.fail('network');
    let body: CreateRoomResponse;
    try {
      body = (await res.json()) as CreateRoomResponse;
    } catch {
      return gen === this.opGen ? this.fail('network') : false;
    }
    if (gen !== this.opGen) return false;
    this.creating = false;
    this.join(body.code, pid, name);
    return true;
  }

  /** コードで入る（作った人も、作ったあとにこれでつなぐ） */
  join(code: string, pid: string, name: string): void {
    this.leaveQuietly();
    this.opGen++;
    this.creating = false;
    this.code = code;
    this.pid = pid;
    this.name = name;
    this.failure = null;
    this.retry = 0;
    this.room = null;
    this.reveal = null;
    this.snap = null;
    this.result = null;
    this.status = 'joining';
    this.open();
    this.emit();
  }

  /** 部屋を出る（自分から閉じる。つなぎ直さない） */
  leave(): void {
    this.leaveQuietly();
    // 作っている途中の応答が、あとから部屋へ連れ戻さないようにする
    this.opGen++;
    this.creating = false;
    this.code = null;
    this.room = null;
    this.reveal = null;
    this.snap = null;
    this.result = null;
    this.status = 'idle';
    this.emit();
  }

  send(msg: ClientMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    this.sentLog.push(msg.type === 'draft' ? `draft(${msg.army.length})` : msg.type);
    if (this.sentLog.length > 100) this.sentLog.splice(0, this.sentLog.length - 100);
    return true;
  }

  /** 開発用：つながりを切る（つなぎ直しが働くかを確かめるため） */
  dropForDebug(): void {
    this.ws?.close();
  }

  /** 開発用：すぐにつなぎ直す */
  reconnectForDebug(): void {
    if (!this.code) return;
    this.closeSocket();
    this.retry = 0;
    this.open();
  }

  // ---- 内部 ----

  private fail(f: JoinFailure): false {
    this.failure = f;
    this.emit();
    return false;
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private leaveQuietly(): void {
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.errorTimer);
    this.closeSocket();
  }

  private closeSocket(): void {
    window.clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        // すでに閉じている
      }
    }
  }

  private open(): void {
    const code = this.code;
    if (!code) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/rooms/${encodeURIComponent(code)}/ws?pid=${encodeURIComponent(this.pid)}&name=${encodeURIComponent(this.name)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.lost();
      return;
    }
    this.ws = ws;
    this.freshSocket = true;
    this.lastHeard = Date.now();
    ws.onmessage = (ev) => this.onMessage(ev);
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      window.clearTimeout(this.errorTimer);
      this.closed(ev.code as CloseCode | number);
    };
    ws.onerror = () => {
      // ふつうは続けて close が届き、そのコードでつなぎ直すかを決める。
      // close が届かない環境があるので、少し待っても届かなければ、ふつうの切断としてつなぎ直す
      window.clearTimeout(this.errorTimer);
      this.errorTimer = window.setTimeout(() => {
        if (this.ws === ws) this.lost();
      }, ERROR_GRACE_MS);
    };
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      if (this.ws !== ws) return;
      if (Date.now() - this.lastHeard > SILENCE_MS) {
        this.lost();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, PING_MS);
  }

  /**
   * サーバーが閉じた。コードを見て、つなぎ直すかを決める（protocol の CloseCode）。
   *   4001: 同じ pid の新しい接続に置き換えられた（別のタブで開いた）。つなぎ直すと奪い合いになるので、やめる
   *   1003・1008・1009: 決まりを破ったとして閉じられた。つなぎ直しても同じことになるので、やめる
   *   4002・4003・4004: 満員・部屋がない・接続が多すぎる。つなぎ直さない
   * それ以外（ネットワークの切断など）は、間隔を空けてつなぎ直す
   */
  private closed(code: number): void {
    const stop: Partial<Record<number, JoinFailure>> = {
      4001: 'replaced',
      1003: 'lost',
      1008: 'lost',
      1009: 'lost',
      4002: 'full',
      4003: 'not_found',
      4004: 'busy',
    };
    const f = stop[code];
    if (!f) {
      this.lost();
      return;
    }
    this.closeSocket();
    window.clearTimeout(this.retryTimer);
    this.code = null;
    this.room = null;
    this.status = 'idle';
    this.fail(f);
  }

  /** 思わず切れた。部屋に入れていたなら、間隔を空けてつなぎ直す */
  private lost(): void {
    this.closeSocket();
    if (!this.code) return;
    // まだ一度も room が届いていない（初めての入室）なら、つなぎ直さずに失敗とする
    if (!this.room) {
      this.status = 'idle';
      this.code = null;
      this.fail('network');
      return;
    }
    const delay = RETRY_DELAYS[this.retry];
    if (delay === undefined) {
      this.code = null;
      this.room = null;
      this.status = 'idle';
      this.fail('lost');
      return;
    }
    this.retry++;
    this.status = 'reconnecting';
    this.emit();
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  private onMessage(ev: MessageEvent): void {
    this.lastHeard = Date.now();
    if (ev.data === 'pong') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return;
    }
    this.received[msg.type] = (this.received[msg.type] ?? 0) + 1;
    this.lastType = msg.type;
    switch (msg.type) {
      case 'room':
        // つながり直して最初の room なら、入り直した回数を増やす（RemoteBattleSource が号令の数え方を正し直す）
        if (this.freshSocket) {
          this.freshSocket = false;
          this.session++;
        }
        this.room = msg;
        this.clockOffset = msg.serverTime - Date.now();
        this.status = 'open';
        this.retry = 0;
        // 新しい戦いの配置に入ったら、前の戦いの公開・場面・結果は捨てる
        if (msg.phase === 'setup' || msg.phase === 'waiting') {
          this.reveal = null;
          this.snap = null;
          this.result = null;
        }
        this.emit();
        return;
      case 'reveal':
        this.reveal = msg;
        this.clockOffset = msg.serverTime - Date.now();
        this.emit();
        return;
      case 'snap':
        this.snap = msg;
        for (const fn of [...this.snapListeners]) fn(msg);
        return;
      case 'result':
        this.result = msg;
        this.emit();
        return;
      case 'error':
        for (const fn of [...this.errorListeners]) fn(msg);
        // 入室の失敗。手元の環境では close が届かないことがあるので、error を受けた時点で失敗として扱う
        if (msg.reason === 'not_found' || msg.reason === 'full') {
          this.closeSocket();
          window.clearTimeout(this.retryTimer);
          this.code = null;
          this.room = null;
          this.status = 'idle';
          this.fail(msg.reason);
        }
        return;
    }
  }
}
