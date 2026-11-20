// 待機に戻ったら、配置の覚えを捨てる（design §11.5-1。C4）。
// 「配置 → 待機 → 配置」では battleNo が増えず、配置の見分け（code#battleNo）が同じになる。
// 前の配置の「確定したい」（wantReady）が残ると、新しい相手との配置を勝手に確定しうる。
// 実物の pvp.ts（PvpFlow と、その中の RoomClient）を、WebSocket・タイマー・localStorage を差し替えて動かす。
// 画面（Phaser.Game）はつながない（go は何もしない）ので、room が届くたびの route() は、ここで手で呼ぶ。

import assert from 'node:assert/strict';
import { test } from 'node:test';

let clock = 1_000_000;
Date.now = () => clock;
type Timer = { id: number; at: number; fn: () => void; every: number };
let timers: Timer[] = [];
let nextId = 1;
const addTimer = (fn: () => void, ms: number, every: number): number => {
  const id = nextId++;
  timers.push({ id, at: clock + ms, fn, every });
  return id;
};
const clearTimer = (id: number): void => {
  timers = timers.filter((t) => t.id !== id);
};
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
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  location: { protocol: 'http:', host: 'localhost' },
  setTimeout: (fn: () => void, ms: number) => addTimer(fn, ms, 0),
  clearTimeout: (id: number) => clearTimer(id),
  setInterval: (fn: () => void, ms: number) => addTimer(fn, ms, ms),
  clearInterval: (id: number) => clearTimer(id),
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

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
  deliver(msg: object): void {
    this.readyState = FakeSocket.OPEN;
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}
Object.defineProperty(globalThis, 'WebSocket', { value: FakeSocket, configurable: true, writable: true });

const { client, pvp, pvpLocal, setupKey } = await import('../src/net/pvp.ts');
/** 下側の配置エリアの中の小さな配置（本陣と歩兵1） */
const holdArmy = () => [
  { kind: 'hq' as const, col: 5, row: 15, stance: 'hold' as const },
  { kind: 'infantry' as const, col: 5, row: 12, stance: 'hold' as const },
];

const seat = (name: string, ready = false) => ({ name, connected: true, ready, left: false });

function room(phase: 'waiting' | 'setup', opts: { other?: string | null; opponentLeft?: boolean; readyMe?: boolean } = {}) {
  const other = opts.other === undefined ? 'B' : opts.other;
  return {
    type: 'room',
    code: '1234',
    phase,
    battleNo: 0,
    you: 0,
    seats: [seat('A', opts.readyMe ?? false), other === null ? null : seat(other)],
    score: [0, 0, 0],
    deadlines: { setup: phase === 'setup' ? clock + 120_000 : null, reveal: null },
    serverTime: clock,
    map: 'plain',
    field: { width: 12, height: 16, terrain: [], zones: [] },
    rules: { budget: 36, costs: { hq: 0, infantry: 3, shield: 3, cavalry: 4, archer: 3 }, maxUnits: 12, standardRoster: { hq: 1 }, reserve: false },
    rematch: [false, false],
    myArmy: null,
    myReserve: null,
    opponentLeft: opts.opponentLeft ?? false,
  };
}

function sentTypes(ws: FakeSocket): string[] {
  return ws.sent.filter((d) => d !== 'ping').map((d) => (JSON.parse(d) as { type: string }).type);
}

test('C4 待機に戻ったら、確定の望み・配置の見分け・下書きの送り待ちを捨て、次の配置で確定を持ち越さない', () => {
  pvp.begin();
  client.join('1234', 'a'.repeat(32), 'A');
  const ws = FakeSocket.all[FakeSocket.all.length - 1]!;
  // 配置に入る（DeployScene の beginPvpSetup と同じく、配置の見分けを付け、配置を置く）
  ws.deliver(room('setup'));
  pvp.route();
  pvpLocal.setupFor = setupKey(client.room!);
  pvpLocal.placements = holdArmy();
  // 確定を押した。server が受け付ける前に（席の ready が false のまま）相手が出た
  pvp.setReady(true);
  assert.equal(pvpLocal.wantReady, true);
  assert.deepEqual(sentTypes(ws), ['ready']);
  // 配置を動かして、下書きの送り待ちもある
  pvp.markDraft();
  assert.equal(pvpLocal.draftDirty, true);

  // 相手が出て、待機に戻った
  ws.deliver(room('waiting', { other: null, opponentLeft: true }));
  pvp.route();
  assert.equal(pvpLocal.wantReady, null, '確定の望みを捨てる');
  assert.equal(pvpLocal.setupFor, null, '配置の見分けを捨てる');
  assert.equal(pvpLocal.draftDirty, false, '下書きの送り待ちを捨てる');
  assert.equal(pvpLocal.placements.length, 2, '手元の配置は残す（次の配置で置き直す）');
  advance(5_000);
  assert.deepEqual(sentTypes(ws), ['ready'], '待機のあいだに何も送らない');

  // 新しい相手が入って、同じ battleNo の配置に入った：確定を送らない
  ws.deliver(room('setup', { other: 'C' }));
  pvp.route();
  advance(5_000);
  assert.deepEqual(sentTypes(ws), ['ready'], '前の配置の確定を持ち越さない');
  assert.equal(pvpLocal.wantReady, null);
  // 配置の見分けが空なので、配置の画面は始め直す（beginPvpSetup が印を付け直し、検査し直して下書きを送る）
  assert.notEqual(pvpLocal.setupFor, setupKey(client.room!));
  pvp.leave();
});
