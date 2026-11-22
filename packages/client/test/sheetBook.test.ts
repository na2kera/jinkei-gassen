// 揃いの頼みの世代と、届いた絵を受け付けるか（art/stack/sheetBook.ts。Codex のコードレビュー 4 回目の P1）を、画面なしで確かめる。
// stackTextures.ts の accept と同じ判断を、同じ順の出来事で流す。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BakeQueue, setSheets, type BakedSheet, type TaskSpec } from '../src/art/stack/jobs.ts';
import { SheetBook } from '../src/art/stack/sheetBook.ts';

/** stackTextures の「要る・取り込み済み・取り込み待ち」を写した小さな入れ物 */
function harness() {
  const book = new SheetBook();
  const wanted = new Set<string>();
  const ready = new Set<string>();
  const inbox: BakedSheet[] = [];
  const imported: string[] = [];
  return {
    book,
    request(): TaskSpec[] {
      const specs = book.stamp(setSheets('reveal').filter((s) => !ready.has(s.key) && !inbox.some((x) => x.key === s.key)));
      for (const s of specs) wanted.add(s.key);
      return specs.map((spec): TaskSpec => ({ t: 'sheet', spec }));
    },
    release(): void {
      book.release('reveal');
      for (const k of [...wanted]) if (k.startsWith('stk-reveal-')) wanted.delete(k);
      for (const k of [...ready]) if (k.startsWith('stk-reveal-')) ready.delete(k);
      inbox.length = 0;
    },
    accept(s: BakedSheet): boolean {
      const ok = book.accepts(s, (k) => wanted.has(k), (k) => ready.has(k), (k) => inbox.some((x) => x.key === k));
      if (ok) inbox.push(s);
      return ok;
    },
    importAll(): void {
      for (const s of inbox.splice(0)) {
        if (ready.has(s.key)) continue;
        ready.add(s.key);
        imported.push(s.key);
      }
    },
    imported,
  };
}

test('K1 公開の揃いを捨てて頼み直したとき、捨てる前に送られていた古い応答は受け付けず、同じ鍵を二度取り込まない', () => {
  const h = harness();
  // 1 回目の頼み（世代 0）。ワーカーは焼いて送るが、主スレッドに届くのは遅れる
  const old: BakedSheet[] = [];
  const q0 = new BakeQueue((s) => old.push(s));
  q0.push(h.request());
  q0.runAll();
  // 公開の画面で画面の大きさが変わった：release → request（世代 1）
  h.release();
  const fresh: BakedSheet[] = [];
  const q1 = new BakeQueue((s) => fresh.push(s));
  q1.push(h.request());
  q1.runAll();
  // 古い応答が先に届く → 全部捨てる
  for (const s of old) assert.equal(h.accept(s), false, `古い応答を受け付けた：${s.key}`);
  // 新しい応答 → 受け付ける。同じ応答がもう一度届いても重ねない
  for (const s of fresh) assert.equal(h.accept(s), true, s.key);
  for (const s of fresh) assert.equal(h.accept(s), false, `取り込み待ちに重ねた：${s.key}`);
  h.importAll();
  for (const s of fresh) assert.equal(h.accept(s), false, `取り込み済みに重ねた：${s.key}`);
  h.importAll();
  assert.deepEqual(h.imported, setSheets('reveal').map((s) => s.key));
  assert.equal(new Set(h.imported).size, h.imported.length);
  assert.ok(fresh.every((s) => s.gen === 1) && old.every((s) => s.gen === 0));
});

test('K2 ほかの揃い（配置・戦闘・木）は捨てないので世代 0 のまま。世代は揃いごとに別', () => {
  const b = new SheetBook();
  b.release('reveal');
  assert.equal(b.gen('reveal'), 1);
  for (const set of ['deploy', 'battle', 'tree'] as const) assert.equal(b.gen(set), 0);
  const s = { key: 'stk-battle-infantry', set: 'battle' as const };
  assert.equal(b.accepts(s, () => true, () => false, () => false), true);
  assert.equal(b.accepts({ ...s, gen: 1 }, () => true, () => false, () => false), false);
});
