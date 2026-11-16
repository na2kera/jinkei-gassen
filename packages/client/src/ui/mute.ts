// 音を切るボタン（配置と戦闘の画面で同じ場所に出す）。設定は今回は保存しない。

import type Phaser from 'phaser';
import { isMuted, setMuted } from '../audio/sfx.ts';
import type { Rect } from '../layout.ts';
import { Button } from './Button.ts';

function label(): string {
  return isMuted() ? '音なし' : '音あり';
}

export function addMuteButton(scene: Phaser.Scene, rect: Rect): Button {
  const b: Button = new Button(scene, rect, label(), () => {
    setMuted(!isMuted());
    b.setText(label());
  });
  return b;
}
