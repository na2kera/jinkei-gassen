// 画面の置き場所を決める唯一の場所（design §5.3、assumptions S13）。
// シーンはここで決めた矩形を読むだけにし、座標の数字を直書きしない。
// 向きが変わったときに、ここを計算し直すだけで全画面が組み直せるようにするため。

import { STANDARD_HEIGHT, STANDARD_WIDTH } from '@jinkei/engine';
import { PVP_RULES_LINES } from './pvpRules.ts';

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
  /** 戦場を描く矩形（横長は 320 × 384、縦長は 320 × 328。盤を傾けて描くので、縦長は詰める。design §14.6） */
  field: Rect;
  /** 操作の欄 */
  panel: Rect;
  /**
   * 縦長だけ：戦場のすぐ下の1行の帯。中間地帯には地形が置かれるので、戦場の上に文字の箱を重ねず、
   * 面のヒント・陣形名・対戦の残り時間などはここに出す。横長は操作の欄に空きがあるので null
   */
  strip: Rect | null;
}

/** 1マスの大きさ（px）。地面のタイル（art/textures.ts の TILE）と同じ大きさ */
export const CELL = 32;
/** 描き場所の列と行（標準の戦場 STANDARD_WIDTH × STANDARD_HEIGHT。通り道の列も含めて全体を見せる。design §13.7） */
export const FIELD_COLS = STANDARD_WIDTH;
export const FIELD_ROWS = STANDARD_HEIGHT;
const FIELD_W = CELL * FIELD_COLS;
const FIELD_H = CELL * FIELD_ROWS;
/** 縦長の描き場所の高さ（盤を傾けると縦が 0.75 倍になり、兵の背丈を足しても 322px で足りる。design §14.6） */
export const PORTRAIT_FIELD_H = 328;

/** 横長の内部の大きさ。盤（320）＋操作の欄（328）＋すき間 8 × 3（design §13.7） */
export const LANDSCAPE_W = 672;
export const LANDSCAPE_H = 400;
const PORTRAIT_W = 320;
// 描き場所 328 ＋ 帯のすき間 8 ＋ 帯 24 ＋ 6 ＋ 操作の欄 190 ＋ 上下の余白 8 ＝ 564（design §14.6。これより細長い端末では左右が少し空く）
const PORTRAIT_MIN_H = 564;
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
  const block = PORTRAIT_FIELD_H + STRIP_GAP + STRIP_H + PANEL_GAP_PORTRAIT + PORTRAIT_PANEL_H;
  const top = even(Math.max(GAP, (h - block) / 2));
  const stripY = top + PORTRAIT_FIELD_H + STRIP_GAP;
  return {
    mode: 'portrait',
    width: PORTRAIT_W,
    height: h,
    field: { x: fieldX, y: top, w: FIELD_W, h: PORTRAIT_FIELD_H },
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

/**
 * 配置の画面の操作の欄（1人用と対戦で同じ並び。違いは見出しの行のまん中の中身だけ。design §15.2）。
 * 上から：見出し（戻る・面の名前か予算・音あり）／手札のカード4枚／ひな形の2列／（横長は知らせと陣形名）／遊軍の枠と「開戦」「完了」
 */
export interface DeployPanel {
  /** ステージ選択へ戻る（対戦は「出る」） */
  back: Rect;
  /** 見出しのまん中の文字（1人用は面の名前、対戦は予算と部隊数）を書く場所（左端と縦の中央） */
  name: { x: number; y: number };
  /** 音を切るボタン */
  mute: Rect;
  /** 手札のカード4枚（歩兵・盾兵・騎兵・弓兵の順。手持ちにない兵種は出さず、左に詰める） */
  cards: Rect[];
  /** 手札の欄（カード4枚の場所を合わせた矩形）。盤の部隊を引っぱっている間は「ここで外す」の枠をここに出す */
  hand: Rect;
  /** ひな形7つ */
  templates: Rect[];
  /** 陣形の保存と呼び出し（ひな形と同じ並びの8つ目） */
  formations: Rect;
  /** 遊軍の枠（design §7.8。遊軍を出さない場面では使わない） */
  reserve: Rect;
  /** 遊軍の枠を出す場面の「開戦」「完了」 */
  start: Rect;
  /** 遊軍の枠を出さない場面（チュートリアル、遊軍を使えない部屋）の「開戦」「完了」 */
  startFull: Rect;
}

const MUTE_W = 64;
const BACK_W = 56;

export function deployPanel(l: Layout): DeployPanel {
  const p = l.panel;
  const head = 32;
  const back = { x: p.x, y: p.y, w: BACK_W, h: head };
  const mute = { x: p.x + p.w - MUTE_W, y: p.y, w: MUTE_W, h: head };
  const name = { x: p.x + BACK_W + 8, y: p.y + head / 2 };
  const span = (rs: Rect[]): Rect => {
    const a = rs[0]!;
    const b = rs[rs.length - 1]!;
    return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: a.h };
  };
  if (l.mode === 'landscape') {
    const cards = row(p.x, p.y + 42, p.w, 48, 4, 4);
    const t1 = row(p.x, p.y + 98, p.w, 32, 4, 4);
    const t2 = row(p.x, p.y + 134, p.w, 32, 4, 4);
    const start = { x: p.x, y: p.y + p.h - 40, w: p.w, h: 40 };
    // 遊軍の枠は「開戦」「完了」のすぐ上。幅はひな形2つぶん（ひな形のボタンと同じ並びの左の2列にそろえる）
    const [a, b] = row(p.x, 0, p.w, 0, 4, 4);
    const reserve = { x: a!.x, y: start.y - 8 - 36, w: b!.x + b!.w - a!.x, h: 36 };
    return { back, name, mute, cards, hand: span(cards), templates: [...t1, ...t2.slice(0, 3)], formations: t2[3]!, reserve, start, startFull: start };
  }
  // ひな形は1列に7つ並べると、名前が枠に触れるほど窮屈になるので、4つと3つの2列にする
  const cards = row(p.x, p.y + 36, p.w, 44, 4, 4);
  const t1 = row(p.x, p.y + 84, p.w, 28, 4, 4);
  const t2 = row(p.x, p.y + 116, p.w, 28, 4, 4);
  // 下の行：左に遊軍の枠（幅 96）、右に「開戦」「完了」。遊軍の枠を出さない場面では、「開戦」「完了」を欄の幅いっぱいにする
  const reserve = { x: p.x, y: p.y + 148, w: 96, h: 40 };
  const start = { x: p.x + 100, y: p.y + 148, w: p.w - 100, h: 40 };
  const startFull = { x: p.x, y: p.y + 148, w: p.w, h: 40 };
  return { back, name, mute, cards, hand: span(cards), templates: [...t1, ...t2.slice(0, 3)], formations: t2[3]!, reserve, start, startFull };
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
  /** 視点（真上・斜め・横から）の切り替え（design §5.7、§5.8） */
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
// 枠とボタンの位置は、ユーザーが実際の画面を見て決める（decisions §15）。動かすときは、deployPanel と battleReserveButtons だけを直す。
//   配置・横長：操作の欄の「開戦」「完了」のすぐ上（ひな形の2列と、ヒント・陣形名の下が空いている）。
//   配置・縦長：下の行の左（「開戦」「完了」の左。1人用・対戦とも。design §15.2）。
//   戦闘・横長：視点のボタンの右に2つ。縦長：視点のボタンの下の行に2つ（右は狭く、文字が枠に触れるため）。

/** 配置の画面の「遊軍」の枠（公開の画面も、同じ場所に自分の遊軍を出す） */
export function deployReserveSlot(l: Layout): Rect {
  return deployPanel(l).reserve;
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
  /** 「ルール」のボタン（右上。入る前・入ったあとの両方に出す。design §10.5） */
  rules: Rect;
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
    // 「戻る」と同じ段・同じ高さ。幅は音のボタンと同じ
    rules: { x: l.width - GAP - MUTE_W, y: GAP, w: MUTE_W, h: 32 },
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

/** 対戦のルール説明のダイアログ（design §10.4）。箱は画面の中央、高さは中身から決める */
export interface RulesDialogLayout {
  box: Rect;
  /** 見出しの左上 */
  title: { x: number; y: number };
  /** 本文の各行の左上の x と、1行目の上の y、行の高さ */
  lineX: number;
  lineY: number;
  lineH: number;
  /** 本文を書ける幅（箱の内側の左右の余白を除いた幅） */
  textW: number;
  close: Rect;
}

/** ルール説明の箱の、上下左右の余白・見出しの高さ・見出しと本文のすき間・本文と「閉じる」のすき間 */
const RULES_PAD = 16;
const RULES_TITLE_H = 22;
const RULES_TITLE_GAP = 8;
const RULES_LINE_H = 22;
const RULES_CLOSE_GAP = 12;
const RULES_CLOSE_W = 96;
const RULES_CLOSE_H = 36;

export function rulesDialogLayout(l: Layout): RulesDialogLayout {
  const lines = PVP_RULES_LINES.length;
  const w = l.mode === 'landscape' ? 320 : l.width - 16;
  const h = RULES_PAD + RULES_TITLE_H + RULES_TITLE_GAP + lines * RULES_LINE_H + RULES_CLOSE_GAP + RULES_CLOSE_H + RULES_PAD;
  const x = even((l.width - w) / 2);
  const y = even((l.height - h) / 2);
  const lineY = y + RULES_PAD + RULES_TITLE_H + RULES_TITLE_GAP;
  return {
    box: { x, y, w, h },
    title: { x: x + RULES_PAD, y: y + RULES_PAD },
    lineX: x + RULES_PAD,
    lineY,
    lineH: RULES_LINE_H,
    textW: w - RULES_PAD * 2,
    close: { x: even(x + w / 2 - RULES_CLOSE_W / 2), y: y + h - RULES_PAD - RULES_CLOSE_H, w: RULES_CLOSE_W, h: RULES_CLOSE_H },
  };
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
    // ひな形2列の下（1人用・対戦とも）
    const y = p.y + 176;
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
