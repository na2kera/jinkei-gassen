// 押せる範囲を広げる計算（design §9.2、§9.9。M1〜M6・M11・M12）を、純粋な関数と実物の配置（layout.ts）で確かめる。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  battlePanel,
  battleReserveButtons,
  computeLayout,
  deployInfo,
  deployPanel,
  deployReserveSlot,
  lobbyLayout,
  pvpDeployPanel,
  resultLayout,
  stageSelectLayout,
  titleLayout,
  tutorialDeployHead,
  type Layout,
  type Rect,
} from '../src/layout.ts';
import { growGroups, growRects, HIT_GROW_MAX } from '../src/ui/hitGrow.ts';

const SCREEN: Rect = { x: 0, y: 0, w: 320, h: 620 };

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: Rect, inner: Rect): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;
}

test('M1 1つだけなら、4辺とも max まで広がる。画面の端で止まる', () => {
  assert.deepEqual(growRects([{ x: 100, y: 100, w: 50, h: 30 }], [], SCREEN, 8), [{ x: 92, y: 92, w: 66, h: 46 }]);
  // 左上の角に 3px だけ空けたボタン：左と上は 3 で止まる
  assert.deepEqual(growRects([{ x: 3, y: 3, w: 50, h: 30 }], [], SCREEN, 8), [{ x: 0, y: 0, w: 61, h: 41 }]);
  // 右下の端にぴったり：右と下は広がらない
  assert.deepEqual(growRects([{ x: 270, y: 590, w: 50, h: 30 }], [], SCREEN, 8), [{ x: 262, y: 582, w: 58, h: 38 }]);
});

test('M2 横に並んだ2つ（すき間 4）は、向かい合う辺が 2 ずつ広がり、重ならない', () => {
  const [a, b] = growRects(
    [
      { x: 100, y: 100, w: 50, h: 30 },
      { x: 154, y: 100, w: 50, h: 30 },
    ],
    [],
    SCREEN,
    8,
  );
  assert.equal(a!.x + a!.w, 152);
  assert.equal(b!.x, 152);
  assert.equal(a!.x, 92, '向かいのない辺は max まで');
  assert.ok(!overlaps(a!, b!));
});

test('M3 障害物のほうへは、すき間の半分までしか広がらない。障害物と重ならない', () => {
  const field = { x: 0, y: 0, w: 320, h: 100 };
  const [a] = growRects([{ x: 100, y: 105, w: 50, h: 30 }], [field], SCREEN, 8);
  assert.equal(a!.y, 103, 'すき間 5 の半分（切り捨て）で 2');
  assert.ok(!overlaps(a!, field));
  // 障害物が帯の外（斜め）なら、その向きは max まで
  const [b] = growRects([{ x: 100, y: 105, w: 50, h: 30 }], [{ x: 0, y: 0, w: 80, h: 90 }], SCREEN, 8);
  assert.equal(b!.y, 97);
  assert.equal(b!.x, 92);
});

test('M4 斜め隣の2つは、広げても重ならない', () => {
  const rects = [
    { x: 100, y: 100, w: 50, h: 30 },
    { x: 156, y: 136, w: 50, h: 30 },
    { x: 40, y: 140, w: 50, h: 30 },
  ];
  const g = growRects(rects, [], SCREEN, 8);
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) assert.ok(!overlaps(g[i]!, g[j]!), `${i} と ${j}`);
});

test('M5 重なっている2つは、互いを数えない（もとの矩形を含んだまま）', () => {
  const rects = [
    { x: 100, y: 100, w: 50, h: 30 },
    { x: 120, y: 110, w: 50, h: 30 },
  ];
  const g = growRects(rects, [], SCREEN, 8);
  assert.deepEqual(g[0], { x: 92, y: 92, w: 66, h: 46 });
  assert.deepEqual(g[1], { x: 112, y: 102, w: 66, h: 46 });
  rects.forEach((r, i) => assert.ok(contains(g[i]!, r)));
});

test('M11 (20,20,10,10) と (40,40,10,10)、max 8 で、広げたあと重ならない', () => {
  const [a, b] = growRects(
    [
      { x: 20, y: 20, w: 10, h: 10 },
      { x: 40, y: 40, w: 10, h: 10 },
    ],
    [],
    SCREEN,
    8,
  );
  assert.ok(!overlaps(a!, b!), JSON.stringify([a, b]));
});

test('M12 箱の組が1つでもあると、下の組はもとの矩形のまま。箱の組は障害物を数えない', () => {
  const field = { x: 0, y: 0, w: 320, h: 400 };
  const base = { x: 100, y: 420, w: 50, h: 30 };
  const popup = { x: 100, y: 200, w: 88, h: 28 };
  const popup2 = { x: 100, y: 230, w: 88, h: 28 };
  const g = growGroups(
    [
      { rect: base, group: 'base' },
      { rect: popup, group: 'popup' },
      { rect: popup2, group: 'popup' },
    ],
    [field],
    SCREEN,
    8,
  );
  assert.deepEqual(g[0], base, '下の組は広げない');
  assert.equal(g[1]!.x, 92, '箱の組は、戦場の上でも広がる');
  assert.equal(g[1]!.y + g[1]!.h, 229, '箱どうしは、すき間の半分');
  assert.equal(g[2]!.y, 229);
  // 箱がなくなれば、下の組は広がる（障害物はそのまま効く）
  const h = growGroups([{ rect: base, group: 'base' }], [field], SCREEN, 8);
  assert.deepEqual(h[0], { x: 92, y: 412, w: 66, h: 46 });
  const near = growGroups([{ rect: { x: 100, y: 404, w: 50, h: 30 }, group: 'base' }], [field], SCREEN, 8);
  assert.equal(near[0]!.y, 402, '障害物のほうへは半分まで');
});

// ---- M6：実物の配置 ----

interface Screen {
  name: string;
  buttons: Rect[];
  obstacles: Rect[];
}

/** 戦場の描き場所に枠 4px を足した矩形（DeployScene が入れる障害物と同じ。BattleScene の uiBounds＋4px は、どの視点でもこの中にあるので、これで確かめれば足りる） */
function fieldObstacle(l: Layout): Rect {
  const f = l.field;
  return { x: f.x - 4, y: f.y - 4, w: f.w + 8, h: f.h + 8 };
}

function screens(l: Layout): Screen[] {
  const out: Screen[] = [];
  const field = fieldObstacle(l);
  // 配置（1人用）。縦長は帯に「？」と遊軍の枠
  {
    const d = deployPanel(l);
    const info = deployInfo(l, false);
    out.push({
      name: '配置',
      buttons: [d.back, d.mute, ...d.roster, ...d.templates, d.formations, d.start, ...(info.hintButton ? [info.hintButton] : []), deployReserveSlot(l, false)],
      obstacles: [field],
    });
    // チュートリアル：「飛ばす」が広く、遊軍の枠と「？」がない
    out.push({ name: 'チュートリアルの配置', buttons: [tutorialDeployHead(l).back, d.mute, ...d.roster.slice(0, 2), d.start], obstacles: [field] });
  }
  // 対戦の配置
  {
    const d = pvpDeployPanel(l);
    out.push({
      name: '対戦の配置',
      buttons: [d.back, d.mute, ...d.roster, ...d.minus.slice(1), ...d.plus.slice(1), ...d.templates, d.formations, d.start, deployReserveSlot(l, true)],
      obstacles: [field],
    });
  }
  // 戦闘（遊軍のボタンも出ているとき）
  {
    const b = battlePanel(l);
    out.push({ name: '戦闘', buttons: [b.quit, b.mute, b.speed, ...b.targets, ...b.orders, b.view, ...battleReserveButtons(l)], obstacles: [field] });
  }
  // ロビー（入る前・入ったあと）。入力欄は障害物
  {
    const lb = lobbyLayout(l);
    out.push({ name: 'ロビー', buttons: [lb.back, lb.create, lb.join, lb.resume], obstacles: [lb.nameInput, lb.codeInput] });
    out.push({ name: 'ロビーの待ち', buttons: [lb.copy, lb.leave], obstacles: [] });
  }
  // 結果（1人用・対戦）
  {
    const r = resultLayout(l);
    out.push({ name: '結果', buttons: r.buttons, obstacles: [] });
    const [a, b, c] = r.buttons;
    out.push({ name: '対戦の結果', buttons: [{ x: a!.x, y: a!.y, w: b!.x + b!.w - a!.x, h: a!.h }, c!], obstacles: [] });
  }
  // ステージ選択（第1章は6行。章を切り替えるボタンが3つ）
  {
    const s = stageSelectLayout(l, 6);
    const w = Math.floor((s.heading.w - 2 * 4) / 3);
    const chapters = [0, 1, 2].map((i) => ({ x: s.heading.x + i * (w + 4), y: s.heading.y, w, h: s.heading.h }));
    out.push({ name: 'ステージ選択', buttons: [s.back, ...chapters, ...s.stages], obstacles: [] });
  }
  // タイトル
  {
    const t = titleLayout(l);
    out.push({ name: 'タイトル', buttons: [t.stage, t.pvp, t.mute], obstacles: [] });
  }
  return out;
}

const LAYOUTS: [string, Layout][] = [
  ['縦長 320×564（iPhone SE）', computeLayout(375, 547)],
  ['縦長 320×680', computeLayout(390, 829)],
  ['縦長 320×720（細長い端末）', computeLayout(402, 714 * 1.3)],
  ['横長 672×400', computeLayout(667, 325)],
];

test('M6 実物の配置：広げた範囲どうしが重ならない・戦場と重ならない・もとの矩形を含む・画面からはみ出さない', () => {
  for (const [lname, l] of LAYOUTS) {
    const bounds = { x: 0, y: 0, w: l.width, h: l.height };
    for (const s of screens(l)) {
      const at = `${lname} ${s.name}`;
      // もとの矩形どうしは重なっていない（前提の確かめ）
      for (let i = 0; i < s.buttons.length; i++) for (let j = i + 1; j < s.buttons.length; j++) assert.ok(!overlaps(s.buttons[i]!, s.buttons[j]!), `${at}：もとの ${i} と ${j} が重なる`);
      const g = growRects(s.buttons, s.obstacles, bounds, HIT_GROW_MAX);
      g.forEach((r, i) => {
        assert.ok(contains(r, s.buttons[i]!), `${at}：${i} がもとの矩形を含まない`);
        assert.ok(contains(bounds, r), `${at}：${i} が画面からはみ出す`);
        for (const o of s.obstacles) assert.ok(!overlaps(r, o), `${at}：${i} が障害物と重なる`);
        for (let j = i + 1; j < g.length; j++) assert.ok(!overlaps(r, g[j]!), `${at}：${i} と ${j} が重なる`);
      });
    }
  }
});

test('M6 iPhone SE の縦（320×564。縦長の下限。design §14.6）で、主なボタンが広がっている', () => {
  const l = computeLayout(375, 547);
  assert.equal(l.height, 564);
  const bounds = { x: 0, y: 0, w: l.width, h: l.height };
  const all = screens(l);
  const grownOf = (name: string, r: Rect): Rect => {
    const s = all.find((x) => x.name === name)!;
    // 配置の関数は呼ぶたびに新しい矩形を返すので、値で探す
    const i = s.buttons.findIndex((b) => b.x === r.x && b.y === r.y && b.w === r.w && b.h === r.h);
    assert.ok(i >= 0, name);
    return growRects(s.buttons, s.obstacles, bounds, HIT_GROW_MAX)[i]!;
  };
  const d = deployPanel(l);
  const roster = grownOf('配置', d.roster[1]!);
  assert.ok(roster.h > d.roster[1]!.h && roster.w > d.roster[1]!.w, '配置の兵種');
  const tpl = grownOf('配置', d.templates[1]!);
  assert.ok(tpl.h > d.templates[1]!.h, 'ひな形');
  const b = battlePanel(l);
  const order = grownOf('戦闘', b.orders[1]!);
  assert.ok(order.h > b.orders[1]!.h, '号令');
  const p = pvpDeployPanel(l);
  const minus = grownOf('対戦の配置', p.minus[1]!);
  assert.ok(minus.h > p.minus[1]!.h, '対戦の配置の「−」');
});
