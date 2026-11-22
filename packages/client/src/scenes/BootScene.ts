// 起動時に絵のテクスチャを作り（立体の絵は頼むだけ。design §14.3）、タイトルへ進む。

import Phaser from 'phaser';
import { buildGameTextures } from '../art/gameTextures.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    buildGameTextures(this);
    this.scene.start('Title');
  }
}
