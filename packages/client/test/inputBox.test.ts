// スマホの入力欄の崩れ（design §12、decisions §21。I1〜I4）。
// I1・I2：欄の位置の計算（ui/inputBox.ts）。I3：htmlInput.ts のソースの検査。I4：入力中は組み直さない判定（relayoutGate.ts）。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isTyping, relayoutGate } from '../src/relayoutGate.ts';
import { inputBox } from '../src/ui/inputBox.ts';

// 再現のときの iPhone SE（縦持ち）：#game は 0,0 375x667、canvas は 0,0 幅 375、内部の幅 320。コードの欄
const CODE = { x: 24, y: 300, w: 110, h: 40 };

test('I1：canvas と親が同じだけ動いても、結果が変わらない（スクロール 0・43・115・185）', () => {
  const base = inputBox({ left: 0, top: 0, width: 375 }, { left: 0, top: 0, width: 375 }, 320, CODE);
  for (const sy of [0, 43, 115, 185]) {
    const got = inputBox({ left: 0, top: -sy, width: 375 }, { left: 0, top: -sy, width: 375 }, 320, CODE);
    assert.deepEqual(got, base, `スクロール ${sy}`);
  }
  const k = 375 / 320;
  assert.equal(base.k, k);
  assert.equal(base.left, 24 * k);
  assert.equal(base.top, 300 * k);
  assert.equal(base.width, 110 * k);
  assert.equal(base.height, 40 * k);
});

test('I2：親に余白があるとき（canvas が中央寄せ）、欄が canvas の中の正しい位置に来る', () => {
  // 17 Pro の縦持ち：#game は左上 (0, 62)、canvas は margin-left 16 で (16, 62)、幅 368.5、内部の幅 320
  const parent = { left: 0, top: 62, width: 402 };
  const canvas = { left: 16, top: 62, width: 368.5 };
  const got = inputBox(canvas, parent, 320, CODE);
  const k = 368.5 / 320;
  assert.equal(got.k, k);
  assert.equal(got.left, 16 + 24 * k);
  assert.equal(got.top, 0 + 300 * k);
  // 画面の座標に直すと、canvas の矩形 + 内部の座標 × 倍率と同じ所に来る
  assert.ok(Math.abs(parent.left + got.left - (canvas.left + CODE.x * k)) < 1e-9);
  assert.ok(Math.abs(parent.top + got.top - (canvas.top + CODE.y * k)) < 1e-9);
  // 上下に余白があるとき（横持ちなど）も同じ
  const got2 = inputBox({ left: 100, top: 30, width: 600 }, { left: 40, top: 10, width: 720 }, 480, CODE);
  assert.equal(got2.left, 60 + 24 * 1.25);
  assert.equal(got2.top, 20 + 300 * 1.25);
});

test('I3：欄は親の中に absolute で置かれ、押し始めの伝わりを止める。離す側は止めない', () => {
  const src = readFileSync(new URL('../src/ui/htmlInput.ts', import.meta.url), 'utf8');
  // コメントを除いて調べる
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(code, /canvas\.parentElement/);
  assert.match(code, /position:\s*this\.parent\s*\?\s*'absolute'\s*:\s*'fixed'/);
  assert.match(code, /\(this\.parent \?\? document\.body\)\.appendChild\(el\)/);
  assert.match(code, /inputBox\(/);
  assert.match(code, /addEventListener\('touchstart',\s*stop\b/);
  assert.match(code, /addEventListener\('mousedown',\s*stop\b/);
  assert.match(code, /stopPropagation\(\)/);
  assert.doesNotMatch(code, /preventDefault/);
  // 消す前にフォーカスを外す（focusout を確実に出して、止めていた組み直しを走らせる）
  assert.match(code, /this\.el\.blur\(\);\s*this\.el\.remove\(\)/);
  for (const t of ['touchend', 'mouseup', 'pointerup', 'pointerdown', 'touchcancel']) {
    assert.doesNotMatch(code, new RegExp(`'${t}'`), `${t} を受けてはいけない`);
  }
  // 障害物の登録（hitRegistry）はそのまま使う
  assert.match(code, /addHitObstacle\(scene, rect\)/);
});

test('I4：入力中は relayout が走らず、フォーカスが外れたら1回走る', () => {
  assert.equal(isTyping({ tagName: 'INPUT' }), true);
  assert.equal(isTyping({ tagName: 'BODY' }), false);
  assert.equal(isTyping({ tagName: 'CANVAS' }), false);
  assert.equal(isTyping(null), false);
  assert.equal(isTyping(undefined), false);

  let typing = false;
  let runs = 0;
  let retries = 0;
  const gate = relayoutGate(
    () => typing,
    () => runs++,
    () => {
      retries++;
      gate.attempt(); // main.ts では少し待ってから attempt が呼ばれる
    },
  );
  // 入力していないときは、そのまま走る。外れても何もしない
  gate.attempt();
  assert.equal(runs, 1);
  gate.focusOut();
  assert.equal(retries, 0);

  // 入力中は何度来ても走らない
  typing = true;
  gate.attempt();
  gate.attempt();
  assert.equal(runs, 1);
  // 名前の欄からコードの欄へ移る（focusout は起きるが、待ったあともまだ入力中）：走らず、印は残る
  gate.focusOut();
  assert.equal(retries, 1);
  assert.equal(runs, 1);
  // 欄から離れたら1回だけ走る
  typing = false;
  gate.focusOut();
  assert.equal(retries, 2);
  assert.equal(runs, 2);
  // もう一度外れても、印がないので走らない
  gate.focusOut();
  assert.equal(retries, 2);
  assert.equal(runs, 2);
});
