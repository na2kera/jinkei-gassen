// チュートリアルの保存と、面の一覧を見る関数（design §8.9 の U6・U7）を、実物の save.ts・session.ts・tutorial/run.ts で確かめる。
// window.localStorage を手で作った入れ物に差し替えてから読み込む（save.ts は import.meta.env がないとき、本番と同じ鍵を使う）。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Placement } from '@jinkei/engine';

/** localStorage の代わり。書いた回数も数える */
class MemoryStorage {
  readonly map = new Map<string, string>();
  writes = 0;
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.writes++;
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.writes++;
    this.map.delete(k);
  }
}

const KEY = 'jinkei-gassen/v1';
const mem = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: mem, location: { search: '' } };

/** save.ts を新しく読み込む（保存の読み込みは1度だけ覚えておく作りなので、読み直しを試すときは別の写しを読む） */
let fresh = 0;
async function freshSave(): Promise<typeof import('../src/save.ts')> {
  return (await import(`../src/save.ts?fresh=${++fresh}`)) as typeof import('../src/save.ts');
}

// ---- U6：実物の save.ts で、済みの印を読む・付ける・消す ----

test('U6 実物の save.ts：古い保存の読み方・markTutorialDone のあとに読み直す・clearSave のあと', async () => {
  mem.map.set(KEY, JSON.stringify({ v: 1, stars: { '1-1': 1 }, placements: {}, muted: false }));
  assert.equal((await freshSave()).tutorialDone(), true, '項目がなく星があれば済み');

  mem.map.set(KEY, JSON.stringify({ v: 1, stars: { '1-1': 3 }, tutorialDone: false }));
  assert.equal((await freshSave()).tutorialDone(), false, '明示的な false');

  mem.map.set(KEY, JSON.stringify({ v: 1, stars: {}, placements: {} }));
  const s = await freshSave();
  assert.equal(s.tutorialDone(), false, '星がなければ済みでない');
  s.markTutorialDone();
  assert.equal(s.tutorialDone(), true);
  assert.equal(JSON.parse(mem.getItem(KEY)!).tutorialDone, true, '保存に書いた');
  const writes = mem.writes;
  s.markTutorialDone();
  assert.equal(mem.writes, writes, '2度目は書かない');
  assert.equal((await freshSave()).tutorialDone(), true, '読み直しても済み');

  s.clearSave();
  assert.equal(s.tutorialDone(), false, 'clearSave のあとは済みでない');
  assert.equal(mem.getItem(KEY), null);
  assert.equal((await freshSave()).tutorialDone(), false, '消したあとに読み直しても済みでない');
});

// ---- U7：面の一覧を見る関数と、チュートリアルのあいだの保存 ----

test('U7 チュートリアルの前・あいだ・あとで、面の一覧を見る関数の答えが同じ。保存の配置・星・視点は変わらない。終える処理は1度だけ', async () => {
  const before1_1: Placement[] = [{ kind: 'hq', col: 5, row: 14, stance: 'hold' }];
  mem.map.set(
    KEY,
    JSON.stringify({ v: 1, stars: { '1-1': 2, '1-2': 1 }, placements: { '1-1': before1_1 }, muted: true, view: 'general', tutorialDone: false }),
  );
  // session.ts と tutorial/run.ts が使うのと同じ save.ts（ここで初めて読み込む）
  const save = await import('../src/save.ts');
  const ses = await import('../src/session.ts');
  const run = await import('../src/tutorial/run.ts');
  const { STAGES, TUTORIAL_ARMY } = await import('@jinkei/engine');

  const answers = (): unknown => ({
    ordered: ses.orderedStages().map((s) => s.id),
    next: STAGES.map((s) => ses.nextStage(s.id)?.id ?? null),
    unlocked: STAGES.map((s) => ses.isUnlocked(s)),
    chapters: ses.chapters(),
  });
  const want = answers();
  // チュートリアルを足す前の答え（STAGES の15面、章 1〜3、1-1〜1-3 が開いている。対戦が開く条件は 2026-11-20 にやめたので見ない。design §10.1）
  assert.deepEqual(want, {
    ordered: ['1-1', '1-2', '1-3', '1-4', '1-5', '2-1', '2-2', '2-3', '2-4', '2-5', '3-1', '3-2', '3-3', '3-4', '3-5'],
    next: ['1-2', '1-3', '1-4', '1-5', '2-1', '2-2', '2-3', '2-4', '2-5', '3-1', '3-2', '3-3', '3-4', '3-5', null],
    unlocked: [true, true, true, false, false, false, false, false, false, false, false, false, false, false, false],
    chapters: [1, 2, 3],
  });
  assert.equal(ses.nextStage('tutorial'), null);
  assert.equal(ses.stageById('tutorial')?.name, '遊び方');

  ses.session.stageId = '1-2';
  const stored = mem.getItem(KEY);
  const writes = mem.writes;

  // 配置の画面と同じく、手順を進めながら配置を session に置く
  run.startTutorial('list');
  assert.equal(ses.session.stageId, 'tutorial');
  const acts = [
    { type: 'pickKind', kind: 'hq' },
    { type: 'cell', col: 5, row: 14 },
    { type: 'pickKind', kind: 'infantry' },
    { type: 'cell', col: 4, row: 10 },
    { type: 'cell', col: 5, row: 10 },
    { type: 'cell', col: 6, row: 10 },
    { type: 'unit', col: 5, row: 10 },
    { type: 'stance', stance: 'hunt' },
  ] as const;
  for (const a of acts) {
    assert.equal(run.tutorialAct(a), true, JSON.stringify(a));
    ses.setPlacements(ses.session.tutorial!.placed.map((p) => ({ ...p })), null);
    assert.deepEqual(answers(), want);
  }
  assert.deepEqual(ses.session.placements.length, TUTORIAL_ARMY.length);
  assert.equal(mem.getItem(KEY), stored, 'チュートリアルのあいだ、保存は変わらない');
  assert.equal(mem.writes, writes, 'チュートリアルのあいだ、保存に書かない');

  // 戦いと画面の代わり（捨てた回数と、移った画面を数える）
  let disposed = 0;
  run.setTutorialBattle({ dispose: () => disposed++, paused: false, resume: () => {} } as never);
  const starts: [string, unknown][] = [];
  const scene = { scene: { start: (k: string, d?: unknown) => starts.push([k, d]) } } as never;
  run.finishTutorial(scene);
  run.finishTutorial(scene);
  assert.deepEqual(starts, [['StageSelect', undefined]], '画面の移動は1回だけ');
  assert.equal(disposed, 1, '戦いを捨てるのは1回だけ');
  assert.equal(mem.writes, writes + 1, '済みの印を書くのは1回だけ');
  assert.equal(save.tutorialDone(), true);
  assert.equal(ses.session.tutorial, null);
  assert.equal(ses.session.stageId, '1-2', 'ステージ選択から始めたら、始める前の面に戻す');

  // 済みの印のほかは変わらない
  const after = JSON.parse(mem.getItem(KEY)!);
  const prev = JSON.parse(stored!);
  assert.deepEqual(after.stars, prev.stars);
  assert.deepEqual(after.placements, prev.placements);
  assert.equal(after.view, 'general');
  assert.equal(after.placements.tutorial, undefined);
  assert.deepEqual(answers(), want);

  // タイトルから自動で始めたときは、1-1 の配置の画面へ。済みの印はもう付いているので書かない
  run.startTutorial('auto');
  run.finishTutorial(scene);
  run.finishTutorial(scene);
  assert.deepEqual(starts.slice(1), [['Deploy', { stageId: '1-1' }]]);
  assert.equal(mem.writes, writes + 1);
  assert.equal(ses.session.stageId, '1-1');
});
