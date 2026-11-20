// シーンごとの押せる範囲の名簿（design §9.2、§9.9-2・5。M13）を、にせのシーンと Zone で確かめる。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addHitButton, addHitObstacle, hitSnapshot, type HitScene, type HitZone } from '../src/ui/hitRegistry.ts';

/** Phaser の EventEmitter のうち、名簿が使う所だけ */
class Emitter {
  private readonly map = new Map<string, { fn: () => void; once: boolean }[]>();
  on(e: string, fn: () => void): this {
    this.list(e).push({ fn, once: false });
    return this;
  }
  once(e: string, fn: () => void): this {
    this.list(e).push({ fn, once: true });
    return this;
  }
  off(e: string, fn: () => void): this {
    this.map.set(
      e,
      this.list(e).filter((x) => x.fn !== fn),
    );
    return this;
  }
  emit(e: string): void {
    const l = [...this.list(e)];
    this.map.set(
      e,
      this.list(e).filter((x) => !x.once),
    );
    for (const x of l) x.fn();
  }
  count(e: string): number {
    return this.list(e).length;
  }
  private list(e: string): { fn: () => void; once: boolean }[] {
    let l = this.map.get(e);
    if (!l) {
      l = [];
      this.map.set(e, l);
    }
    return l;
  }
}

class FakeScene implements HitScene {
  readonly events = new Emitter();
  readonly scale = { width: 320, height: 620 };
}

class FakeZone extends Emitter implements HitZone {
  x = 0;
  y = 0;
  readonly input = { hitArea: { width: 0, height: 0 } };
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  setSize(w: number, h: number): this {
    this.input.hitArea.width = w;
    this.input.hitArea.height = h;
    return this;
  }
  destroy(): void {
    this.emit('destroy');
  }
  get rect(): { x: number; y: number; w: number; h: number } {
    return { x: this.x, y: this.y, w: this.input.hitArea.width, h: this.input.hitArea.height };
  }
}

function zoneAt(r: { x: number; y: number; w: number; h: number }): FakeZone {
  return new FakeZone().setPosition(r.x, r.y).setSize(r.w, r.h);
}

test('M13 名簿：入れて外すと数が戻る。同じものを2度外しても壊れない。名簿が変わった直後は、全部がもとの矩形に戻っている', () => {
  const scene = new FakeScene();
  const ra = { x: 100, y: 100, w: 50, h: 30 };
  const rb = { x: 154, y: 100, w: 50, h: 30 };
  const za = zoneAt(ra);
  const zb = zoneAt(rb);
  addHitButton(scene, ra, 'base', za, 'A');
  const removeB = addHitButton(scene, rb, 'base', zb, 'B');
  assert.equal(hitSnapshot(scene).buttons.length, 2);
  assert.equal(hitSnapshot(scene).dirty, true, '入れた直後は、まだ広げていない');
  assert.deepEqual(za.rect, ra);

  // 次の preupdate で1回だけ広げる
  scene.events.emit('preupdate');
  assert.deepEqual(za.rect, { x: 92, y: 92, w: 60, h: 46 });
  assert.deepEqual(zb.rect, { x: 152, y: 92, w: 60, h: 46 });
  assert.equal(hitSnapshot(scene).dirty, false);

  // 障害物を入れた直後は、全部がもとの矩形に戻っている
  const removeObs = addHitObstacle(scene, { x: 0, y: 0, w: 320, h: 96 });
  assert.deepEqual(za.rect, ra);
  assert.deepEqual(zb.rect, rb);
  scene.events.emit('preupdate');
  assert.equal(za.rect.y, 98, '障害物のほうへは半分まで');
  removeObs();
  removeObs();
  assert.equal(hitSnapshot(scene).obstacles.length, 0);

  // 外すと数が戻る。2度外しても、Zone の destroy の合図が後から来ても壊れない
  removeB();
  removeB();
  zb.destroy();
  assert.equal(hitSnapshot(scene).buttons.length, 1);
  assert.deepEqual(za.rect, ra, '外した直後は、もとの矩形');
  scene.events.emit('preupdate');
  assert.deepEqual(za.rect, { x: 92, y: 92, w: 66, h: 46 }, '隣がいなくなったので max まで');

  // Zone の destroy の合図だけでも外れる（Container ごと消されたとき）
  za.destroy();
  assert.equal(hitSnapshot(scene).buttons.length, 0);
});

test('M13 名簿：箱の組があるあいだ下の組は広げない。shutdown で空になり、受け手も外れ、あとから来た destroy は何もしない', () => {
  const scene = new FakeScene();
  const ra = { x: 100, y: 500, w: 50, h: 30 };
  const za = zoneAt(ra);
  addHitButton(scene, ra, 'base', za);
  addHitObstacle(scene, { x: 0, y: 0, w: 320, h: 400 });
  const rp = { x: 100, y: 200, w: 88, h: 28 };
  const zp = zoneAt(rp);
  addHitButton(scene, rp, 'popup', zp);
  scene.events.emit('preupdate');
  assert.deepEqual(za.rect, ra, '箱があるあいだ、下の組はもとの矩形');
  assert.deepEqual(zp.rect, { x: 92, y: 192, w: 104, h: 44 }, '箱の組は戦場の上でも広がる');
  zp.destroy();
  scene.events.emit('preupdate');
  assert.deepEqual(za.rect, { x: 92, y: 492, w: 66, h: 46 }, '箱が消えたら、また広げる');

  assert.equal(scene.events.count('preupdate'), 1);
  scene.events.emit('shutdown');
  assert.equal(scene.events.count('preupdate'), 0, 'shutdown で preupdate の受け手を外す');
  assert.equal(hitSnapshot(scene).buttons.length, 0);
  za.destroy();
  assert.equal(scene.events.count('preupdate'), 0, 'あとから来た destroy で名簿を作り直さない');

  // 作り直したシーン（restart）では、新しい名簿で動く
  const zc = zoneAt(ra);
  addHitButton(scene, ra, 'base', zc);
  assert.equal(scene.events.count('preupdate'), 1);
  scene.events.emit('preupdate');
  assert.deepEqual(zc.rect, { x: 92, y: 492, w: 66, h: 46 }, '前の障害物は残っていない');
});
