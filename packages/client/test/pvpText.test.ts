// 対戦の画面に出す文（design §11.4 の C2・C3）。Phaser を読まない関数（net/pvpText.ts）を、画面なしで確かめる。
// node --experimental-strip-types --test で動かす。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remainingShown } from '../src/battle/reserveUi.ts';
import { pvpRemainingText } from '../src/net/pvpText.ts';

test('C3 対戦の結果の「残った兵」は、自軍・敵軍とも remaining（勝ち負けの数え方）で出す', () => {
  // 陣営 0 に呼ばなかった遊軍がいて、星の数え方（remainingForStars）では 13% に見える場面
  const s = { remaining: [0.08, 0.13] as [number, number], remainingForStars: [0.13, 0.13] as [number, number] };
  // 文の形（「残った兵 自軍…% 敵軍…%」）は、いままでどおり（自軍・敵軍のあとに空白を入れない）
  assert.equal(pvpRemainingText(s, 0), '残った兵 自軍8% 敵軍13%');
  // 陣営 1 から見ると、同じ数字が入れ替わる（2人の画面で食い違わない）
  assert.equal(pvpRemainingText(s, 1), '残った兵 自軍13% 敵軍8%');
  // 1人用の結果の画面（remainingShown）は、いままでどおり星の数え方を使う
  assert.equal(remainingShown(s, 0), 0.13);
  assert.equal(remainingShown(s, 1), 0.13);
});
