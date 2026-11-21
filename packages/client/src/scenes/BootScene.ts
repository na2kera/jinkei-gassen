// 起動時に絵のテクスチャを作り、タイトルへ進む。

import Phaser from 'phaser';
import { buildTextures } from '../art/textures.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    buildTextures(this);
    this.scene.start('Title');
  }
}
