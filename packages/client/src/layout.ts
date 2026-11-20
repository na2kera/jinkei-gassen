// 画面の置き場所を決める唯一の場所（design §5.3、assumptions S13）。
// シーンはここで決めた矩形を読むだけにし、座標の数字を直書きしない。
// 向きが変わったときに、ここを計算し直すだけで全画面が組み直せるようにするため。

export type Mode = 'landscape' | 'portrait';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  mode: Mode;
  /** 内部の大きさ（Phaser の gameSize） */
  width: number;
  height: number;
  /** 戦場を描く矩形（どちらの向きでも 288 × 384） */
  field: Rect;
  /** 操作の欄 */
  panel: Rect;
  /**
   * 縦長だけ：戦場のすぐ下の1行の帯。中間地帯には地形が置かれるので、戦場の上に文字の箱を重ねず、
   * 面のヒント・陣形名・対戦の残り時間などはここに出す。横長は操作の欄に空きがあるので null
   */
  strip: Rect | null;
}

/** 1マスの大きさ（px） */
export const CELL = 24;
export const FIELD_COLS = 12;
export const FIELD_ROWS = 16;
const FIELD_W = CELL * FIELD_COLS;
const FIELD_H = CELL * FIELD_ROWS;

const LANDSCAPE_W = 640;
const LANDSCAPE_H = 400;
const PORTRAIT_W = 320;
// S13 の下限は 568 だが、面の名前・戻る・ひな形2列と、戦場の下の1行の帯が入るよう 620 にする（これより細長い端末では左右が少し空く）
const PORTRAIT_MIN_H = 620;
// 縦に伸ばしすぎると FIT で全体が小さくなるので上限を置く（細長い端末でも 19.5:9 程度まで）
const PORTRAIT_MAX_H = 720;
const GAP = 8;
/** 戦場の枠（4px）のぶんも含めた、戦場と操作の欄のあいだ */
const PANEL_GAP = 12;
/** 縦長の、戦場の下の1行の帯（戦場の枠 4px のぶんを空けてから置く） */
const STRIP_GAP = 8;
const STRIP_H = 24;
const PANEL_GAP_PORTRAIT = 6;
/** 縦長の操作の欄の高さ（配置と戦闘のどちらのボタンも収まる高さ） */
const PORTRAIT_PANEL_H = 190;

/** 2px 単位に揃える（ドットの枠がずれないように） */
function even(n: number): number {
  return Math.round(n / 2) * 2;
}

/** 親要素の大きさから、向きと内部の大きさを決める */
export function computeLayout(parentW: number, parentH: number): Layout {
  const portrait = parentW > 0 && parentH > 0 && parentH > parentW;
  if (!portrait) {
    return {
      mode: 'landscape',
      width: LANDSCAPE_W,
      height: LANDSCAPE_H,
      field: { x: GAP, y: GAP, w: FIELD_W, h: FIELD_H },
      panel: { x: GAP * 2 + FIELD_W, y: GAP, w: LANDSCAPE_W - FIELD_W - GAP * 3, h: FIELD_H },
      strip: null,
    };
  }
  // 画面の縦横比に合わせて縦を伸ばす。伸ばした分は、戦場と操作の欄をひとまとまりにして縦の中央に寄せ、
  // 上下に均等に配る（操作の欄の下だけが大きく空かないようにするため）
  const h = Math.min(PORTRAIT_MAX_H, Math.max(PORTRAIT_MIN_H, Math.round((PORTRAIT_W * parentH) / parentW)));
  const fieldX = (PORTRAIT_W - FIELD_W) / 2;
  // 戦場・1行の帯・操作の欄を、ひとまとまりにして縦の中央に寄せる
  const block = FIELD_H + STRIP_GAP + STRIP_H + PANEL_GAP_PORTRAIT + PORTRAIT_PANEL_H;
  const top = even(Math.max(GAP, (h - block) / 2));
  const stripY = top + FIELD_H + STRIP_GAP;
  return {
    mode: 'portrait',
    width: PORTRAIT_W,
    height: h,
    field: { x: fieldX, y: top, w: FIELD_W, h: FIELD_H },
    strip: { x: GAP, y: stripY, w: PORTRAIT_W - GAP * 2, h: STRIP_H },
    panel: { x: GAP, y: stripY + STRIP_H + PANEL_GAP_PORTRAIT, w: PORTRAIT_W - GAP * 2, h: PORTRAIT_PANEL_H },
  };
}

let current: Layout = computeLayout(LANDSCAPE_W, LANDSCAPE_H);

export function getLayout(): Layout {
  return current;
}

export function setLayout(next: Layout): void {
  current = next;
}

export function sameSize(a: Layout, b: Layout): boolean {
  return a.width === b.width && a.height === b.height;
}

/** game.events に流す、置き場所が変わった合図 */
export const LAYOUT_EVENT = 'jg-layout';

/** 横に n 個、同じ幅で並べる（端数は左から1px ずつ配る代わりに、全体を左に寄せる） */
function row(x: number, y: number, w: number, h: number, n: number, gap: number): Rect[] {
  const bw = Math.floor((w - gap * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => ({ x: x + i * (bw + gap), y, w: bw, h }));
}

/** 配置の画面の操作の欄 */
export interface DeployPanel {
  /** ステージ選択へ戻る */
  back: Rect;
  /** 面の名前を書く場所（左端と縦の中央） */
  name: { x: number; y: number };
  /** 音を切るボタン */
  mute: Rect;
  /** 手持ち5種（本陣・歩兵・盾兵・騎兵・弓兵の順） */
  roster: Rect[];
  /** ひな形7つ */
  templates: Rect[];
  /** 陣形の保存と呼び出し（ひな形と同じ並びの8つ目） */
  formations: Rect;
  start: Rect;
}

const MUTE_W = 64;
const BACK_W = 56;

export function deployPanel(l: Layout): DeployPanel {
  const p = l.panel;
  const head = 32;
  const back = { x: p.x, y: p.y, w: BACK_W, h: head };
  const mute = { x: p.x + p.w - MUTE_W, y: p.y, w: MUTE_W, h: head };
  const name = { x: p.x + BACK_W + 8, y: p.y + head / 2 };
  if (l.mode === 'landscape') {
    const roster = row(p.x, p.y + 42, p.w, 36, 5, 4);
    const t1 = row(p.x, p.y + 88, p.w, 32, 4, 4);
    const t2 = row(p.x, p.y + 124, p.w, 32, 4, 4);
    return { back, name, mute, roster, templates: [...t1, ...t2.slice(0, 3)], formations: t2[3]!, start: { x: p.x, y: p.y + p.h - 40, w: p.w, h: 40 } };
  }
  // ひな形は1列に7つ並べると、名前が枠に触れるほど窮屈になるので、4つと3つの2列にする
  const roster = row(p.x, p.y + 38, p.w, 32, 5, 4);
  const t1 = row(p.x, p.y + 76, p.w, 30, 4, 4);
  const t2 = row(p.x, p.y + 110, p.w, 30, 4, 4);
  return { back, name, mute, roster, templates: [...t1, ...t2.slice(0, 3)], formations: t2[3]!, start: { x: p.x, y: p.y + 148, w: p.w, h: 38 } };
}

/** 戦闘の画面の操作の欄 */
export interface BattlePanel {
  time: Rect;
  /** 号令の残りの印（3つ） */
  marks: Rect[];
  /** やめる（配置へ戻る） */
  quit: Rect;
  /** 音を切るボタン */
  mute: Rect;
  speed: Rect;
  /** 全軍・左翼・中央・右翼 */
  targets: Rect[];
  /** 突撃・堅守・後退 */
  orders: Rect[];
  /** 視点（真上・斜め・横から・将軍）の切り替え（design §5.7、§5.8） */
  view: Rect;
}

export function battlePanel(l: Layout): BattlePanel {
  const p = l.panel;
  const top = 32;
  const bh = l.mode === 'landscape' ? 36 : 34;
  const marks = [0, 1, 2].map((i) => ({ x: p.x + 44 + i * 16, y: p.y + (top - 10) / 2, w: 10, h: 10 }));
  const speed = { x: p.x + p.w - 56, y: p.y, w: 56, h: top };
  const mute = { x: speed.x - 4 - MUTE_W, y: p.y, w: MUTE_W, h: top };
  const quit = { x: p.x + 96, y: p.y, w: mute.x - 4 - (p.x + 96), h: top };
  const targets = row(p.x, p.y + top + 8, p.w, bh, 4, 4);
  const orders = row(p.x, p.y + top + 8 + bh + 6, p.w, bh, 3, 4);
  const ordersBottom = p.y + top + 8 + bh + 6 + bh;
  const view = { x: p.x, y: ordersBottom + 8, w: 104, h: l.mode === 'landscape' ? 32 : 30 };
  return { time: { x: p.x, y: p.y, w: 40, h: top }, marks, quit, mute, speed, targets, orders, view };
}

// ---- 遊軍（design §7.8）の置き場所 ----
// 枠とボタンの位置は、ユーザーが実際の画面を見て決める（decisions §15）。動かすときは、この2つの関数だけを直す。
// いまある表示物の位置は変えず、空いている所に置く：
//   配置・横長：操作の欄の「開戦」「完了」のすぐ上（ひな形の2列と、ヒント・陣形名の下が空いている）。
//   配置・縦長・1人用：戦場の下の帯の「？」の右（ふだんは陣形名が右の端に出るだけで、まん中が空いている）。
//   配置・縦長・対戦：見出しの行の、予算の残りと「音あり」のあいだ（縦長の操作の欄も帯も、ほかに空きがない）。
//   戦闘・横長：視点のボタンの右に2つ。縦長：視点のボタンの下の行に2つ（右は狭く、文字が枠に触れるため）。

/** 配置の画面の「遊軍」の枠。pvp は対戦の配置の画面か */
export function deployReserveSlot(l: Layout, pvp: boolean): Rect {
  const p = l.panel;
  if (l.mode === 'landscape') {
    const start = pvp ? pvpDeployPanel(l).start : deployPanel(l).start;
    // ひな形2つぶんの幅（ひな形のボタンと同じ並びの左の2列にそろえる）
    const [a, b] = row(p.x, 0, p.w, 0, 4, 4);
    return { x: a!.x, y: start.y - 8 - 36, w: b!.x + b!.w - a!.x, h: 36 };
  }
  if (!pvp && l.strip) {
    const s = l.strip;
    // 「？」（幅 32）と、ヒントの文字の書き出し（s.x + 40）にそろえる
    return { x: s.x + 40, y: s.y, w: 104, h: s.h };
  }
  const head = pvpDeployPanel(l);
  // 予算の残り（「残り 36」で幅 60px ほど）の右から、「音あり」の手前 4px まで
  const x = head.budget.x + 68;
  return { x, y: head.back.y, w: head.mute.x - 4 - x, h: head.back.h };
}

/** 戦闘の画面の「遊軍 左から」「遊軍 右から」（左・右の順） */
export function battleReserveButtons(l: Layout): [Rect, Rect] {
  const panel = battlePanel(l);
  const p = l.panel;
  const v = panel.view;
  if (l.mode === 'portrait') {
    // 縦長は視点のボタンの右だと文字が枠に触れるほど狭いので、その下の行に、欄の幅いっぱいで2つ並べる（欄の下の端 190px に収まる）
    const [a, b] = row(p.x, v.y + v.h + 6, p.w, v.h, 2, 4);
    return [a!, b!];
  }
  const x = v.x + v.w + 4;
  const w = Math.floor((p.x + p.w - x - 4) / 2);
  return [
    { x, y: v.y, w, h: v.h },
    { x: x + w + 4, y: v.y, w, h: v.h },
  ];
}

/** 結果の画面。画面全体の中央に、枠の箱とボタンの列を縦に並べる */
export interface ResultLayout {
  centerX: number;
  box: Rect;
  /** 行ごとの y（上から） */
  title: number;
  reason: number;
  stars: number;
  review: number;
  /** もう一度・次へ・戻る */
  buttons: Rect[];
}

export function resultLayout(l: Layout): ResultLayout {
  const cx = l.width / 2;
  const boxW = l.mode === 'landscape' ? 320 : l.width - GAP * 2;
  const boxH = 272;
  const btnH = 40;
  // 箱とボタンをひとまとまりにして、縦の中央に置く
  const top = even(Math.max(GAP, (l.height - boxH - 16 - btnH) / 2));
  const box = { x: even(cx - boxW / 2), y: top, w: boxW, h: boxH };
  const rowW = l.mode === 'landscape' ? 320 : l.width - GAP * 2;
  return {
    centerX: cx,
    box,
    title: top + 16,
    reason: top + 60,
    stars: top + 88,
    review: top + 124,
    buttons: row(even(cx - rowW / 2), top + boxH + 16, rowW, btnH, 3, 6),
  };
}

/** タイトルの画面 */
export interface TitleLayout {
  centerX: number;
  title: number;
  stage: Rect;
  pvp: Rect;
  mute: Rect;
}

export function titleLayout(l: Layout): TitleLayout {
  const cx = l.width / 2;
  const top = even(l.height / 2 - 96);
  const w = 160;
  return {
    centerX: cx,
    title: top,
    stage: { x: even(cx - w / 2), y: top + 72, w, h: 40 },
    pvp: { x: even(cx - w / 2), y: top + 124, w, h: 40 },
    mute: { x: l.width - GAP - MUTE_W, y: l.height - GAP - 32, w: MUTE_W, h: 32 },
  };
}

/** ステージ選択の画面。章の見出しと、面のボタンを縦に並べる */
export interface StageSelectLayout {
  back: Rect;
  /** 章の見出し。章が2つ以上あれば、ここに章を切り替えるボタンを並べる */
  heading: Rect;
  /** 面のボタン（count 個） */
  stages: Rect[];
}

export function stageSelectLayout(l: Layout, count: number): StageSelectLayout {
  const w = l.mode === 'landscape' ? 320 : l.width - GAP * 2;
  const x = even(l.width / 2 - w / 2);
  const rowH = 40;
  const gap = 6;
  const listH = count * rowH + (count - 1) * gap;
  const top = even(Math.max(48, (l.height - listH) / 2 + 16));
  return {
    back: { x: GAP, y: GAP, w: BACK_W, h: 32 },
    heading: { x, y: top - 44, w, h: 32 },
    stages: Array.from({ length: count }, (_, i) => ({ x, y: top + i * (rowH + gap), w, h: rowH })),
  };
}

/** 部屋の画面。画面の中央に縦に並べる。入力欄は HTML の input をこの矩形に重ねる */
export interface LobbyLayout {
  back: Rect;
  centerX: number;
  title: number;
  /** 名前の見出しと入力欄 */
  nameLabel: { x: number; y: number };
  nameInput: Rect;
  create: Rect;
  codeInput: Rect;
  join: Rect;
  resume: Rect;
  /** 失敗などの1行 */
  status: number;
  /** 部屋に入ったあと：コード・写す・相手を待っています・出る */
  codeLabel: number;
  codeBox: Rect;
  copy: Rect;
  waiting: number;
  leave: Rect;
  /** 部屋に入ったあとの1行（「出る」の下） */
  waitStatus: number;
}

export function lobbyLayout(l: Layout): LobbyLayout {
  const w = l.mode === 'landscape' ? 288 : l.width - GAP * 2 - 16;
  const x = even(l.width / 2 - w / 2);
  const top = even(Math.max(48, l.height / 2 - 150));
  const codeW = 112;
  return {
    back: { x: GAP, y: GAP, w: BACK_W, h: 32 },
    centerX: l.width / 2,
    title: top,
    nameLabel: { x, y: top + 70 },
    nameInput: { x: x + 56, y: top + 54, w: w - 56, h: 32 },
    create: { x, y: top + 100, w, h: 40 },
    codeInput: { x, y: top + 156, w: codeW, h: 40 },
    join: { x: x + codeW + 8, y: top + 156, w: w - codeW - 8, h: 40 },
    resume: { x, y: top + 210, w, h: 36 },
    status: top + 262,
    codeLabel: top + 48,
    codeBox: { x: even(l.width / 2 - 80), y: top + 72, w: 160, h: 56 },
    copy: { x: even(l.width / 2 - 56), y: top + 140, w: 112, h: 32 },
    waiting: top + 192,
    leave: { x: even(l.width / 2 - 80), y: top + 228, w: 160, h: 40 },
    waitStatus: top + 284,
  };
}

/** 対戦の配置の操作の欄（編成の足す・減らすが増える） */
export interface PvpDeployPanel {
  back: Rect;
  /** 予算の残りを書く場所（左端と縦の中央） */
  budget: { x: number; y: number };
  mute: Rect;
  roster: Rect[];
  minus: Rect[];
  plus: Rect[];
  templates: Rect[];
  /** 陣形の保存と呼び出し（ひな形と同じ並びの8つ目） */
  formations: Rect;
  start: Rect;
}

export function pvpDeployPanel(l: Layout): PvpDeployPanel {
  const p = l.panel;
  const land = l.mode === 'landscape';
  const head = land ? 32 : 30;
  const back = { x: p.x, y: p.y, w: BACK_W, h: head };
  const mute = { x: p.x + p.w - MUTE_W, y: p.y, w: MUTE_W, h: head };
  const budget = { x: p.x + BACK_W + 8, y: p.y + head / 2 };
  const rosterY = land ? 42 : 34;
  const rosterH = land ? 36 : 30;
  const pmY = rosterY + rosterH + 4;
  const pmH = land ? 28 : 24;
  const roster = row(p.x, p.y + rosterY, p.w, rosterH, 5, 4);
  // 足す・減らすは、兵種のボタンの下に2つ並べる
  const minus: Rect[] = [];
  const plus: Rect[] = [];
  for (const r of roster) {
    const half = Math.floor((r.w - 2) / 2);
    minus.push({ x: r.x, y: p.y + pmY, w: half, h: pmH });
    plus.push({ x: r.x + r.w - half, y: p.y + pmY, w: half, h: pmH });
  }
  const tY = pmY + pmH + (land ? 10 : 4);
  const tH = land ? 32 : 28;
  const t1 = row(p.x, p.y + tY, p.w, tH, 4, 4);
  const t2all = row(p.x, p.y + tY + tH + 4, p.w, tH, 4, 4);
  const t2 = t2all.slice(0, 3);
  const start = land ? { x: p.x, y: p.y + p.h - 40, w: p.w, h: 40 } : { x: p.x, y: p.y + tY + 2 * tH + 8, w: p.w, h: 30 };
  return { back, budget, mute, roster, minus, plus, templates: [...t1, ...t2], formations: t2all[3]!, start };
}

/**
 * 配置の画面で、ヒント・陣形名・対戦の知らせを出す場所。
 * 横長は操作の欄の空き（ひな形の下）に2行。縦長は戦場の下の帯に1行で、左に知らせ（またはヒントの「？」）、右に陣形名。
 */
export interface DeployInfoLayout {
  mode: 'panel' | 'strip';
  /** ヒント・対戦の知らせの行（左寄せ） */
  info: { x: number; y: number; w: number };
  /** 陣形名（横長は左寄せの2行目、縦長は帯の右寄せ） */
  formation: { x: number; y: number; w: number };
  /** 縦長の1人用で、ヒントを出す「？」のボタン */
  hintButton: Rect | null;
}

export function deployInfo(l: Layout, pvp: boolean): DeployInfoLayout {
  const s = l.strip;
  if (!s) {
    const p = l.panel;
    // ひな形の下（1人用はひな形2列の下、対戦は −＋ とひな形2列の下）
    const y = p.y + (pvp ? 214 : 172);
    return { mode: 'panel', info: { x: p.x, y, w: p.w }, formation: { x: p.x, y: y + 30, w: p.w }, hintButton: null };
  }
  const mid = s.y + s.h / 2;
  const hintButton = pvp ? null : { x: s.x, y: s.y, w: 32, h: s.h };
  return {
    mode: 'strip',
    info: { x: s.x + (hintButton ? 40 : 0), y: mid, w: s.w - (hintButton ? 40 : 0) },
    formation: { x: s.x + s.w, y: mid, w: s.w },
    hintButton,
  };
}

// ---- チュートリアル（design §8.6、§8.10-7）の置き場所 ----

/**
 * チュートリアルの指示の一行を出す矩形（文字は左寄せ・縦の中央）。
 *   配置の画面：横長は面の手がかりの行（deployInfo の info）。縦長は戦場の下の帯の幅いっぱい（「？」の余白を使わない）。
 *   戦闘の画面：視点のボタンの行の、操作の欄の幅いっぱい。
 */
export function tutorialLine(l: Layout, screen: 'deploy' | 'battle'): Rect {
  if (screen === 'battle') {
    const v = battlePanel(l).view;
    return { x: l.panel.x, y: v.y, w: l.panel.w, h: v.h };
  }
  if (l.strip) return { ...l.strip };
  const info = deployInfo(l, false).info;
  // 手がかりの文字（上寄せ）と同じ高さに、16px の字の行が来るように
  return { x: info.x, y: info.y - 2, w: info.w, h: 24 };
}

/**
 * チュートリアルの配置の画面の「飛ばす」と面の名前。「戻る」の幅（56px）では「飛ばす」が枠にぎりぎりなので、
 * 戦闘の画面の縦長の「飛ばす」（80px）と同じ幅にし、面の名前をそのぶん右へ寄せる
 */
export function tutorialDeployHead(l: Layout): { back: Rect; name: { x: number; y: number } } {
  const d = deployPanel(l);
  const w = 80;
  return { back: { ...d.back, w }, name: { x: d.name.x + (w - d.back.w), y: d.name.y } };
}

/** チュートリアルの戦闘の画面の「次へ」。号令の翼のボタンの行の場所に、行の幅いっぱいで出す */
export function tutorialNext(l: Layout): Rect {
  const t = battlePanel(l).targets;
  const a = t[0]!;
  const b = t[t.length - 1]!;
  return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: a.h };
}
