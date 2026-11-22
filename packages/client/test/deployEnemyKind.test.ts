// 配置の画面で敵の部隊を押したときの分かれ目と、部隊の上に出す箱の置き場所を、画面なしで確かめる。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGES, stageEnemyVisible } from '@jinkei/engine';
import { enemyAt } from '../src/scenes/enemyKind.ts';
import { KIND_LABEL } from '../src/ui/labels.ts';
import { unitBoxAt } from '../src/ui/unitBox.ts';

const stage22 = STAGES.find((s) => s.id === '2-2');
if (!stage22) throw new Error('面 2-2 がない');

// 座標は面のデータから読む（面を置き直しても、確かめる中身が変わらないように）
const fogged = (p: { col: number; row: number }): boolean => (stage22.fog ?? []).some((c) => c.col === p.col && c.row === p.row);

test('見えている敵のいるマスでは、その部隊の兵種が引ける', () => {
  const visible = stageEnemyVisible(stage22);
  const hq = visible.find((p) => p.kind === 'hq');
  const infantry = visible.find((p) => p.kind === 'infantry');
  assert.ok(hq && infantry, '2-2 には、霧の外に本陣と歩兵がいる');
  assert.equal(enemyAt(visible, { col: hq.col, row: hq.row })?.kind, 'hq');
  assert.equal(enemyAt(visible, { col: infantry.col, row: infantry.row })?.kind, 'infantry');
  assert.equal(KIND_LABEL.infantry, '歩兵');
});

test('敵のいないマスでは、何も引けない', () => {
  // あいだの行（敵の配置エリアの外）で、敵も霧もないマス
  const row = stage22.field.height / 2;
  const col = Math.floor(stage22.field.width / 2);
  assert.ok(!stage22.enemy.some((p) => p.col === col && p.row === row), '確かめるマスに敵がいない');
  assert.equal(enemyAt(stageEnemyVisible(stage22), { col, row }), null);
});

test('霧のマスの部隊は、いても引けない', () => {
  // 2-2 は、霧のマスに迂回の騎兵がいる
  const hidden = stage22.enemy.find((p) => p.kind === 'cavalry' && fogged(p));
  assert.ok(hidden, '2-2 には、霧の中に騎兵がいる');
  assert.equal(enemyAt(stageEnemyVisible(stage22), { col: hidden.col, row: hidden.row }), null);
});

test('対戦の配置（見えている敵がない）では、何も引けない', () => {
  assert.equal(enemyAt([], { col: 5, row: 0 }), null);
});

test('どの面でも、霧のマスは引けず、見えている部隊は引け、方針は含まない', () => {
  for (const stage of STAGES) {
    const visible = stageEnemyVisible(stage);
    for (const c of stage.fog ?? []) assert.equal(enemyAt(visible, c), null, `${stage.id} 霧 ${c.col},${c.row}`);
    for (const p of visible) {
      const e = enemyAt(visible, p);
      assert.equal(e?.kind, p.kind, `${stage.id} ${p.col},${p.row}`);
      assert.ok(e && !('stance' in e), `${stage.id} 方針が入っている`);
    }
  }
});

/** 切り出す前の BattleScene の drawInfo の式（そのまま写したもの） */
function before(f: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }, w: number, h: number, lift: number) {
  const x = Math.round(Math.max(f.x, Math.min(f.x + f.w - w, p.x - w / 2)) / 2) * 2;
  const y = Math.round((p.y - lift - h >= f.y ? p.y - lift - h : p.y + 20) / 2) * 2;
  return { x, y };
}

test('箱の置き場所は、切り出す前の式と同じ（上・下・左右の端）', () => {
  const f = { x: 16, y: 40, w: 288, h: 384 };
  for (const lift of [20, 34]) {
    for (const w of [48, 49, 80]) {
      for (const h of [28, 46]) {
        for (let px = f.x - 10; px <= f.x + f.w + 10; px += 3.5) {
          for (let py = f.y - 4; py <= f.y + f.h + 4; py += 2.7) {
            assert.deepEqual(unitBoxAt(f, { x: px, y: py }, w, h, lift), before(f, { x: px, y: py }, w, h, lift));
          }
        }
      }
    }
  }
  // 上に入れば上、入らなければ下（p.y + 20）
  assert.deepEqual(unitBoxAt(f, { x: 160, y: 200 }, 48, 28, 20), { x: 136, y: 152 });
  assert.deepEqual(unitBoxAt(f, { x: 160, y: 60 }, 48, 28, 20), { x: 136, y: 80 });
  // 左右の端では戦場の中に収める
  assert.equal(unitBoxAt(f, { x: 20, y: 200 }, 48, 28, 20).x, 16);
  assert.equal(unitBoxAt(f, { x: 300, y: 200 }, 48, 28, 20).x, 256);
});
