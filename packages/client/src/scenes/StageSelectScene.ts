// ステージ選択。章ごとに面を並べ、取った星を示す。前の面を勝つと次の面が開き、開いていない面は押せない。
// 章は STAGES にあるものだけを出す。章が2つ以上になったら、見出しの所に章を切り替えるボタンを並べる。

import { STAGES } from '@jinkei/engine';
import Phaser from 'phaser';
import { drawStar, STAR_SIZE } from '../art/icons.ts';
import { COLOR } from '../art/palette.ts';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT, stageSelectLayout } from '../layout.ts';
import { starsOf } from '../save.ts';
import { chapters, isUnlocked, orderedStages, session } from '../session.ts';
import { Button } from '../ui/Button.ts';
import { addText } from '../ui/text.ts';

/** 章の見出し */
function chapterLabel(n: number): string {
  return `第${n}章`;
}

/** 見せている章。最初はいまの面の章で、章を切り替えたら覚えておく（画面を作り直しても戻らないように） */
let shownChapter: number | null = null;

export class StageSelectScene extends Phaser.Scene {
  constructor() {
    super('StageSelect');
  }

  create(): void {
    debug.scene = 'StageSelect';
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    const list = chapters();
    if (shownChapter === null || !list.includes(shownChapter)) {
      const cur = STAGES.find((s) => s.id === session.stageId);
      shownChapter = cur ? cur.chapter : (list[0] ?? 1);
    }
    const chapter = shownChapter;
    const stages = orderedStages().filter((s) => s.chapter === chapter);
    const l = stageSelectLayout(layout, stages.length);

    new Button(this, l.back, '戻る', () => this.scene.start('Title'));

    if (list.length > 1) {
      // 章が2つ以上あるときだけ、章を切り替えるボタンを並べる
      const w = Math.floor((l.heading.w - (list.length - 1) * 4) / list.length);
      list.forEach((n, i) => {
        new Button(this, { x: l.heading.x + i * (w + 4), y: l.heading.y, w, h: l.heading.h }, chapterLabel(n), () => {
          shownChapter = n;
          this.scene.restart();
        }).setSelected(n === chapter);
      });
    } else {
      addText(this, l.heading.x, l.heading.y + 8, chapterLabel(chapter), 16, COLOR.muted);
    }

    const g = this.add.graphics().setDepth(1);
    stages.forEach((stage, i) => {
      const r = l.stages[i];
      if (!r) return;
      const open = isUnlocked(stage);
      // 名前は左に寄せ、星を右に置くため、ボタンの文字は空にして別に書く
      new Button(this, r, '', () => {
        session.stageId = stage.id;
        this.scene.start('Deploy', { stageId: stage.id });
      }).setEnabled(open);
      addText(this, r.x + 14, r.y + r.h / 2, `${stage.id} ${stage.name}`, 16, open ? COLOR.cream : COLOR.dim)
        .setOrigin(0, 0.5)
        .setDepth(1);
      const stars = starsOf(stage.id);
      const size = STAR_SIZE * 2;
      for (let s = 0; s < 3; s++) {
        drawStar(g, r.x + r.w - 14 - (3 - s) * (size + 4) + 4, Math.round(r.y + (r.h - size) / 2), s < stars);
      }
    });

    const onLayout = (): void => {
      this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(LAYOUT_EVENT, onLayout));
  }
}
