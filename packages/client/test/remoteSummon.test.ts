// 対戦の遊軍のボタン（design §7.8）の「返事待ち」の移り変わりを、RemoteBattleSource をにせの接続で動かして確かめる。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReserveView } from '@jinkei/engine';
import type { ClientMessage, ErrorMessage, PackedUnit, SnapMessage } from '@jinkei/server/protocol';
import { RemoteBattleSource } from '../src/net/RemoteBattleSource.ts';

/** RoomClient のうち、RemoteBattleSource が使う所だけを持つにせもの */
class FakeClient {
  session = 0;
  status: 'open' | 'reconnecting' | 'idle' = 'open';
  snap: SnapMessage | null = null;
  result: null = null;
  room: { rules: { reserve: boolean } } | null = { rules: { reserve: true } };
  sent: ClientMessage[] = [];
  private snapFns: ((m: SnapMessage) => void)[] = [];
  private errorFns: ((m: ErrorMessage) => void)[] = [];
  private fns: (() => void)[] = [];
  onSnap(fn: (m: SnapMessage) => void): () => void {
    this.snapFns.push(fn);
    return () => undefined;
  }
  onError(fn: (m: ErrorMessage) => void): () => void {
    this.errorFns.push(fn);
    return () => undefined;
  }
  subscribe(fn: () => void): () => void {
    this.fns.push(fn);
    return () => undefined;
  }
  send(msg: ClientMessage): boolean {
    if (this.status !== 'open') return false;
    this.sent.push(msg);
    return true;
  }
  pushSnap(m: SnapMessage): void {
    this.snap = m;
    for (const f of this.snapFns) f(m);
  }
  pushError(m: ErrorMessage): void {
    for (const f of this.errorFns) f(m);
  }
  setStatus(s: FakeClient['status']): void {
    this.status = s;
    for (const f of this.fns) f();
  }
  get summons(): number {
    return this.sent.filter((m) => m.type === 'reserve').length;
  }
  get orders(): number {
    return this.sent.filter((m) => m.type === 'order').length;
  }
}

/** 自軍（陣営0）の左翼の歩兵と、敵の本陣。号令の canOrderView が通るだけの場面 */
const UNITS: PackedUnit[] = [
  [0, 0, 'infantry', 'left', 3.5, 12.5, 0, -1, 100, 100, 100, 'active', null, null, 'advance'],
  [1, 1, 'hq', 'center', 5.5, 1.5, 0, 1, 100, 100, 100, 'active', null, null, null],
] as unknown as PackedUnit[];

function snap(tick: number, state: ReserveView['state'] | null, ordersLeft: [number, number] = [3, 3]): SnapMessage {
  return {
    type: 'snap',
    battleNo: 1,
    tick,
    maxTicks: 1800,
    units: UNITS,
    evBase: 0,
    events: [],
    ordersLeft,
    outcome: null,
    reserve: state ? { kind: 'cavalry', stance: 'advance', state } : null,
  } as SnapMessage;
}

function setup(): { c: FakeClient; src: RemoteBattleSource } {
  const c = new FakeClient();
  const src = new RemoteBattleSource(c as never, 1, 0);
  c.pushSnap(snap(60, 'ready'));
  return { c, src };
}

const reserveError = (reason: 'invalid_reserve' | 'reserve_disabled'): ErrorMessage =>
  ({ type: 'error', reason, op: 'reserve', ...(reason === 'invalid_reserve' ? { code: 'no_spawn_cell' } : {}) }) as unknown as ErrorMessage;

test('連打しても1通だけ送り、返事待ちの間は押せない', () => {
  const { c, src } = setup();
  assert.equal(src.canSummon(), true);
  src.summon('left');
  src.summon('left');
  src.summon('right');
  assert.equal(c.summons, 1);
  assert.deepEqual(c.sent[0], { type: 'reserve', battleNo: 1, from: 'left' });
  assert.equal(src.canSummon(), false);
});

test('遊軍が現れた（used）ら待ちが外れ、そのあとは押せない', () => {
  const { c, src } = setup();
  src.summon('left');
  c.pushSnap(snap(62, 'used'));
  assert.equal(src.canSummon(), false);
  assert.equal(src.reserve()?.state, 'used');
});

for (const reason of ['invalid_reserve', 'reserve_disabled'] as const) {
  test(`${reason} が返ると待ちが外れ、また押せる`, () => {
    const { c, src } = setup();
    src.summon('left');
    assert.equal(src.canSummon(), false);
    c.pushError(reserveError(reason));
    assert.equal(src.canSummon(), true);
    src.summon('right');
    assert.equal(c.summons, 2);
  });
}

test('6刻みたっても ready のまま（黙って捨てられた）なら待ちが外れる。それより前は外れない', () => {
  const { c, src } = setup();
  src.summon('left'); // 送った刻みは 60
  c.pushSnap(snap(62, 'ready'));
  c.pushSnap(snap(64, 'ready'));
  assert.equal(src.canSummon(), false);
  c.pushSnap(snap(66, 'ready'));
  assert.equal(src.canSummon(), true);
});

test('つなぎ直したら待ちが外れる（切れている間は押せず、戻ったら押せる）', () => {
  const { c, src } = setup();
  src.summon('left');
  c.setStatus('reconnecting');
  assert.equal(src.canSummon(), false);
  c.session++;
  c.setStatus('open');
  // つなぎ直したあとの最初の場面（同じ刻み）で、待ちを外す
  c.pushSnap(snap(60, 'ready'));
  assert.equal(src.canSummon(), true);
});

test('切れている間は押せない見た目にし、押しても送らない。戻ったらまた押せる。見た目を直す合図が届く', () => {
  const { c, src } = setup();
  let calls = 0;
  src.onControls?.(() => calls++);
  c.setStatus('reconnecting');
  assert.equal(calls, 1);
  assert.equal(src.canSummon(), false);
  src.summon('left');
  assert.equal(c.summons, 0);
  c.setStatus('open');
  assert.equal(calls, 2);
  assert.equal(src.canSummon(), true);
  src.summon('left');
  assert.equal(c.summons, 1);
});

test('遊軍のエラーで号令の返事待ちは減らず、号令のエラーで遊軍の返事待ちは外れない', () => {
  const { c, src } = setup();
  // 号令を3回送る（残り3回なので、返事待ちが3つになり、もう送れない）
  for (let i = 0; i < 3; i++) src.order('left', 'charge');
  assert.equal(c.orders, 3);
  assert.equal(src.canOrder('left', 'charge'), false);
  src.summon('left');
  // 遊軍のエラーでは、号令の待ちは減らない
  c.pushError(reserveError('invalid_reserve'));
  assert.equal(src.canOrder('left', 'charge'), false);
  assert.equal(src.canSummon(), true);
  src.summon('left');
  assert.equal(src.canSummon(), false);
  // 号令のエラーでは、号令の待ちが1つ減り、遊軍の待ちは外れない
  c.pushError({ type: 'error', reason: 'invalid_order' } as unknown as ErrorMessage);
  assert.equal(src.canOrder('left', 'charge'), true);
  assert.equal(src.canSummon(), false);
});

test('遊軍を使えない部屋（rules.reserve が false）では押せない', () => {
  const { c, src } = setup();
  c.room = { rules: { reserve: false } };
  assert.equal(src.canSummon(), false);
  src.summon('left');
  assert.equal(c.summons, 0);
});
