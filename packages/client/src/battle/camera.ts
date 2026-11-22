// 立体の画面のカメラの状態（design §14.4・§14.5）。表示物の作り直し（rebuild）とは別に持つ。
// 止まった向き・動いている途中（始まりの (rot, k)・終わりの向き・始まった時刻）。Phaser を読まない。

import type { Rect } from '../layout.ts';
import { camBetween, deg, fit, limit, type BoardSize, type Cam } from './BoardView.ts';

/** 戦闘の盤の向き：右斜め 30°・左斜め −30°・横 90°・後ろ 0° */
export type BoardDir = 'right' | 'left' | 'side' | 'back';

export const DIR_ROT: Record<BoardDir, number> = { right: deg(30), left: deg(-30), side: deg(90), back: 0 };

/** 戦闘中の向きの切り替えの時間（ミリ秒。倍速は掛けない） */
export const TURN_MS = 1100;
/** 公開の回転の時間と、はじめに止めておく時間（ミリ秒） */
export const REVEAL_TURN_MS = 2200;

/** 止まった向きの戦闘のカメラ */
export function battleCam(dir: BoardDir, area: Rect, b: BoardSize): Cam {
  const rot = DIR_ROT[dir];
  return { rot, k: fit(rot, true, area, b) };
}

/** 配置のカメラ（回さない、縮めない） */
export function deployCam(): Cam {
  return { rot: 0, k: 1 };
}

/**
 * 公開の回転の進み具合（0〜1）。startsAt に対する絶対の時刻で決める（同じ時刻なら同じ進み具合）。
 * startsAt の 2.2 秒前までは 0（配置と同じ向き）、startsAt で 1
 */
export function revealProgress(serverNow: number, startsAt: number): number {
  return Math.max(0, Math.min(1, (serverNow - (startsAt - REVEAL_TURN_MS)) / REVEAL_TURN_MS));
}

/** 公開の回転のカメラ（配置 → 保存してある向き。ゆるい限り） */
export function revealCam(dir: BoardDir, p: number, area: Rect, b: BoardSize): Cam {
  const to = { rot: DIR_ROT[dir], k: fit(DIR_ROT[dir], false, area, b) };
  return camBetween(deployCam(), to, p, false, area, b);
}

/** 戦闘中の向きの切り替え */
export class BattleCamera {
  dir: BoardDir;
  private anim: { from: Cam; start: number } | null = null;
  /** 確かめ用：進み具合をこの値で止める（null なら止めない） */
  freeze: number | null = null;

  constructor(dir: BoardDir) {
    this.dir = dir;
  }

  get moving(): boolean {
    return this.anim !== null;
  }

  /** いまのカメラ。動き終えたら止める */
  camAt(now: number, area: Rect, b: BoardSize): Cam {
    const to = battleCam(this.dir, area, b);
    const a = this.anim;
    if (!a) return to;
    const p = this.freeze ?? Math.min(1, (now - a.start) / TURN_MS);
    // 始まりの縮みは、いまの描き場所で入る限りに収めてから結ぶ（画面の大きさが変わった作り直しのため）
    const from = { rot: a.from.rot, k: Math.min(a.from.k, limit(a.from.rot, true, area, b)) };
    const cam = camBetween(from, to, p, true, area, b);
    if (p >= 1 && this.freeze === null) this.anim = null;
    return cam;
  }

  /** 次の向きへ回し始める（動いている途中なら、そのときのカメラから向け直す） */
  turnTo(dir: BoardDir, now: number, area: Rect, b: BoardSize): void {
    const from = this.camAt(now, area, b);
    this.dir = dir;
    this.anim = { from, start: now };
  }

  /** すぐ止まる先に飛ばす（確かめ用） */
  jump(): void {
    this.anim = null;
    this.freeze = null;
  }
}
