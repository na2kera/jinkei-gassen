// 対戦のルール説明の文言（decisions §19、design §10.3）。文言はここ1か所だけに置く。
// Phaser を読まない（node のテストで、decisions の文と一字も違わないことを確かめるため。test/pvpRules.test.ts）。
// 行の頭の番号は付けない（画面には文だけを7行、左ぞろえで出す）。

export const PVP_RULES_TITLE = '対戦のルール';

export const PVP_RULES_LINES: readonly string[] = [
  '部隊を並べて、2分で陣を作る',
  '相手の陣は、開戦まで見えない',
  '開戦したら、部隊は自分で戦う',
  '号令は3回まで。全軍か翼に出す',
  '1部隊を遊軍にして、途中で呼べる',
  '敵の本陣を落とせば勝ち',
  '時間切れは、兵が多く残ったほう',
];
