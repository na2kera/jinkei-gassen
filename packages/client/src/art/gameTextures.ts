// ゲームの起動で作るテクスチャの入口（design §14.2・§14.14）。
// 地形のタイル・瓦礫・霧・門（立体の画面でも地面に描く）と、立体の兵と木の絵（ワーカーで焼く）を作る。
// 古い兵の絵を作る buildTextures() は、ポスターと OGP の道具のために、中身を変えずに textures.ts に残してある。

import type Phaser from 'phaser';
import type { SetId } from './stack/jobs.ts';
import { stackTextures, type StartOptions } from './stack/stackTextures.ts';
import { buildGameTiles } from './textures.ts';

/** 開発のときだけ、URL で焼き方を変えられる（確かめ用）。?stackWorker=0 で主スレッドの列、?stackTex=canvas で addCanvas */
function devOptions(): StartOptions {
  if (!import.meta.env.DEV) return {};
  const q = new URLSearchParams(window.location.search);
  return {
    ...(q.get('stackWorker') === '0' ? { worker: false } : {}),
    ...(q.get('stackTex') === 'canvas' ? { path: 'canvas' as const } : {}),
    // 絵が遅れて届くときを作る：?stackDelay=ミリ秒 で全部の絵を待たせ、?stackHold=deploy,battle でその揃いを releaseHold まで止める
    ...(q.get('stackDelay') ? { delayMs: Number(q.get('stackDelay')) } : {}),
    ...(q.get('stackHold') ? { hold: q.get('stackHold')!.split(',') as SetId[] } : {}),
  };
}

export function buildGameTextures(scene: Phaser.Scene): void {
  buildGameTiles(scene);
  // 立体の絵は頼むだけで、待たない（焼くのはワーカー。届いた絵は 1 コマに 1 枚ずつ取り込む）
  stackTextures.start(scene.game, devOptions());
}
