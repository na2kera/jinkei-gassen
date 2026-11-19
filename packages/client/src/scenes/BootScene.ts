// 起動時に絵のテクスチャを作り、タイトルへ進む。
// 将軍の視点の遠景の絵（public/backdrops）もここでまとめて読む。読めなかった絵は飛ばす（使うときに空の色で代える）。

import Phaser from 'phaser';
import { backdropKey, backdropNames } from '../art/backdrop.ts';
import { buildTextures } from '../art/textures.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    for (const name of backdropNames()) this.load.image(backdropKey(name), `backdrops/${name}.png`);
  }

  create(): void {
    buildTextures(this);
    this.scene.start('Title');
  }
}
