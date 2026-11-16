// T10 平地の戦いは変わらない（design §3.8）。
// test/fixtures/t10-baseline.json は、地形を入れる前のコミット（4b3a90b）で sim/baseline.ts が書き出した値。作り直さない。
// 記録した設定と号令で流し直し、50刻みごとのハッシュ（毎刻みの出来事と、その時点の状態）と最後の状態が一致することを見る。
// 状態は、記録したときの項目だけに絞ってから比べる（地形のために足した項目を取り除く）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { playT10, type T10File } from '../../sim/t10.ts';

const file = JSON.parse(readFileSync(new URL('../fixtures/t10-baseline.json', import.meta.url).pathname, 'utf8')) as T10File;

describe('T10 平地の戦いは変わらない', () => {
  it('記録は20戦', () => {
    expect(file.battles.length).toBe(20);
  });
  for (const b of file.battles) {
    it(b.name, () => {
      const got = playT10({ name: b.name, setup: b.setup, orders: b.orders }, file.stateKeys, file.unitKeys);
      const firstDiff = got.checkpoints.findIndex((h, i) => h !== b.checkpoints[i]);
      expect(firstDiff, `刻み ${firstDiff * 50} あたりで食い違う`).toBe(-1);
      expect(got.ticks).toBe(b.ticks);
      expect(got.checkpoints).toEqual(b.checkpoints);
      expect(got.final).toEqual(b.final);
    }, 60_000);
  }
});
