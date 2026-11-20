// 保存してある部屋の状態の読み方（design §11.5-3、§11.5-11 の S23）。server を立てずに、normalizeRoom をじかに試す。

import { describe, expect, it } from 'vitest';
import { normalizeRoom, publicSignature } from '../src/state.ts';
import { DEFAULT_TIMING } from '../src/timing.ts';

/** 自分で出たことを知らせる前の形（席の left・部屋の opponentLeft・timing.leftMs がない）で保存された部屋 */
function oldRoom() {
  const { leftMs: _drop, ...oldTiming } = { ...DEFAULT_TIMING, awayMs: 1234 };
  const seat = (pid) => ({ pid, name: pid, conn: null, goneSince: 5, ready: false, draft: null, lastValid: null, cv: 2 });
  return {
    v: 3,
    code: '1234',
    gen: 7,
    phase: 'result',
    battleNo: 1,
    seats: [seat('a'), seat('b')],
    score: [0, 0, 1],
    map: 'plain',
    deadlines: { away: 100 },
    rematch: [false, false],
    lastResult: null,
    timing: oldTiming,
    testMap: null,
  };
}

describe('古い形の部屋の状態', () => {
  it('S23 left・opponentLeft・leftMs がなくても読め、false・false・既定の 15 秒になる。ほかの timing の値は保つ', () => {
    const s = normalizeRoom(oldRoom());
    expect(s.seats[0].left).toBe(false);
    expect(s.seats[1].left).toBe(false);
    expect(s.opponentLeft).toBe(false);
    expect(s.timing.leftMs).toBe(15_000);
    expect(s.timing.awayMs).toBe(1234);
    expect(s.deadlines).toEqual({ away: 100 });
    // 期限の計算に使っても NaN にならない
    expect(Number.isFinite(1000 + s.timing.leftMs)).toBe(true);
    // 外へ見える内容の比べ方にも入る（left と opponentLeft が変われば、room を送り直す）
    const sig = publicSignature(s);
    s.seats[0].left = true;
    expect(publicSignature(s)).not.toBe(sig);
    const sig2 = publicSignature(s);
    s.opponentLeft = true;
    expect(publicSignature(s)).not.toBe(sig2);
  });

  it('いまの形の値は変えない', () => {
    const r = oldRoom();
    r.opponentLeft = true;
    r.seats[0].left = true;
    r.timing.leftMs = 3000;
    const s = normalizeRoom(r);
    expect(s.opponentLeft).toBe(true);
    expect(s.seats[0].left).toBe(true);
    expect(s.seats[1].left).toBe(false);
    expect(s.timing.leftMs).toBe(3000);
  });
});
