// タイトル。「ステージ」と「対戦」。対戦は第1章の5面をすべて勝つまで押せない（押せないことはボタンの見た目で示す）。
// 「ステージ」は、チュートリアルが済んでいなければ、チュートリアルを始める（design §8.6）。

import Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT, titleLayout } from '../layout.ts';
import { tutorialDone } from '../save.ts';
import { pvpUnlocked } from '../session.ts';
import { startTutorial } from '../tutorial/run.ts';
import { TUTORIAL_STAGE } from '@jinkei/engine';
import { Button } from '../ui/Button.ts';
import { addMuteButton } from '../ui/mute.ts';
import { addText } from '../ui/text.ts';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    debug.scene = 'Title';
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    const t = titleLayout(layout);
    addText(this, Math.round(t.centerX), t.title, '陣形合戦', 32, COLOR.goldHi).setOrigin(0.5, 0);
    new Button(this, t.stage, 'ステージ', () => this.pressStage(), { primary: true });
    new Button(this, t.pvp, '対戦', () => this.scene.start('Lobby')).setEnabled(pvpUnlocked());
    addMuteButton(this, t.mute);

    const onLayout = (): void => {
      this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(LAYOUT_EVENT, onLayout));
  }

  private pressStage(): void {
    if (tutorialDone()) {
      this.scene.start('StageSelect');
      return;
    }
    startTutorial('auto');
    this.scene.start('Deploy', { stageId: TUTORIAL_STAGE.id });
  }
}
