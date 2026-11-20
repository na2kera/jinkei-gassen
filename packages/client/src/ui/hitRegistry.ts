// シーンごとの、押せる範囲の名簿（design §9.2、§9.9-2・5）。ボタンと障害物を入れておき、まとめて広げる。
// ボタンを作るたびに計算すると、1つの画面で 20〜40 個作るので、名簿が変わったら印を付け、
// 次の preupdate で1回だけ growGroups を呼ぶ。
// 名簿が変わったその場で、同じシーンの全ボタンをもとの矩形に戻す（計算し直す前に、古い広がりで押せてしまわないように）。
// node のテストでにせのシーンを通せるよう、Phaser は型だけを読み、出来事の名前は文字列で持つ。

import type Phaser from 'phaser';
import type { Rect } from '../layout.ts';
import { growGroups, HIT_GROW_MAX, type HitGroup } from './hitGrow.ts';

/** Phaser.Scenes.Events.PRE_UPDATE・SHUTDOWN と、Phaser.GameObjects.Events.DESTROY（型だけを読んでいるので、値をここに書く） */
const PRE_UPDATE = 'preupdate';
const SHUTDOWN = 'shutdown';
const DESTROY = 'destroy';

/** 名簿が使うシーンの口（にせのシーンでも試せるよう、使う所だけ） */
export interface HitScene {
  events: {
    on(event: string, fn: () => void): unknown;
    off(event: string, fn: () => void): unknown;
    once(event: string, fn: () => void): unknown;
  };
  scale: { width: number; height: number };
}

/** 押せる範囲を持つもの（Phaser の Zone）。原点 (0, 0) のまま、位置と大きさを変える */
export interface HitZone {
  setPosition(x: number, y: number): unknown;
  setSize(w: number, h: number): unknown;
  once(event: string, fn: () => void): unknown;
  readonly input?: { hitArea?: { width: number; height: number } } | null;
  readonly x?: number;
  readonly y?: number;
}

interface ButtonEntry {
  rect: Rect;
  group: HitGroup;
  zone: HitZone;
  label: string;
  grown: Rect;
}

class Registry {
  readonly buttons: ButtonEntry[] = [];
  readonly obstacles: Rect[] = [];
  dirty = false;
  /** shutdown のあと（Zone の destroy の合図が遅れて来ても、何もしない） */
  dead = false;
  private readonly scene: HitScene;
  private readonly onPreUpdate = (): void => this.update();

  // 引数プロパティは node のテスト（--experimental-strip-types）で読めないので、ふつうの項目にする
  constructor(scene: HitScene) {
    this.scene = scene;
    scene.events.on(PRE_UPDATE, this.onPreUpdate);
    scene.events.once(SHUTDOWN, () => this.shutdown());
  }

  /** 名簿が変わった。全ボタンをもとの矩形に戻し、次の preupdate で広げ直す */
  changed(): void {
    if (this.dead) return;
    this.dirty = true;
    for (const b of this.buttons) apply(b, b.rect);
  }

  update(): void {
    if (this.dead || !this.dirty) return;
    this.dirty = false;
    const bounds = { x: 0, y: 0, w: this.scene.scale.width, h: this.scene.scale.height };
    const grown = growGroups(this.buttons, this.obstacles, bounds, HIT_GROW_MAX);
    this.buttons.forEach((b, i) => apply(b, grown[i] ?? b.rect));
  }

  private shutdown(): void {
    this.dead = true;
    this.buttons.length = 0;
    this.obstacles.length = 0;
    this.scene.events.off(PRE_UPDATE, this.onPreUpdate);
    if (registries.get(this.scene) === this) registries.delete(this.scene);
  }
}

function apply(b: ButtonEntry, r: Rect): void {
  b.grown = { ...r };
  b.zone.setPosition(r.x, r.y);
  b.zone.setSize(r.w, r.h);
}

const registries = new WeakMap<HitScene, Registry>();

function registryOf(scene: HitScene): Registry {
  let r = registries.get(scene);
  if (!r || r.dead) {
    r = new Registry(scene);
    registries.set(scene, r);
  }
  return r;
}

/** 外す関数を、1度だけ働くようにする（2度外しても壊れないように） */
function onceOnly(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

/**
 * ボタンの押せる範囲を名簿に入れる。戻り値で外せる。
 * Zone の destroy の合図でも1度だけ外す（BattleScene の rebuild は root.destroy() で子を直に消し、
 * Button.destroy() を通らないため。§9.9-2）
 */
export function addHitButton(scene: HitScene | Phaser.Scene, rect: Rect, group: HitGroup, zone: HitZone, label = ''): () => void {
  const reg = registryOf(scene as HitScene);
  const entry: ButtonEntry = { rect: { ...rect }, group, zone, label, grown: { ...rect } };
  reg.buttons.push(entry);
  reg.changed();
  const remove = onceOnly(() => {
    if (reg.dead) return;
    const i = reg.buttons.indexOf(entry);
    if (i >= 0) reg.buttons.splice(i, 1);
    reg.changed();
  });
  zone.once(DESTROY, remove);
  return remove;
}

/** 障害物（戦場・入力欄など、ボタンが広がって食い込んではいけない所）を入れる。戻り値で外せる */
export function addHitObstacle(scene: HitScene | Phaser.Scene, rect: Rect): () => void {
  const reg = registryOf(scene as HitScene);
  const r = { ...rect };
  reg.obstacles.push(r);
  reg.changed();
  return onceOnly(() => {
    if (reg.dead) return;
    const i = reg.obstacles.indexOf(r);
    if (i >= 0) reg.obstacles.splice(i, 1);
    reg.changed();
  });
}

/** 戦場のまわりの枠の太さ（art/field.ts の drawFieldFrame） */
export const FIELD_FRAME = 4;

/** 矩形を外へ pad だけ太らせる（戦場の枠 4px を足すため） */
export function padRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

export interface HitSnapshot {
  /** 広げ直す前か（名簿が変わってから、まだ preupdate が来ていない） */
  dirty: boolean;
  buttons: {
    label: string;
    group: HitGroup;
    /** 絵の矩形 */
    rect: Rect;
    /** いまの Zone の位置と、押せる範囲（input.hitArea）の大きさ。計算の値ではなく、実際の値 */
    hit: Rect;
  }[];
  obstacles: Rect[];
}

/** 開発用の口（__jg.hits）とテストのための、いまの名簿の写し */
export function hitSnapshot(scene: HitScene | Phaser.Scene): HitSnapshot {
  const reg = registries.get(scene as HitScene);
  if (!reg || reg.dead) return { dirty: false, buttons: [], obstacles: [] };
  return {
    dirty: reg.dirty,
    buttons: reg.buttons.map((b) => {
      const ha = b.zone.input?.hitArea;
      const hit: Rect = { x: b.zone.x ?? b.grown.x, y: b.zone.y ?? b.grown.y, w: ha?.width ?? b.grown.w, h: ha?.height ?? b.grown.h };
      return { label: b.label, group: b.group, rect: { ...b.rect }, hit };
    }),
    obstacles: reg.obstacles.map((o) => ({ ...o })),
  };
}
