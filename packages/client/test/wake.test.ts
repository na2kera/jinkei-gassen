// 画面を消さない仕組み（design §9.5、§9.9-7。M7〜M9・M14）を、navigator.wakeLock と document を差し替えて確かめる。
// wake.ts はモジュールの中に状態を持つので、テストごとに別の写しを読む（?fresh=N）。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';

/** WakeLockSentinel のにせもの */
class FakeSentinel extends EventTarget {
  released = false;
  releaseCalls = 0;
  async release(): Promise<void> {
    this.releaseCalls++;
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  }
}

/** navigator.wakeLock のにせもの。答えは手で返す（届く前に理由を外す、を試すため） */
class FakeWakeLock {
  calls = 0;
  sentinels: FakeSentinel[] = [];
  private pending: { resolve: (s: FakeSentinel) => void; reject: (e: unknown) => void }[] = [];
  /** true なら、頼まれたらすぐ断る */
  deny = false;
  request(type: 'screen'): Promise<FakeSentinel> {
    assert.equal(type, 'screen');
    this.calls++;
    if (this.deny) return Promise.reject(new DOMException('no', 'NotAllowedError'));
    return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
  }
  /** 待っている頼みに、見張りを返す */
  grant(): FakeSentinel {
    const p = this.pending.shift();
    assert.ok(p, '頼まれていない');
    const s = new FakeSentinel();
    this.sentinels.push(s);
    p.resolve(s);
    return s;
  }
}

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

const doc = new FakeDocument();
(globalThis as unknown as { document: unknown }).document = doc;

let fresh = 0;
async function freshWake(): Promise<typeof import('../src/wake.ts')> {
  return (await import(`../src/wake.ts?fresh=${++fresh}`)) as typeof import('../src/wake.ts');
}

/** promise の続きを回す */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

test('M7 理由が2つあるうち1つを外しても持ったまま、両方外すと release する', async () => {
  const wl = new FakeWakeLock();
  setNavigator({ wakeLock: wl });
  const w = await freshWake();
  w.holdWake('battle');
  w.holdWake('pvp');
  assert.equal(wl.calls, 1, '2つ目の理由では頼み直さない（頼んでいる途中）');
  const s = wl.grant();
  await flush();
  assert.equal(w.wakeState().held, true);
  w.releaseWake('battle');
  await flush();
  assert.equal(s.releaseCalls, 0, '1つ残っていれば持ったまま');
  assert.equal(w.wakeState().held, true);
  w.releaseWake('pvp');
  await flush();
  assert.equal(s.releaseCalls, 1, '両方外すと release');
  assert.equal(w.wakeState().held, false);
  assert.deepEqual(w.wakeState().reasons, []);
});

test('M8 断られたら投げずに終わり、次の pointerup でもう一度頼む。頼んでいる途中に理由がなくなったら、届いた見張りを release する', async () => {
  const wl = new FakeWakeLock();
  setNavigator({ wakeLock: wl });
  const w = await freshWake();
  w.installWake();
  wl.deny = true;
  w.holdWake('battle');
  await flush();
  assert.equal(wl.calls, 1);
  assert.equal(w.wakeState().denied, 1);
  assert.equal(w.wakeState().held, false);
  // 次に指を離したとき
  wl.deny = false;
  doc.dispatchEvent(new Event('pointerup'));
  assert.equal(wl.calls, 2, 'pointerup で頼み直す');
  wl.grant();
  await flush();
  assert.equal(w.wakeState().held, true);

  // 頼んでいる途中に理由がなくなる
  const wl2 = new FakeWakeLock();
  setNavigator({ wakeLock: wl2 });
  const w2 = await freshWake();
  w2.holdWake('pvp');
  w2.releaseWake('pvp');
  await flush();
  const s = wl2.grant();
  await flush();
  assert.equal(s.releaseCalls, 1, '届いた見張りをすぐ放す');
  assert.equal(w2.wakeState().held, false);
  setNavigator({ wakeLock: wl });
});

test('M9 仕組みがない（navigator.wakeLock がない）とき、何を呼んでも投げない', async () => {
  setNavigator({});
  const w = await freshWake();
  w.installWake();
  w.installWake();
  w.holdWake('battle');
  doc.dispatchEvent(new Event('pointerup'));
  doc.dispatchEvent(new Event('touchend'));
  doc.dispatchEvent(new Event('visibilitychange'));
  w.releaseWake('battle');
  w.releaseWake('nothing');
  await flush();
  assert.deepEqual(w.wakeState(), { reasons: [], supported: false, held: false, requests: 0, denied: 0 });
  // request が投げる端末でも投げない
  setNavigator({
    wakeLock: {
      request(): never {
        throw new Error('x');
      },
    },
  });
  const w2 = await freshWake();
  w2.holdWake('battle');
  assert.equal(w2.wakeState().denied, 1);
});

test('M14 pointerup と touchend が続けて来ても頼むのは1回。古い見張りの release の合図が新しい見張りを消さない。外してすぐ入れ直しても持ったまま', async () => {
  const wl = new FakeWakeLock();
  setNavigator({ wakeLock: wl });
  const w = await freshWake();
  w.installWake();
  w.installWake();
  wl.deny = true;
  w.holdWake('battle');
  await flush();
  wl.deny = false;
  const before = wl.calls;
  doc.dispatchEvent(new Event('pointerup'));
  doc.dispatchEvent(new Event('touchend'));
  assert.equal(wl.calls - before, 1, '続けて来ても1回（installWake を2度呼んでも、受け手は1つ）');
  const old = wl.grant();
  await flush();
  assert.equal(w.wakeState().held, true);

  // 画面を閉じた：OS が見張りを放す → 戻ってきたら頼み直す
  await old.release();
  assert.equal(w.wakeState().held, false);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  const now = wl.grant();
  await flush();
  assert.equal(w.wakeState().held, true);
  // 古い見張りの合図がもう一度来ても、新しい見張りは消えない
  old.dispatchEvent(new Event('release'));
  assert.equal(w.wakeState().held, true);

  // 外してすぐ入れ直す（戦闘の画面を作り直すときなど）
  w.releaseWake('battle');
  w.holdWake('battle');
  await flush();
  assert.equal(now.releaseCalls, 0, '放さない');
  assert.equal(w.wakeState().held, true);
  assert.equal(wl.calls, 3, '頼み直さない');
});
