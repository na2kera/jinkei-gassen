// 音を切るボタン（タイトル・配置・戦闘の画面で、同じ見た目で出す）。切ったかどうかは保存に残す。

import type Phaser from 'phaser';
import { isMuted, setMuted } from '../audio/sfx.ts';
import type { Rect } from '../layout.ts';
import { saveMuted } from '../save.ts';
import { Button } from './Button.ts';

function label(): string {
  return isMuted() ? '音なし' : '音あり';
}

export function addMuteButton(scene: Phaser.Scene, rect: Rect): Button {
  const b: Button = new Button(scene, rect, label(), () => {
    setMuted(!isMuted());
    saveMuted(isMuted());
    b.setText(label());
  });
  return b;
}
