// 対戦の画面（段階3で作る）。いまは「準備中」とだけ出して、タイトルへ戻れるようにする。

import Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT, lobbyLayout } from '../layout.ts';
import { Button } from '../ui/Button.ts';
import { addText } from '../ui/text.ts';

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super('Lobby');
  }

  create(): void {
    debug.scene = 'Lobby';
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    const l = lobbyLayout(layout);
    new Button(this, l.back, '戻る', () => this.scene.start('Title'));
    addText(this, Math.round(l.centerX), l.text, '準備中', 32, COLOR.muted).setOrigin(0.5, 0);

    const onLayout = (): void => {
      this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(LAYOUT_EVENT, onLayout));
  }
}
