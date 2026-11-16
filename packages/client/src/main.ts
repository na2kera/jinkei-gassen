// エントリポイント。文字を読み込んでから Phaser.Game を作る。
// 画面の向き（横長・縦長）は起動時と、親要素の大きさが変わったときに決め直す（assumptions S13）。

import Phaser from 'phaser';
import { installDebug } from './debug.ts';
import { computeLayout, getLayout, LAYOUT_EVENT, sameSize, setLayout } from './layout.ts';
import { BattleScene } from './scenes/BattleScene.ts';
import { BootScene } from './scenes/BootScene.ts';
import { DeployScene } from './scenes/DeployScene.ts';
import { ResultScene } from './scenes/ResultScene.ts';
import { FONT_FAMILY } from './ui/text.ts';

function parentSize(): { w: number; h: number } {
  const el = document.getElementById('game');
  return el ? { w: el.clientWidth, h: el.clientHeight } : { w: window.innerWidth, h: window.innerHeight };
}

async function start(): Promise<void> {
  await document.fonts.load(`16px "${FONT_FAMILY}"`, '陣形合戦');
  const size = parentSize();
  setLayout(computeLayout(size.w, size.h));
  const layout = getLayout();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: layout.width,
    height: layout.height,
    backgroundColor: '#1a1a1a',
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    // 音は今回は入れない（入れるときは手本と同じく WebAudio を最初の操作で解禁する）
    audio: { noAudio: true },
    scene: [BootScene, DeployScene, BattleScene, ResultScene],
  });

  // 向きが変わったら内部の大きさを変え、シーンに組み直させる。
  // setGameSize は window の resize を起こさないので、ここが二重に走ることはない。
  // スマホのアドレスバーの出入りで何度も起きるので、少し待ってからまとめて1回だけ処理する。
  let timer = 0;
  const relayout = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const s = parentSize();
      const next = computeLayout(s.w, s.h);
      if (sameSize(next, getLayout())) return;
      setLayout(next);
      game.scale.setGameSize(next.width, next.height);
      game.events.emit(LAYOUT_EVENT);
    }, 150);
  };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);

  if (import.meta.env.DEV) installDebug();
}

void start();
