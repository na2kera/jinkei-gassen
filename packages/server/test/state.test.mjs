// 保存してある部屋の状態の読み方（design §13.6）。server を立てずに、loadRoom をじかに試す。
// 盤が変わる前の形（v が 3 以下）は読まない（呼ぶ側が保存領域とアラームを消す。通しの確かめは version.test.mjs）。
// v 3 より前の形をそろえる処理（自分で出たことを知らせる前の形の S23 など）は、3 以下をすべて片付けるのでなくした。

import { describe, expect, it } from 'vitest';
import { loadRoom, newRoom, newSeat, publicSignature, ROOM_VERSION } from '../src/state.ts';
import { DEFAULT_TIMING } from '../src/timing.ts';

/** 盤が変わる前（v 3）の形で保存された部屋 */
function v3Room() {
  const seat = (pid) => ({ pid, name: pid, conn: null, goneSince: 5, ready: false, draft: null, lastValid: null, cv: 2, left: false });
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
    timing: { ...DEFAULT_TIMING },
    testMap: null,
    opponentLeft: false,
  };
}

describe('保存してある部屋の形の版', () => {
  it('新しい部屋は v 4', () => {
    expect(ROOM_VERSION).toBe(4);
    expect(newRoom('1234', 1, DEFAULT_TIMING).v).toBe(4);
  });

  it('v 3 以下（と版のない値・壊れた値）は読まない（null）', () => {
    for (const v of [3, 2, 1, 0, undefined, '4', null]) {
      const r = v3Room();
      if (v === undefined) delete r.v;
      else r.v = v;
      expect(loadRoom(r), JSON.stringify(v)).toBeNull();
    }
    expect(loadRoom(null)).toBeNull();
    expect(loadRoom('room')).toBeNull();
  });

  it('v 4 は、そのまま読み戻す（値を変えない）', () => {
    const s = newRoom('5678', 9, { ...DEFAULT_TIMING, awayMs: 1234 });
    s.seats = [newSeat('a', 'A', 3), newSeat('b', 'B', 3)];
    s.seats[0].left = true;
    s.opponentLeft = true;
    const saved = JSON.parse(JSON.stringify(s));
    const back = loadRoom(saved);
    expect(back).toEqual(s);
    expect(publicSignature(back)).toBe(publicSignature(s));
  });
});
