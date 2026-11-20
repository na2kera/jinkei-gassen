// 戻ったらすぐつなぎ直す（RoomClient.wake()。design §9.6、§9.9-8〜10。M10・M15）と、
// 部屋を出るときの「出た」の知らせ（RoomClient.leave()。design §11.2、§11.5-9。C1）を、
// WebSocket・タイマー・時計を差し替えて、実物の RoomClient で確かめる。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';

// ---- 時計とタイマー ----

let clock = 1_000_000;
Date.now = () => clock;

interface Timer {
  id: number;
  at: number;
  fn: () => void;
  every: number;
}
let timers: Timer[] = [];
let nextId = 1;
function addTimer(fn: () => void, ms: number, every: number): number {
  const id = nextId++;
  timers.push({ id, at: clock + ms, fn, every });
  return id;
}
function clearTimer(id: number): void {
  timers = timers.filter((t) => t.id !== id);
}
/** ms だけ時計を進め、時間が来たタイマーを順に動かす */
function advance(ms: number): void {
  const end = clock + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    clock = due.at;
    if (due.every > 0) due.at += due.every;
    else clearTimer(due.id);
    due.fn();
  }
  clock = end;
}

(globalThis as unknown as { window: unknown }).window = {
  location: { protocol: 'http:', host: 'localhost' },
  setTimeout: (fn: () => void, ms: number) => addTimer(fn, ms, 0),
  clearTimeout: (id: number) => clearTimer(id),
  setInterval: (fn: () => void, ms: number) => addTimer(fn, ms, ms),
  clearInterval: (id: number) => clearTimer(id),
};

// ---- WebSocket ----

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeSocket.CLOSED;
  }
  /** つながって、room が届く */
  openWithRoom(): void {
    this.readyState = FakeSocket.OPEN;
    this.onmessage?.({ data: JSON.stringify({ type: 'room', code: '1234', phase: 'waiting', serverTime: clock }) });
  }
  /** サーバー（やネットワーク）が閉じた */
  serverClose(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}
Object.defineProperty(globalThis, 'WebSocket', { value: FakeSocket, configurable: true, writable: true });

const { RoomClient } = await import('../src/net/RoomClient.ts');
type Client = InstanceType<typeof RoomClient>;

function last(): FakeSocket {
  return FakeSocket.all[FakeSocket.all.length - 1]!;
}

/** 部屋に入った client（つながっていて、room が届いている） */
function joined(): Client {
  timers = [];
  FakeSocket.all = [];
  const c = new RoomClient();
  c.join('1234', 'pid', '名前');
  last().openWithRoom();
  assert.equal(c.status, 'open');
  return c;
}

function retryOf(c: Client): number {
  return (c as unknown as { retry: number }).retry;
}

test('M10 (a) つなぎ直しを待っている途中なら、すぐつなぎ、回数が 0 に戻る', () => {
  const c = joined();
  last().serverClose();
  assert.equal(c.status, 'reconnecting');
  assert.equal(retryOf(c), 1);
  const n = FakeSocket.all.length;
  c.wake();
  assert.equal(FakeSocket.all.length, n + 1, '待たずにつないだ');
  assert.equal(retryOf(c), 0);
  // 待っていた予約は止めてある（時間が来ても、もう1つつながない）
  advance(10_000);
  assert.equal(FakeSocket.all.length, n + 1);
});

test('M10 (b) 閉じたつながりを持っていたら、つなぎ直す（close が届かない端末）', () => {
  const c = joined();
  const old = last();
  old.readyState = FakeSocket.CLOSED;
  c.wake();
  assert.equal(FakeSocket.all.length, 2);
  assert.notEqual(last(), old);
  assert.equal(c.status, 'reconnecting');
  last().openWithRoom();
  assert.equal(c.status, 'open');
});

test('M10 (c) 部屋に入っていなければ何もしない。入室の途中（room がまだ）も何もしない', () => {
  timers = [];
  FakeSocket.all = [];
  const c = new RoomClient();
  c.wake();
  assert.equal(FakeSocket.all.length, 0);
  c.join('1234', 'pid', '名前');
  last().readyState = FakeSocket.CLOSED;
  c.wake();
  assert.equal(FakeSocket.all.length, 1, 'room が届く前はつながない');
});

test('M10 (d) 続けて2回呼んでも、つなぐのは1回', () => {
  const c = joined();
  last().serverClose();
  c.wake();
  c.wake();
  assert.equal(FakeSocket.all.length, 2);
});

test('M15 回数を使い切る直前（retry が 5）でも、fail(lost) に落ちずにつなぐ', () => {
  const c = joined();
  for (let i = 0; i < 5; i++) {
    last().serverClose();
    if (i < 4) advance(10_000);
  }
  assert.equal(retryOf(c), 5);
  assert.equal(c.status, 'reconnecting');
  c.wake();
  assert.equal(retryOf(c), 0);
  assert.equal(c.failure, null);
  // この open() が失敗したら、いつもの lost() の道（間隔を空けて5回）に戻る
  last().serverClose();
  assert.equal(c.status, 'reconnecting');
  assert.equal(retryOf(c), 1);
  assert.equal(c.failure, null);
});

test('M15 CONNECTING のあいだは何もしない', () => {
  const c = joined();
  last().serverClose();
  advance(600);
  assert.equal(last().readyState, FakeSocket.CONNECTING);
  const n = FakeSocket.all.length;
  c.wake();
  assert.equal(FakeSocket.all.length, n);
});

test('M15 応答のない OPEN（最後に届いてから SILENCE_MS 超）はつなぎ直す。応答があれば ping を1つ送るだけ', () => {
  const c = joined();
  const ws = last();
  clock += 3000;
  c.wake();
  assert.equal(FakeSocket.all.length, 1, '最近届いていれば、つなぎ直さない');
  assert.deepEqual(ws.sent, ['ping']);
  // タイマーを動かさずに時計だけ進める（裏にいてタイマーが止まっていた、の代わり）
  clock += 13_000;
  c.wake();
  assert.equal(FakeSocket.all.length, 2, '応答がないのでつなぎ直した');
});

test('M15 2000ms のうちに2回呼んでも、つなぐのは1回。退室のあとに呼んでも何もしない', () => {
  const c = joined();
  last().serverClose();
  c.wake();
  assert.equal(FakeSocket.all.length, 2);
  // すぐ失敗して閉じた（CONNECTING ではない）。それでも 2000ms のうちは、wake() からはつながない
  last().readyState = FakeSocket.CLOSED;
  clock += 1000;
  c.wake();
  assert.equal(FakeSocket.all.length, 2);
  clock += 1500;
  c.wake();
  assert.equal(FakeSocket.all.length, 3, '2000ms たてば、またつなぐ');

  c.leave();
  const n = FakeSocket.all.length;
  c.wake();
  advance(20_000);
  assert.equal(FakeSocket.all.length, n, '退室のあとは何もしない');
  assert.equal(c.status, 'idle');
});

// ---- C1 部屋を出るときの「出た」（leave）の知らせ ----

function leavesSent(ws: FakeSocket): number {
  return ws.sent.filter((d) => d !== 'ping' && (JSON.parse(d) as { type: string }).type === 'leave').length;
}

test('C1 つながっているとき、leave() は leave を1つ送ってから閉じる。2度呼んでも1つ', () => {
  const c = joined();
  const ws = last();
  c.leave();
  assert.equal(leavesSent(ws), 1);
  assert.deepEqual(JSON.parse(ws.sent[ws.sent.length - 1]!), { type: 'leave' });
  assert.equal(ws.readyState, FakeSocket.CLOSED, '送ったあとに閉じた');
  assert.equal(c.status, 'idle');
  assert.equal(c.room, null);
  c.leave();
  assert.equal(leavesSent(ws), 1, '2度目は送らない');
  assert.equal(FakeSocket.all.length, 1, 'つなぎ直さない');
});

test('C1 切れているとき（つなぎ直しを待っている途中）は、送らずに手元を片付ける', () => {
  const c = joined();
  const ws = last();
  ws.serverClose();
  assert.equal(c.status, 'reconnecting');
  c.leave();
  assert.equal(leavesSent(ws), 0);
  assert.equal(c.status, 'idle');
  advance(20_000);
  assert.equal(FakeSocket.all.length, 1, '待っていたつなぎ直しも止まる');
});

test('C1 つなぎ直し・別の画面に置き換えられた・別の部屋に入り直すときは、leave を送らない', () => {
  // 応答のない OPEN から、wake() でつなぎ直す
  let c = joined();
  let ws = last();
  clock += 13_000;
  c.wake();
  assert.equal(FakeSocket.all.length, 2);
  assert.equal(leavesSent(ws), 0, 'つなぎ直しでは送らない');
  // 別の画面で開かれた（4001）
  c = joined();
  ws = last();
  ws.serverClose(4001);
  assert.equal(c.failure, 'replaced');
  assert.equal(leavesSent(ws), 0, '置き換えでは送らない');
  // 別のコードで入り直す（join は leaveQuietly を通る）
  c = joined();
  ws = last();
  c.join('5678', 'pid', '名前');
  assert.equal(leavesSent(ws), 0, '入り直しでは送らない');
  assert.equal(ws.readyState, FakeSocket.CLOSED);
});
