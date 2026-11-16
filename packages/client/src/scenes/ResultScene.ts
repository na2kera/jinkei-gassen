// 結果の画面。勝敗、理由、残った兵の割合、簡単な振り返り、「もう一度」（同じ配置のまま配置の画面へ戻る）。

import type { BattleSummary, Side, UnitView } from '@jinkei/engine';
import Phaser from 'phaser';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT, resultLayout } from '../layout.ts';
import { session } from '../session.ts';
import { Button } from '../ui/Button.ts';
import { KIND_LABEL, WING_LABEL, wingForViewer } from '../ui/labels.ts';
import { addText } from '../ui/text.ts';

function titleOf(s: BattleSummary, viewer: Side): string {
  if (s.winner === 'draw') return '引き分け';
  return s.winner === viewer ? '勝ち' : '負け';
}

function reasonOf(s: BattleSummary, viewer: Side): string {
  const won = s.winner === viewer;
  switch (s.reason) {
    case 'hq':
      return won ? '本陣を討った' : '本陣を討たれた';
    case 'wipeout':
      return won ? '敵軍が壊滅' : '自軍が壊滅';
    case 'timeout':
      return '時間切れ';
    default:
      return '';
  }
}

/** 画面に出す百分率。時間切れの比べ方と同じく、小数点以下を四捨五入する（assumptions S7） */
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function unitName(id: number | null, units: UnitView[], viewer: Side): string {
  if (id === null) return 'なし';
  const u = units.find((v) => v.id === id);
  if (!u) return 'なし';
  if (u.kind === 'hq') return KIND_LABEL.hq;
  // 翼は見ている人から見た左右（敵の翼は左右を入れ替える。戦闘の画面の号令の表示と同じ）
  return `${WING_LABEL[wingForViewer(u.wing, u.side, viewer)]}の${KIND_LABEL[u.kind]}`;
}

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(): void {
    debug.scene = 'Result';
    const result = session.result;
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    const r = resultLayout(layout);
    const retry = (): void => {
      this.scene.start('Deploy');
    };
    if (result) {
      const { summary: s, units, viewer } = result;
      const enemy: Side = viewer === 0 ? 1 : 0;
      const center = (y: number, text: string, size: 16 | 32 = 16): void => {
        addText(this, Math.round(r.centerX), y, text, size).setOrigin(0.5, 0);
      };
      center(r.title, titleOf(s, viewer), 32);
      center(r.reason, reasonOf(s, viewer));
      center(r.remaining, `残った兵 自軍${percent(s.remaining[viewer])} 敵軍${percent(s.remaining[enemy])}`);
      // 振り返り：最初に崩れた部隊（両軍）と、いちばん損害を与えた自軍の部隊
      const best = s.units
        .filter((u) => u.side === viewer && u.dealt > 0)
        .reduce<{ id: number; dealt: number } | null>((a, u) => (!a || u.dealt > a.dealt ? { id: u.id, dealt: u.dealt } : a), null);
      center(r.review, '先に崩れた');
      center(r.review + 20, `自軍 ${unitName(s.firstBroken[viewer], units, viewer)}`);
      center(r.review + 40, `敵軍 ${unitName(s.firstBroken[enemy], units, viewer)}`);
      center(r.review + 72, '一番の戦果');
      center(r.review + 92, unitName(best ? best.id : null, units, viewer));
    }
    new Button(this, r.retry, 'もう一度', retry);

    const onLayout = (): void => {
      this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      debug.retry = null;
    });
    debug.retry = retry;
  }
}
