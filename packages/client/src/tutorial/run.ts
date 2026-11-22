// チュートリアルを始める・操作を当てはめる・終える（design §8.3、§8.6）。進み具合は session.tutorial に持つ。
// 画面の操作も開発用の口も、操作はかならず tutorialAct を通す（受け付けた操作だけが、画面の処理に進む）。

import { orderedStages, session } from '../session.ts';
import { markTutorialDone } from '../save.ts';
import { TUTORIAL_STAGE } from '@jinkei/engine';
import type Phaser from 'phaser';
import type { LocalBattleSource } from '../battle/LocalBattleSource.ts';
import { allowed, apply, newRun, type TutorialAction, type TutorialRun } from './steps.ts';

/** 目立たせるものを出したり消したりする間隔（ミリ秒） */
const BLINK_MS = 500;

/** チュートリアルの戦い（止まっているかを開発用の口で見るため、と再開のため） */
let battle: LocalBattleSource | null = null;
/** 始める前の面（ステージ選択から始めたときは、終えたら戻す） */
let prevStageId = '';

/** チュートリアルを始める。配置は本陣だけから（本陣は最初から置いてある。design §15.7） */
export function startTutorial(from: TutorialRun['from']): void {
  if (!session.tutorial) prevStageId = session.stageId;
  battle?.dispose();
  battle = null;
  session.tutorial = newRun(from);
  session.stageId = TUTORIAL_STAGE.id;
  session.placements = session.tutorial.placed.map((p) => ({ ...p }));
  session.reserve = null;
}

/** いまその操作を受け付けるなら当てはめて true。チュートリアルでないとき・受け付けないときは false で、何も変えない */
export function tutorialAct(a: TutorialAction): boolean {
  const run = session.tutorial;
  if (!run || !allowed(run, a)) return false;
  session.tutorial = apply(run, a);
  return true;
}

export function setTutorialBattle(src: LocalBattleSource | null): void {
  battle = src;
}

/** 止まっている戦いを再開する（号令を渡したあとに呼ぶ） */
export function resumeTutorialBattle(): void {
  battle?.resume();
}

export function tutorialPaused(): boolean {
  return battle?.paused ?? false;
}

/** いま目立たせる側か（0.5 秒ごとに入れ替わる） */
export function blinkOn(now: number): boolean {
  return Math.floor(now / BLINK_MS) % 2 === 0;
}

/**
 * 「飛ばす」と「次へ」。済みを付け、session.tutorial を null にし、戦いが動いていれば捨てて、行き先へ移る。確かめの箱は出さない。
 * 行き先は、タイトルから自動で始めたなら 1-1 の配置の画面、ステージ選択から始めたならステージ選択
 */
export function finishTutorial(scene: Phaser.Scene): void {
  const run = session.tutorial;
  // 終える処理は1度だけ（連打で2回呼ばれても、済みの印・捨てる・画面の移動は1回ずつ）
  if (!run) return;
  markTutorialDone();
  session.tutorial = null;
  battle?.dispose();
  battle = null;
  session.placements = [];
  session.reserve = null;
  const first = orderedStages()[0];
  if (run.from === 'auto' && first) {
    session.stageId = first.id;
    scene.scene.start('Deploy', { stageId: first.id });
    return;
  }
  session.stageId = prevStageId && prevStageId !== TUTORIAL_STAGE.id ? prevStageId : (first?.id ?? '');
  scene.scene.start('StageSelect');
}
