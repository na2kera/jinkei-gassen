// 対戦の画面に出す文（design §11.4 の C2・C3、§11.5-8 のロビーのいちばん下の行）。Phaser を読まない関数（net/pvpText.ts）を、画面なしで確かめる。
// node --experimental-strip-types --test で動かす。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remainingShown } from '../src/battle/reserveUi.ts';
import { LANDSCAPE_W } from '../src/layout.ts';
import { failureText } from '../src/net/RoomClient.ts';
import { foldAtPeriod, lobbyStatusLine, opponentMark, pvpRemainingText } from '../src/net/pvpText.ts';

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

type Seat = { name: string; connected: boolean; ready: boolean; left?: boolean };
const me: Seat = { name: '自分', connected: true, ready: false };
function roomWith(other: Seat | null, phase: 'waiting' | 'setup' | 'reveal' | 'battle' | 'result' = 'battle', you: 0 | 1 = 0) {
  return { phase, you, seats: (you === 0 ? [me, other] : [other, me]) as [Seat | null, Seat | null] };
}

test('C2 相手の印：left なら「相手 退出」、切れているだけなら「相手 切断」、つながっていれば空', () => {
  assert.equal(opponentMark(roomWith({ name: '相手', connected: false, ready: false, left: true }), true), '相手 退出');
  assert.equal(opponentMark(roomWith({ name: '相手', connected: false, ready: false, left: false }), true), '相手 切断');
  // 古い server は left を送らない（切れているだけとして読む）
  assert.equal(opponentMark(roomWith({ name: '相手', connected: false, ready: false }), true), '相手 切断');
  assert.equal(opponentMark(roomWith({ name: '相手', connected: true, ready: false, left: false }), true), '');
  // 陣営 1 から見ても、相手（陣営 0）の席を見る
  assert.equal(opponentMark(roomWith({ name: '相手', connected: false, ready: false, left: true }, 'result', 1), true), '相手 退出');
  // 待機中・相手の席がない・対戦の外（active でない）・部屋がないときは出さない（いままでどおり）
  assert.equal(opponentMark(roomWith({ name: '相手', connected: false, ready: false, left: true }, 'waiting'), true), '');
  assert.equal(opponentMark(roomWith(null, 'setup'), true), '');
  assert.equal(opponentMark(roomWith({ name: '相手', connected: false, ready: false }), false), '');
  assert.equal(opponentMark(null, true), '');
});

test('ロビーのいちばん下の行：生きている知らせ → 待機中の「相手が部屋を出ました」→ 空 の順で決める', () => {
  const none = { text: '', until: 0, error: true };
  const waitingLeft = { phase: 'waiting' as const, opponentLeft: true };
  assert.deepEqual(lobbyStatusLine(none, 1000, waitingLeft, true), { text: '相手が部屋を出ました', error: false });
  // 失敗の文などの知らせが生きているあいだは、そちらを先に出す。消えたら退出の文に戻る
  const fail = { text: '部屋が満員です', until: 2000, error: true };
  assert.deepEqual(lobbyStatusLine(fail, 1000, waitingLeft, true), { text: '部屋が満員です', error: true });
  assert.deepEqual(lobbyStatusLine(fail, 2000, waitingLeft, true), { text: '相手が部屋を出ました', error: false });
  const copied = { text: '写しました', until: 2000, error: false };
  assert.deepEqual(lobbyStatusLine(copied, 1000, waitingLeft, true), { text: '写しました', error: false });
  // 相手が出たわけでない・古い server（項目なし）・自分が部屋を出たあと（room なし・active でない）は出さない
  assert.equal(lobbyStatusLine(none, 1000, { phase: 'waiting', opponentLeft: false }, true).text, '');
  assert.equal(lobbyStatusLine(none, 1000, { phase: 'waiting' }, true).text, '');
  assert.equal(lobbyStatusLine(none, 1000, null, true).text, '');
  assert.equal(lobbyStatusLine(none, 1000, waitingLeft, false).text, '');
  assert.equal(lobbyStatusLine(none, 1000, { phase: 'setup', opponentLeft: true }, true).text, '');
});

test('幅に収まらない知らせは、句点の所で 2 行に折る（decisions §22）', () => {
  const outdated = failureText('outdated');
  // 縦持ち（内部の幅 320、左右 8 ずつの余白）では 2 行。各行は幅に収まる
  const folded = foldAtPeriod(outdated, 304);
  assert.equal(folded, '新しい版があります。\nページを読み込み直してください');
  for (const row of folded.split('\n')) assert.ok(row.length * 16 <= 304, row);
  // 横持ち（幅が足りる）では折らない
  assert.equal(foldAtPeriod(outdated, LANDSCAPE_W - 16), outdated);
  // 収まる文、句点のない文、句点が最後だけの文は、そのまま
  assert.equal(foldAtPeriod('部屋が満員です', 304), '部屋が満員です');
  assert.equal(foldAtPeriod('あ'.repeat(30), 304), 'あ'.repeat(30));
  assert.equal(foldAtPeriod('あ'.repeat(30) + '。', 304), 'あ'.repeat(30) + '。');
});
