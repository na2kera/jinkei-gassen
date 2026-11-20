// 対戦のルール説明のダイアログ（decisions §19、design §10.4）。ロビーの上に重ねる。
// 作りは陣形の箱（FormationDialog）と同じ：画面ぜんぶに押せる板を敷いて下の画面への入力を止め、
// 暗い地に金の枠の箱に、見出しと7行の文を出す。閉じるのは「閉じる」のボタンだけ（板を押しても閉じない）。
// 表示物はぜんぶ1つの Container に入れて、ロビーより上の重ね順にする。ロビーは開いているあいだも
// 表示を組み直す（入る前 ↔ 入ったあと）ので、あとから作られたボタンが箱の上に出ない・押せないようにするため。
// 「閉じる」（onClose）と、シーンの終わりの片付け（destroy）は分ける。向きが変わったときや、
// 配置の画面へ進むときに消すのは「見た」ことにしないため（design §10.5）。

import Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import { rulesDialogLayout, type Layout } from '../layout.ts';
import { PVP_RULES_LINES, PVP_RULES_TITLE } from '../pvpRules.ts';
import { Button } from './Button.ts';
import { checkFit } from './overflow.ts';
import { drawBox } from './panel.ts';
import { addText } from './text.ts';

/** ロビーのどの表示物よりも上に置く重ね順（ロビーの表示物は既定の 0 のまま） */
const DEPTH = 100;

export class RulesDialog {
  private readonly root: Phaser.GameObjects.Container;

  constructor(
    scene: Phaser.Scene,
    layout: Layout,
    private readonly onClose: () => void,
  ) {
    const r = rulesDialogLayout(layout);
    const root = scene.add.container(0, 0).setDepth(DEPTH);
    this.root = root;
    // 後ろ全体に押せる板を敷き、ロビーのボタンに届かないようにする（押しても何もしない）
    root.add(scene.add.zone(0, 0, layout.width, layout.height).setOrigin(0, 0).setInteractive());
    const g = scene.add.graphics();
    drawBox(g, r.box);
    root.add(g);
    const key = scene.scene.key;
    const title = addText(scene, r.title.x, r.title.y, PVP_RULES_TITLE, 16, COLOR.goldHi);
    root.add(title);
    // 文字が箱の内側からはみ出さないか（開発時だけ記録）。checkFit は左右に 4px ずつ引くので、そのぶん足して渡す
    checkFit(key, PVP_RULES_TITLE, title.width, title.height, r.textW + 8, r.lineH + 4);
    PVP_RULES_LINES.forEach((line, i) => {
      const t = addText(scene, r.lineX, r.lineY + i * r.lineH, line, 16, COLOR.cream);
      root.add(t);
      checkFit(key, line, t.width, t.height, r.textW + 8, r.lineH + 4);
    });
    // 箱の中のボタンは、下の画面と別の組で押せる範囲を広げる（design §9.9-4）
    new Button(scene, r.close, '閉じる', () => this.onClose(), { hitGroup: 'popup' }).addTo(root);
  }

  /** 表示物を消す（「見た」とは覚えない。閉じるのボタンは onClose を呼び、そのあとで呼ばれる） */
  destroy(): void {
    this.root.destroy();
  }
}
