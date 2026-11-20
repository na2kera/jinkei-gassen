// タイトル。「ステージ」と「対戦」。対戦はいつでも押せる（第1章を勝つまで押せない決まりは、その場で対戦だけ遊ぶ人が
// 入れないので 2026-11-20 にやめた。decisions §19）。代わりに、初めて開いたロビーでルールの説明を出す（LobbyScene）。
// 「ステージ」は、チュートリアルが済んでいなければ、チュートリアルを始める（design §8.6）。

import Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT, titleLayout } from '../layout.ts';
import { tutorialDone } from '../save.ts';
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
    new Button(this, t.pvp, '対戦', () => this.scene.start('Lobby'));
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
