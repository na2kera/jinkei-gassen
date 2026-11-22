// 対戦のルール説明（design §10.7 の R1〜R5）。保存の読み方・印の付け方（実物の save.ts）、文言、置き場所、対戦の入口。
// window.localStorage を手で作った入れ物に差し替えてから save.ts を読み込む（tutorialSession.test.ts と同じ）。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeLayout, LANDSCAPE_H, LANDSCAPE_W, lobbyLayout, rulesDialogLayout, type Layout, type Rect } from '../src/layout.ts';
import { PVP_RULES_LINES, PVP_RULES_TITLE } from '../src/pvpRules.ts';
import { emptySave, sanitizeSave } from '../src/saveFormat.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

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

let fresh = 0;
async function freshSave(): Promise<typeof import('../src/save.ts')> {
  return (await import(`../src/save.ts?fresh=${++fresh}`)) as typeof import('../src/save.ts');
}

// ---- R1：保存の読み方 ----

test('R1 pvpRulesSeen：ない保存は false、true は true のまま、真偽でない値は false', () => {
  assert.equal(emptySave().pvpRulesSeen, false, '新しい保存');
  assert.equal(sanitizeSave({ v: 1, stars: { '1-1': 3 }, tutorialDone: true }).pvpRulesSeen, false, '項目のない古い保存（星があっても）');
  assert.equal(sanitizeSave({ v: 1, pvpRulesSeen: true }).pvpRulesSeen, true);
  assert.equal(sanitizeSave({ v: 1, pvpRulesSeen: false }).pvpRulesSeen, false);
  for (const bad of [1, 'true', null, {}, []]) {
    assert.equal(sanitizeSave({ v: 1, pvpRulesSeen: bad }).pvpRulesSeen, false, JSON.stringify(bad));
  }
  // 読み直しても同じ（書いた形をもう一度掃除しても変わらない）
  assert.equal(sanitizeSave(JSON.parse(JSON.stringify(sanitizeSave({ v: 1, pvpRulesSeen: true })))).pvpRulesSeen, true);
});

// ---- R2：実物の save.ts で印を付ける ----

test('R2 markPvpRulesSeen：付いていなければ書き込み、付いていれば書き込まない', async () => {
  mem.map.set(KEY, JSON.stringify({ v: 1, stars: {}, placements: {} }));
  const s = await freshSave();
  assert.equal(s.pvpRulesSeen(), false);
  const before = mem.writes;
  s.markPvpRulesSeen();
  assert.equal(mem.writes, before + 1, '1度だけ書いた');
  assert.equal(s.pvpRulesSeen(), true);
  assert.equal(JSON.parse(mem.getItem(KEY)!).pvpRulesSeen, true, '保存に書いた');
  s.markPvpRulesSeen();
  assert.equal(mem.writes, before + 1, '2度目は書かない');
  assert.equal((await freshSave()).pvpRulesSeen(), true, '読み直しても見た');

  // 付いている保存から始めても、書かない
  mem.map.set(KEY, JSON.stringify({ v: 1, pvpRulesSeen: true }));
  const t = await freshSave();
  const w = mem.writes;
  t.markPvpRulesSeen();
  assert.equal(mem.writes, w);

  // 開発用：外せる
  t.setPvpRulesSeenForDebug(false);
  assert.equal(t.pvpRulesSeen(), false);
  assert.equal((await freshSave()).pvpRulesSeen(), false);
});

// ---- R3：文言 ----

/** decisions §19 の文（ここに書き写して、画面の文言と比べる） */
const WANT = [
  '部隊を並べて、2分で陣を作る',
  '相手の陣は、開戦まで見えない',
  '開戦したら、部隊は自分で戦う',
  '号令は3回まで。全軍か翼に出す',
  '1部隊を遊軍にして、途中で呼べる',
  '敵の本陣を落とせば勝ち',
  '時間切れは、兵が多く残ったほう',
];

/** 全角を 16px、半角（ASCII）を 8px と数えた幅 */
function textWidth(s: string): number {
  return [...s].reduce((n, ch) => n + (/^[\x20-\x7e]$/.test(ch) ? 8 : 16), 0);
}

test('R3 文言：見出しと7行が decisions §19 と一字も違わず、どの行も縦長の箱の内側に収まる', () => {
  assert.equal(PVP_RULES_TITLE, '対戦のルール');
  assert.deepEqual([...PVP_RULES_LINES], WANT);
  // 書き写しの写し間違いを両方に入れてしまわないよう、decisions.md の §19 の番号つきの行とも比べる
  const doc = readFileSync(join(ROOT, '../../docs/decisions.md'), 'utf8');
  const sec = doc.slice(doc.indexOf('## 19. 対戦のルール説明'));
  const listed = [...sec.matchAll(/^ {2}(\d)\. (.+)$/gm)].slice(0, 7).map((m) => m[2]);
  assert.deepEqual(listed, WANT, 'decisions §19 の7行');
  assert.ok(sec.includes(`見出し「${PVP_RULES_TITLE}」`), 'decisions §19 の見出し');

  for (const size of [
    [320, 620],
    [320, 720],
  ] as const) {
    const r = rulesDialogLayout(computeLayout(size[0], size[1]));
    for (const line of [PVP_RULES_TITLE, ...PVP_RULES_LINES]) {
      assert.ok(textWidth(line) <= r.textW, `${line}（${textWidth(line)}px）が内側の幅 ${r.textW}px に収まる`);
    }
  }
  assert.equal(Math.max(...PVP_RULES_LINES.map(textWidth)), 248, 'いちばん長い行は「1部隊を遊軍にして、途中で呼べる」');
});

// ---- R4：置き場所 ----

function inside(a: Rect, b: Rect): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}
function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function screen(l: Layout): Rect {
  return { x: 0, y: 0, w: l.width, h: l.height };
}

test('R4 置き場所：箱と「閉じる」と本文が画面と箱に収まる。「ルール」は「戻る」と重ならない', () => {
  // 親の大きさから、縦長 320×620・320×720 と横長（LANDSCAPE_W × LANDSCAPE_H。672×400）になるものを選ぶ
  const cases: [number, number, string][] = [
    [320, 620, 'portrait'],
    [320, 720, 'portrait'],
    [LANDSCAPE_W, LANDSCAPE_H, 'landscape'],
  ];
  for (const [w, h, mode] of cases) {
    const l = computeLayout(w, h);
    assert.equal(l.mode, mode);
    assert.deepEqual([l.width, l.height], [w, h]);
    const r = rulesDialogLayout(l);
    const name = `${w}×${h}`;
    assert.ok(inside(r.box, screen(l)), `${name} 箱が画面に収まる ${JSON.stringify(r.box)}`);
    assert.ok(inside(r.close, r.box), `${name} 「閉じる」が箱の中`);
    assert.equal(r.box.w, mode === 'portrait' ? w - 16 : 320, `${name} 箱の幅`);
    // 見出しと本文の行が箱の中にあり、「閉じる」と重ならない
    const textRows: Rect[] = [{ x: r.title.x, y: r.title.y, w: r.textW, h: r.lineH }];
    for (let i = 0; i < PVP_RULES_LINES.length; i++) textRows.push({ x: r.lineX, y: r.lineY + i * r.lineH, w: r.textW, h: r.lineH });
    for (const t of textRows) {
      assert.ok(inside(t, r.box), `${name} 文の行が箱の中`);
      assert.ok(!overlap(t, r.close), `${name} 文の行と「閉じる」が重ならない`);
    }
    // 2px 単位（ドットの枠がずれないように）
    for (const v of [r.box.x, r.box.y, r.box.w, r.box.h, r.close.x, r.close.y]) assert.equal(v % 2, 0, `${name} 偶数 ${v}`);

    const lobby = lobbyLayout(l);
    assert.ok(inside(lobby.rules, screen(l)), `${name} 「ルール」が画面に収まる`);
    assert.ok(!overlap(lobby.rules, lobby.back), `${name} 「ルール」と「戻る」が重ならない`);
    assert.equal(lobby.rules.y, lobby.back.y, `${name} 「戻る」と同じ段`);
    assert.equal(lobby.rules.h, lobby.back.h, `${name} 「戻る」と同じ高さ`);
    // 入る前・入ったあとの表示物とも重ならない
    for (const other of [lobby.nameInput, lobby.create, lobby.codeInput, lobby.join, lobby.resume, lobby.codeBox, lobby.copy, lobby.leave]) {
      assert.ok(!overlap(lobby.rules, other), `${name} 「ルール」がロビーのほかの表示と重ならない ${JSON.stringify(other)}`);
    }
  }
});

// ---- R5：対戦の入口 ----

/** src の下の .ts を全部集める */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('R5 入口：pvpUnlocked がなくなり、タイトルの「対戦」は押せないようにしない', async () => {
  // 星が1つもない保存でも、対戦の入口を閉じる関数がない
  mem.map.set(KEY, JSON.stringify({ v: 1, stars: {} }));
  const ses = (await import('../src/session.ts')) as Record<string, unknown>;
  assert.equal('pvpUnlocked' in ses, false, 'session.ts に pvpUnlocked がない');
  for (const p of sources(join(ROOT, 'src'))) {
    assert.ok(!readFileSync(p, 'utf8').includes('pvpUnlocked'), `${p} が pvpUnlocked を読まない`);
  }
  // タイトルは Phaser を読むので node では作れない。代わりに、組み立ての文を読んで確かめる
  const title = readFileSync(join(ROOT, 'src/scenes/TitleScene.ts'), 'utf8');
  const pvpLine = title.split('\n').find((s) => s.includes("'対戦'"));
  assert.ok(pvpLine, '「対戦」のボタンがある');
  assert.match(pvpLine, /new Button\(this, t\.pvp, '対戦', \(\) => this\.scene\.start\('Lobby'\)\);/, '「対戦」はロビーを開くだけ');
  assert.ok(!title.includes('setEnabled'), 'タイトルのボタンを押せなくしない');
});
