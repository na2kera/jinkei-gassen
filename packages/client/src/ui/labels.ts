// 画面に出す日本語の呼び名。

import type { Kind, OrderKind, OrderTarget, Stance, Wing } from '@jinkei/engine';
import type { ViewMode } from '../battle/viewMode.ts';

export const KIND_LABEL: Record<Kind, string> = {
  hq: '本陣',
  infantry: '歩兵',
  shield: '盾兵',
  cavalry: '騎兵',
  archer: '弓兵',
};

/** 手持ちの並び順 */
export const ROSTER_ORDER: readonly Kind[] = ['hq', 'infantry', 'shield', 'cavalry', 'archer'];

export const STANCE_LABEL: Record<Stance, string> = {
  advance: '前進',
  hold: '守備',
  flank: '迂回',
  hunt: '本陣狙い',
};

export const ORDER_LABEL: Record<OrderKind, string> = {
  charge: '突撃',
  brace: '堅守',
  retreat: '後退',
};

export const TARGET_LABEL: Record<OrderTarget, string> = {
  all: '全軍',
  left: '左翼',
  center: '中央',
  right: '右翼',
};

/**
 * 画面に出す百分率。時間切れの比べ方と同じく、小数点以下を四捨五入する（assumptions S7）。
 * 1人用と対戦の結果の画面で使う。Phaser を読まない所に置き、文を決める関数を画面なしで試せるようにする
 */
export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export const WING_LABEL: Record<Wing, string> = {
  left: '左翼',
  center: '中央',
  right: '右翼',
};


/**
 * 見ている人から見た翼。engine の翼は、その部隊の陣営から見た左右で持っている。
 * 自軍は画面の左右と同じ（自軍はいつも下に映すため）。敵軍は向かい合うので左右が入れ替わる。
 */
export function wingForViewer<T extends Wing | OrderTarget>(wing: T, side: 0 | 1, viewer: 0 | 1): T {
  if (side === viewer) return wing;
  if (wing === 'left') return 'right' as T;
  if (wing === 'right') return 'left' as T;
  return wing;
}

/** 遊軍（design §7、decisions §15）。配置の枠と、現れたときの知らせの文字 */
export const RESERVE_LABEL = '遊軍';

/** 戦闘の画面の遊軍のボタン。左右は見ている人から見た左右（engine の from と同じ向き。返さずに渡す） */
export const RESERVE_FROM_LABEL: Record<'left' | 'right', string> = {
  left: '遊軍 左から',
  right: '遊軍 右から',
};

/** 視点のボタンの文字（design §14.11・§14.16 の案。ボタンに収まらなければ、短い案（VIEW_LABEL_SHORT）にする） */
export const VIEW_LABEL: Record<ViewMode, string> = {
  right: '視点：右斜め',
  left: '視点：左斜め',
  side: '視点：横',
  back: '視点：後ろ',
};

/** 視点のボタンの短い案 */
export const VIEW_LABEL_SHORT: Record<ViewMode, string> = {
  right: '視点：右',
  left: '視点：左',
  side: '視点：横',
  back: '視点：後ろ',
};
