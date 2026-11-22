// チュートリアルの進み具合（design §8.3、§8.10）。Phaser に頼らない計算だけにして、node --test で確かめる（test/tutorial.test.ts）。
// 手順ごとに、受け付ける操作・出す一行・目立たせるものを決める。表にない操作は、どの手順でも受け付けない。

import {
  defaultStance,
  TUTORIAL_ARMY,
  TUTORIAL_ORDER,
  TUTORIAL_STANCE,
  type Kind,
  type OrderKind,
  type OrderTarget,
  type Placement,
  type Stance,
} from '@jinkei/engine';

// 本陣は最初から置いてあるので、本陣を置く手順はない（design §15.7）
export type TutorialStep =
  | 'placeInf' // 歩兵を3つ置く
  | 'tapUnit' // 真ん中の歩兵を押す
  | 'pickStance' // 「本陣狙い」を選ぶ
  | 'start' // 開戦を押す
  | 'march' // 戦闘が始まり、止まるまで
  | 'order' // 止まっている。全軍 → 突撃
  | 'fight' // 号令のあと、決着まで
  | 'done'; // 決着のあと、最後の一言

export interface TutorialRun {
  step: TutorialStep;
  /** どこから始めたか。終わったあとの行き先を決める */
  from: 'auto' | 'list';
  /** 手札のカードで選んでいる兵種（placeInf の間。カードを光るマスへ離したときも、選んでから置いたとして扱う） */
  picked: Kind | null;
  /** 置いた部隊（置いた順。はじめから本陣が入っている） */
  placed: Placement[];
  /** order の手順で「全軍」を押したか */
  targetPicked: boolean;
}

/** 画面の操作 */
export type TutorialAction =
  | { type: 'pickKind'; kind: Kind }
  | { type: 'cell'; col: number; row: number }
  | { type: 'unit'; col: number; row: number }
  | { type: 'stance'; stance: Stance }
  /** 方針の箱の外を押して、箱を閉じた（pickStance のときだけ。design §8.10-2） */
  | { type: 'dismissStance' }
  | { type: 'start' }
  /** 戦闘が TUTORIAL_ORDER_TICK で止まった */
  | { type: 'paused' }
  | { type: 'target'; target: OrderTarget }
  | { type: 'order'; kind: OrderKind }
  /** 決着の表示が終わった */
  | { type: 'ended' };

/** いま目立たせるもの */
export interface TutorialLit {
  kinds: Kind[];
  cells: { col: number; row: number }[];
  stances: Stance[];
  start: boolean;
  targets: OrderTarget[];
  orders: OrderKind[];
  /** done の「次へ」（design §8.3 の表の done の行） */
  next: boolean;
}

/** 最初から置いてある本陣 */
const HQ = TUTORIAL_ARMY.find((p) => p.kind === 'hq')!;
/** 歩兵を置くマス（TUTORIAL_ARMY の順） */
const INF_CELLS = TUTORIAL_ARMY.filter((p) => p.kind === 'infantry').map(cellOf);
/** 押す部隊のマス（方針を変える部隊） */
const UNIT_CELL = cellOf(TUTORIAL_ARMY[TUTORIAL_STANCE.index]!);

function cellOf(p: { col: number; row: number }): { col: number; row: number } {
  return { col: p.col, row: p.row };
}

function same(a: { col: number; row: number }, b: { col: number; row: number }): boolean {
  return a.col === b.col && a.row === b.row;
}

export function newRun(from: 'auto' | 'list'): TutorialRun {
  return { step: 'placeInf', from, picked: null, placed: [{ ...HQ }], targetPicked: false };
}

/** まだ空いている、歩兵を置くマス */
function freeInfCells(run: TutorialRun): { col: number; row: number }[] {
  return INF_CELLS.filter((c) => !run.placed.some((p) => same(p, c)));
}

/** いまその操作をしてよいか */
export function allowed(run: TutorialRun, a: TutorialAction): boolean {
  switch (run.step) {
    case 'placeInf':
      if (a.type === 'pickKind') return a.kind === 'infantry';
      if (a.type === 'cell') return run.picked === 'infantry' && freeInfCells(run).some((c) => same(c, a));
      return false;
    case 'tapUnit':
      return a.type === 'unit' && same(a, UNIT_CELL);
    case 'pickStance':
      if (a.type === 'stance') return a.stance === TUTORIAL_STANCE.stance;
      return a.type === 'dismissStance';
    case 'start':
      return a.type === 'start';
    case 'march':
      return a.type === 'paused';
    case 'order':
      if (a.type === 'target') return !run.targetPicked && a.target === TUTORIAL_ORDER.target;
      if (a.type === 'order') return run.targetPicked && a.kind === TUTORIAL_ORDER.kind;
      return false;
    case 'fight':
      return a.type === 'ended';
    case 'done':
      return false;
  }
}

/** 操作を当てはめた次の状態（allowed が false なら、同じ状態を返す） */
export function apply(run: TutorialRun, a: TutorialAction): TutorialRun {
  if (!allowed(run, a)) return run;
  switch (a.type) {
    case 'pickKind':
      return { ...run, picked: a.kind };
    case 'cell': {
      const kind = run.picked!;
      const placed = [...run.placed, { kind, col: a.col, row: a.row, stance: defaultStance(kind) }];
      const done = placed.filter((p) => p.kind === 'infantry').length >= INF_CELLS.length;
      return done ? { ...run, step: 'tapUnit', picked: null, placed } : { ...run, placed };
    }
    case 'unit':
      return { ...run, step: 'pickStance', picked: null };
    case 'stance':
      // 画面を作り直したときに方針の印が戻るよう、置いた部隊の方針も変える
      return { ...run, step: 'start', placed: run.placed.map((p) => (same(p, UNIT_CELL) ? { ...p, stance: a.stance } : p)) };
    case 'dismissStance':
      return { ...run, step: 'tapUnit' };
    case 'start':
      return { ...run, step: 'march' };
    case 'paused':
      return { ...run, step: 'order', targetPicked: false };
    case 'target':
      return { ...run, targetPicked: true };
    case 'order':
      return { ...run, step: 'fight' };
    case 'ended':
      return { ...run, step: 'done' };
  }
}

/** 手順ごとの一行（design §8.3 の表。一字も変えない） */
export const TUTORIAL_LINES: Record<TutorialStep, string> = {
  placeInf: '歩兵を3つ、光るマスに置こう',
  tapUnit: '部隊を押すと、動き方を選べる',
  pickStance: '「本陣狙い」を選ぼう',
  start: '開戦。あとは部隊が自分で戦う',
  // 止まるまでは、start と同じ一行のまま
  march: '開戦。あとは部隊が自分で戦う',
  order: '号令で、全軍に突撃を命じよう',
  fight: '敵の本陣を落とせば勝ち',
  done: '動き方と号令は、先の面で使える',
};

/** いま出す一行 */
export function line(run: TutorialRun): string {
  return TUTORIAL_LINES[run.step];
}

/** いま目立たせるもの */
export function lit(run: TutorialRun): TutorialLit {
  const out: TutorialLit = { kinds: [], cells: [], stances: [], start: false, targets: [], orders: [], next: false };
  switch (run.step) {
    case 'placeInf':
      // 歩兵のカードと、空いている光るマスを、はじめから両方とも目立たせる（引っぱって置けるように。design §15.7）
      out.kinds = ['infantry'];
      out.cells = freeInfCells(run);
      break;
    case 'tapUnit':
      out.cells = [UNIT_CELL];
      break;
    case 'pickStance':
      out.stances = [TUTORIAL_STANCE.stance];
      break;
    case 'start':
      out.start = true;
      break;
    case 'order':
      if (run.targetPicked) out.orders = [TUTORIAL_ORDER.kind];
      else out.targets = [TUTORIAL_ORDER.target];
      break;
    case 'done':
      out.next = true;
      break;
    case 'march':
    case 'fight':
      break;
  }
  return out;
}

/** 戦いに渡す配置（TUTORIAL_ARMY の順にそろえ、方針も TUTORIAL_ARMY のものにする）。置いていない部隊は入らない */
export function armyOf(run: TutorialRun): Placement[] {
  return TUTORIAL_ARMY.filter((a) => run.placed.some((p) => p.kind === a.kind && same(p, a))).map((a) => ({ ...a }));
}

/** 置き終えて、戦いに渡せる配置になっているか（開戦の前に確かめる。design §8.4） */
export function armyReady(run: TutorialRun): boolean {
  const army = armyOf(run);
  return (
    run.placed.length === TUTORIAL_ARMY.length &&
    army.length === TUTORIAL_ARMY.length &&
    army.every((p, i) => {
      const a = TUTORIAL_ARMY[i]!;
      return p.kind === a.kind && p.col === a.col && p.row === a.row && p.stance === a.stance;
    })
  );
}
