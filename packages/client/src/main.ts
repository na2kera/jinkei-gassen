import { ENGINE_VERSION } from '@jinkei/engine';
import Phaser from 'phaser';

const FONT_FAMILY = 'DotGothic16';

class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, '陣形合戦', {
        fontFamily: FONT_FAMILY,
        fontSize: '32px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
  }
}

async function start(): Promise<void> {
  console.log(`ENGINE_VERSION: ${ENGINE_VERSION}`);
  await document.fonts.load(`16px "${FONT_FAMILY}"`, '陣形合戦');
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 640,
    height: 400,
    backgroundColor: '#000000',
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    audio: { noAudio: true },
    scene: [BootScene],
  });
}

void start();
