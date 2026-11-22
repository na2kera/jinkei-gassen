// チュートリアル（design §8.2、decisions §17）。1-1 の前に置く、案内つきの一戦の面と戦いの設定。
// STAGES には入れない（星・面が開く条件・次の面・対戦が開く条件・章の一覧・測定が、どれも STAGES を見ているため）。

import { plainField } from './army.ts';
import { stageSetupWith, type Stage } from './stage.ts';
import type { BattleSetup, OrderKind, OrderTarget, Placement, Stance } from './types.ts';

/**
 * 置き終えたあとの自軍。戦いに渡す順（この並びにそろえてから戦う）。
 * 座標は 10×12 の盤（design §13.4）。自軍の歩兵と敵の歩兵のあいだが 7 行、自軍の歩兵と敵の本陣のあいだが 9 行、
 * 敵の歩兵 2 つが本陣狙いの歩兵の左右 1 列ずつ、を保つ（号令の刻み 50 よりあとに最初の攻撃が始まる）
 */
export const TUTORIAL_ARMY: Placement[] = [
  { kind: 'hq', stance: 'hold', col: 4, row: 11 },
  { kind: 'infantry', stance: 'advance', col: 3, row: 9 },
  // 真ん中の歩兵だけ本陣狙い。両脇の歩兵が敵の歩兵2つと戦っている間に、本陣へ抜ける
  { kind: 'infantry', stance: 'hunt', col: 4, row: 9 },
  { kind: 'infantry', stance: 'advance', col: 5, row: 9 },
];

/** チュートリアルの面。STAGES には入れない */
export const TUTORIAL_STAGE: Stage = {
  id: 'tutorial',
  chapter: 1,
  index: 0,
  name: '遊び方',
  hint: '',
  field: plainField(),
  roster: { hq: 1, infantry: 3 },
  // 敵は守備で動かず、号令も遊軍もない
  enemy: [
    { kind: 'hq', stance: 'hold', col: 4, row: 0 },
    { kind: 'infantry', stance: 'hold', col: 3, row: 2 },
    { kind: 'infantry', stance: 'hold', col: 5, row: 2 },
  ],
  win: { type: 'defeat' },
  allow: { stances: ['hunt'], orders: true, templates: false },
  solution: TUTORIAL_ARMY,
};

/** 方針を変える部隊（TUTORIAL_ARMY の添字）と、変えたあとの方針 */
export const TUTORIAL_STANCE: { index: number; stance: Stance } = { index: 2, stance: 'hunt' };

/** 号令のために戦闘を止める刻み */
export const TUTORIAL_ORDER_TICK = 50;

/** 号令（全軍に突撃） */
export const TUTORIAL_ORDER: { target: OrderTarget; kind: OrderKind } = { target: 'all', kind: 'charge' };

/** 乱数の種（固定） */
export const TUTORIAL_SEED = 20261119;

/** 戦いの設定。client とテストがこれを呼ぶ（テスト用に設定を書き写さない） */
export function tutorialSetup(): BattleSetup {
  return stageSetupWith(TUTORIAL_STAGE, TUTORIAL_ARMY.map((p) => ({ ...p })), TUTORIAL_SEED, []);
}
