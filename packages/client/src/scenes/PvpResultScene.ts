// 対戦の結果。勝ち・負け・引き分け、理由、振り返り、通算成績。「もう一戦」と「部屋を出る」。星は出さない。
// サーバーは room → result の順に送るが、result が画面を作るより遅れて届くことがある。
// そこで、room が届いた時点で枠と「部屋を出る」を出し、result（同じ battleNo）が届いたら中身を組む。どちらの順でも同じ画面になる。
// 両者が「もう一戦」を押すと room が setup になり、pvp.ts が配置の画面へ移す（このシーンは移らない・作り直しも予約しない）。

import type { Side } from '@jinkei/engine';
import Phaser from 'phaser';
import { COLOR } from '../art/palette.ts';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT, resultLayout } from '../layout.ts';
import { client, pvp } from '../net/pvp.ts';
import { Button } from '../ui/Button.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';
import { percent, reasonOf, titleOf, unitName } from './ResultScene.ts';

/** 通算成績（自分から見た勝ち・負け・引き分け） */
function scoreText(score: [number, number, number], you: Side): string {
  const win = score[you];
  const lose = score[you === 0 ? 1 : 0];
  const draw = score[2];
  return draw > 0 ? `${win}勝 ${lose}敗 ${draw}分` : `${win}勝 ${lose}敗`;
}

export class PvpResultScene extends Phaser.Scene {
  private rematchButton: Button | null = null;
  private otherText!: Phaser.GameObjects.Text;
  private unsubscribe: (() => void) | null = null;
  /** 中身（勝敗と振り返り）を組んだ戦いの番号。まだなら -1 */
  private builtFor = -1;

  constructor() {
    super('PvpResult');
  }

  create(): void {
    debug.scene = 'PvpResult';
    pvp.arrived('PvpResult');
    const layout = getLayout();
    this.cameras.main.setSize(layout.width, layout.height);
    this.builtFor = -1;
    this.rematchButton = null;
    const r = resultLayout(layout);
    // 枠と「部屋を出る」は、結果が届く前から出す（届かなくても出られるように）
    drawBox(this.add.graphics(), r.box);
    const [b1, , b3] = r.buttons;
    if (b3) new Button(this, b3, '部屋を出る', () => pvp.leave());
    // 相手が「もう一戦」を押したかは、ボタンの列の下に小さく出す
    this.otherText = addText(this, Math.round(r.centerX), b1 ? b1.y + b1.h + 8 : r.box.y + r.box.h + 2, '', 16, COLOR.muted).setOrigin(0.5, 0);
    this.refresh();
    this.unsubscribe = client.subscribe(() => this.refresh());

    const onLayout = (): void => pvp.requestRestart(this);
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      this.unsubscribe?.();
      debug.retry = null;
    });
    debug.retry = () => this.rematch();
  }

  /** result（いまの戦いのもの）が届いていれば、中身と「もう一戦」を組む */
  private buildContent(): void {
    const room = client.room;
    const res = client.result;
    if (!room || !res || res.battleNo !== room.battleNo || this.builtFor === res.battleNo) return;
    this.builtFor = res.battleNo;
    const r = resultLayout(getLayout());
    const you = room.you;
    const enemy: Side = you === 0 ? 1 : 0;
    const s = res.summary;
    // 部隊の呼び名は、振り返りの値（summary.units の wing）だけから作る
    const units = s.units;
    const center = (y: number, text: string, size: 16 | 32 = 16, color: number = COLOR.cream): Phaser.GameObjects.Text =>
      addText(this, Math.round(r.centerX), y, text, size, color).setOrigin(0.5, 0);
    const won = s.winner === you;
    center(r.title, titleOf(s, you), 32, won ? COLOR.goldHi : s.winner === 'draw' ? COLOR.cream : COLOR.red);
    center(r.reason, reasonOf(s, you));
    center(r.stars, scoreText(res.score, you), 16, COLOR.goldHi);
    const best = s.units
      .filter((u) => u.side === you && u.routsCaused > 0)
      .reduce<{ id: number; n: number } | null>((a, u) => (!a || u.routsCaused > a.n ? { id: u.id, n: u.routsCaused } : a), null);
    center(r.review, '先に崩れた', 16, COLOR.muted);
    center(r.review + 20, `自軍 ${unitName(s.firstBroken[you], units, you)}`);
    center(r.review + 40, `敵軍 ${unitName(s.firstBroken[enemy], units, you)}`);
    center(r.review + 68, '一番崩した', 16, COLOR.muted);
    center(r.review + 88, unitName(best ? best.id : null, units, you));
    center(r.review + 116, `残った兵 自軍${percent(s.remaining[you])} 敵軍${percent(s.remaining[enemy])}`);
    const [b1] = r.buttons;
    if (b1) this.rematchButton = new Button(this, b1, 'もう一戦', () => this.rematch(), { primary: true });
  }

  private rematch(): void {
    const room = client.room;
    if (!room || room.rematch[room.you] || this.builtFor !== room.battleNo) return;
    client.send({ type: 'rematch', battleNo: room.battleNo });
  }

  /** 中身を組み、自分と相手が「もう一戦」を押したかを、ボタンの文字と小さな印で出す */
  private refresh(): void {
    const room = client.room;
    if (!room || room.phase !== 'result') return;
    this.buildContent();
    const mine = room.rematch[room.you];
    const theirs = room.rematch[room.you === 0 ? 1 : 0];
    this.rematchButton?.setText(mine ? '待っています' : 'もう一戦').setSelected(mine);
    this.otherText.setText(theirs ? '相手 もう一戦' : '');
  }
}
