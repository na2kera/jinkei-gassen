// 画面に出す日本語の呼び名。

import type { Kind, OrderKind, OrderTarget, Stance, Wing } from '@jinkei/engine';

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
