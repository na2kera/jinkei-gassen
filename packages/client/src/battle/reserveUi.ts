// 戦闘の画面の遊軍（design §7.8）：ボタンを出すか・押せるかと、現れたときの「遊軍」の知らせの置き場所。
// Phaser を使わない計算だけにして、画面なしで確かめられるようにする。

import type { ReserveView } from '@jinkei/engine';
import type { Rect } from '../layout.ts';
import { unitLift } from '../art/formation.ts';
import { unitBoxAt } from '../ui/unitBox.ts';
import type { FieldView, Point } from './FieldView.ts';

/** 遊軍のボタンを出すか。自分に遊軍がいる戦いだけ（呼んだあとも、押せない色で出したままにする） */
export function summonShown(reserve: ReserveView | null): boolean {
  return reserve !== null;
}

/**
 * 遊軍のボタンを押せるか。'waiting'（開戦 5 秒まで）と 'used'（呼んだあと）、決着のあと、
 * 送って返事を待っている間（sent）は押せない。対戦では、使える部屋（rules.reserve）であることも要る（allowed）
 */
export function summonEnabled(reserve: ReserveView | null, opts: { ended: boolean; allowed: boolean; sent: boolean }): boolean {
  return !!reserve && reserve.state === 'ready' && !opts.ended && opts.allowed && !opts.sent;
}

/**
 * 「遊軍」の知らせの箱（幅 w・高さ h）の左上。部隊の上に出す（兵数と士気の箱と同じ置き方）。
 * 将軍の視点で部隊が枠の外（fv.visible が false）にいるときは、その部隊がいる側の枠の端へ寄せ、
 * 縦はその部隊の奥行きの高さ（画面の縦）に合わせて、枠の中に収める（design §5.8.3）。
 * x, y は部隊の戦場の座標、area は描き場所（12列×16行ぶん）
 */
export function reserveNoticeAt(fv: FieldView, area: Rect, x: number, y: number, w: number, h: number): Point {
  const f = fv.uiBounds(area);
  const p = fv.toScreen(x, y);
  if (fv.visible(x, y)) return unitBoxAt(f, p, w, h, unitLift(fv, x, y));
  const left = p.x < f.x + f.w / 2;
  const bx = left ? f.x + 4 : f.x + f.w - w - 4;
  const by = Math.max(f.y + 4, Math.min(f.y + f.h - h - 4, p.y - h));
  return { x: Math.round(bx / 2) * 2, y: Math.round(by / 2) * 2 };
}

/**
 * 結果の画面の「残った兵」に出す割合（design §7.5）。星と食い違わないよう remainingForStars（呼ばなかった遊軍を
 * 無傷で残ったものとして数える）を使う。遊軍の前の形の振り返り（項目がない・数でない）では remaining を使う。
 * 1人用の結果の画面（ResultScene）のためのもの。対戦の結果は勝ち負けの数え方（remaining）で出すので、ここは呼ばない（design §11.3）
 */
export function remainingShown(s: { remaining: [number, number]; remainingForStars?: [number, number] }, side: 0 | 1): number {
  const v: unknown = s.remainingForStars?.[side];
  return typeof v === 'number' && Number.isFinite(v) ? v : s.remaining[side];
}
