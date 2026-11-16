// 結果の画面。勝敗、理由、星（勝ったときだけ、1つずつ出す）、振り返り、ボタン（もう一度・次へ・戻る）。
// 星はここで保存する（前より多いときだけ書き換える）。

import { starsFor, type BattleSummary, type Side, type UnitView } from '@jinkei/engine';
import Phaser from 'phaser';
import { drawStar, STAR_SIZE } from '../art/icons.ts';
import { COLOR } from '../art/palette.ts';
import { playStar } from '../audio/sfx.ts';
import { debug } from '../debug.ts';
import { getLayout, LAYOUT_EVENT, resultLayout } from '../layout.ts';
import { recordStars } from '../save.ts';
import { nextStage, session, stageById } from '../session.ts';
import { Button } from '../ui/Button.ts';
import { KIND_LABEL, WING_LABEL, wingForViewer } from '../ui/labels.ts';
import { drawBox } from '../ui/panel.ts';
import { addText } from '../ui/text.ts';

/** 星を1つずつ出す間（ミリ秒） */
const STAR_STEP_MS = 350;

export function titleOf(s: BattleSummary, viewer: Side): string {
  if (s.winner === 'draw') return '引き分け';
  return s.winner === viewer ? '勝ち' : '負け';
}

/**
 * 決着の理由。survive は「時間切れまで守り切れば勝ち」の面（時間切れで勝ったら「守り切った」と出す）
 */
export function reasonOf(s: BattleSummary, viewer: Side, survive = false): string {
  const won = s.winner === viewer;
  switch (s.reason) {
    case 'gate':
      return won ? '門を破った' : '門を破られた';
    case 'hq':
      return won ? '本陣を討った' : '本陣を討たれた';
    case 'wipeout':
      return won ? '敵軍が壊滅' : '自軍が壊滅';
    case 'timeout':
      return survive && won ? '守り切った' : '時間切れ';
    default:
      return '';
  }
}

/** 画面に出す百分率。時間切れの比べ方と同じく、小数点以下を四捨五入する（assumptions S7） */
export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * 部隊の呼び名（「左翼の騎兵」）。翼は見ている人から見た左右（敵の翼は左右を入れ替える）。
 * 振り返りの値（BattleSummary.units。wing を持つ）だけから呼ぶ。場面に頼ると、結果の画面だけに戻ってきた人や、
 * 別の戦いの場面が残っているときに、名前が「なし」になったり、違う部隊を指したりするため
 */
export function unitName(id: number | null, units: readonly Pick<UnitView, 'id' | 'side' | 'kind' | 'wing'>[], viewer: Side): string {
  if (id === null) return 'なし';
  const u = units.find((v) => v.id === id);
  if (!u) return 'なし';
  if (u.kind === 'hq') return KIND_LABEL.hq;
  return `${WING_LABEL[wingForViewer(u.wing, u.side, viewer)]}の${KIND_LABEL[u.kind]}`;
}

/** 前の画面の星の演出を、向きの切り替えで作り直したときに繰り返さないため */
let shownFor: ResultData | null = null;
type ResultData = NonNullable<typeof session.result>;

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
    const stageId = result?.stageId ?? session.stageId;
    const retry = (): void => {
      this.scene.start('Deploy', { stageId });
    };
    const back = (): void => {
      this.scene.start('StageSelect');
    };
    const won = !!result && result.summary.winner === result.viewer;
    const next = (): void => {
      const n = nextStage(stageId);
      if (n) {
        session.stageId = n.id;
        this.scene.start('Deploy', { stageId: n.id });
      } else {
        this.scene.start('StageSelect');
      }
    };

    if (result) {
      const { summary: s, viewer } = result;
      const units = s.units;
      const enemy: Side = viewer === 0 ? 1 : 0;
      drawBox(this.add.graphics(), r.box);
      // 見出しは淡い色、中身は明るい色にして、説明文を足さずに読み分けられるようにする
      const center = (y: number, text: string, size: 16 | 32 = 16, color: number = COLOR.cream): void => {
        addText(this, Math.round(r.centerX), y, text, size, color).setOrigin(0.5, 0);
      };
      center(r.title, titleOf(s, viewer), 32, won ? COLOR.goldHi : s.winner === 'draw' ? COLOR.cream : COLOR.red);
      center(r.reason, reasonOf(s, viewer, stageById(stageId)?.win.type === 'survive'));

      // 星：勝ったときだけ。取った星を1つずつ出す（向きの切り替えで作り直したときは、すぐ全部出す）
      const stars = won ? starsFor(s, viewer) : 0;
      if (won) {
        recordStars(stageId, stars);
        const g = this.add.graphics();
        const size = STAR_SIZE * 2;
        const gap = 8;
        const x0 = Math.round((r.centerX - (3 * size + 2 * gap) / 2) / 2) * 2;
        const drawUpTo = (n: number): void => {
          g.clear();
          for (let i = 0; i < 3; i++) drawStar(g, x0 + i * (size + gap), r.stars, i < n);
        };
        const animate = shownFor !== result;
        shownFor = result;
        drawUpTo(animate ? 0 : stars);
        if (animate) {
          for (let i = 0; i < stars; i++) {
            this.time.delayedCall(STAR_STEP_MS * (i + 1), () => {
              drawUpTo(i + 1);
              playStar(i);
            });
          }
        }
      }

      // 振り返り：最初に崩れた部隊（両軍）、いちばん敵を崩した自軍の部隊、残った兵の割合
      const best = s.units
        .filter((u) => u.side === viewer && u.routsCaused > 0)
        .reduce<{ id: number; n: number } | null>((a, u) => (!a || u.routsCaused > a.n ? { id: u.id, n: u.routsCaused } : a), null);
      center(r.review, '先に崩れた', 16, COLOR.muted);
      center(r.review + 20, `自軍 ${unitName(s.firstBroken[viewer], units, viewer)}`);
      center(r.review + 40, `敵軍 ${unitName(s.firstBroken[enemy], units, viewer)}`);
      center(r.review + 68, '一番崩した', 16, COLOR.muted);
      center(r.review + 88, unitName(best ? best.id : null, units, viewer));
      center(r.review + 116, `残った兵 自軍${percent(s.remaining[viewer])} 敵軍${percent(s.remaining[enemy])}`);
    }

    const [b1, b2, b3] = r.buttons;
    if (b1) new Button(this, b1, 'もう一度', retry, { primary: !won });
    // 次へは勝ったときだけ（最後の面ではステージ選択へ）
    if (b2 && won) new Button(this, b2, '次へ', next, { primary: true });
    if (b3) new Button(this, b3, '戻る', back);

    const onLayout = (): void => {
      this.scene.restart();
    };
    this.game.events.on(LAYOUT_EVENT, onLayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(LAYOUT_EVENT, onLayout);
      debug.retry = null;
      debug.next = null;
      debug.back = null;
    });
    debug.retry = retry;
    debug.next = won ? next : null;
    debug.back = back;
  }
}
