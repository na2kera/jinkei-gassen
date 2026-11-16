// 起動時に仮の絵のテクスチャを作り、配置の画面へ進む（タイトルとステージ選択は段階2）。

import Phaser from 'phaser';
import { buildTextures } from '../art/textures.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    buildTextures(this);
    this.scene.start('Deploy');
  }
}
