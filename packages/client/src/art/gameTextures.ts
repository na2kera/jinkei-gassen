// ゲームの起動で作るテクスチャの入口（design §14.2・§14.14）。
// 段 7（片付け）までは、古い絵（buildTextures。まだ切り替えていない画面が使う）と、立体の新しい絵（ワーカーで焼く）の両方を作る。
// 古い buildTextures() は、ポスターと OGP の道具も使うので、中身を変えずに残す（道具はこの入口を呼ばない）。
// 段 7 で、ここから古い兵の絵と森の立った絵を外す。

import type Phaser from 'phaser';
import { stackTextures, type StartOptions } from './stack/stackTextures.ts';
import { buildTextures } from './textures.ts';

/** 開発のときだけ、URL で焼き方を変えられる（確かめ用）。?stackWorker=0 で主スレッドの列、?stackTex=canvas で addCanvas */
function devOptions(): StartOptions {
  if (!import.meta.env.DEV) return {};
  const q = new URLSearchParams(window.location.search);
  return {
    ...(q.get('stackWorker') === '0' ? { worker: false } : {}),
    ...(q.get('stackTex') === 'canvas' ? { path: 'canvas' as const } : {}),
  };
}

export function buildGameTextures(scene: Phaser.Scene): void {
  buildTextures(scene);
  // 立体の絵は頼むだけで、待たない（焼くのはワーカー。届いた絵は 1 コマに 1 枚ずつ取り込む）
  stackTextures.start(scene.game, devOptions());
}
