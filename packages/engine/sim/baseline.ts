// T10 の記録を書き出す道具。地形を入れる前のコミットで、一度だけ動かす（作業の間は作り直さない）。
//   node --experimental-strip-types --no-warnings sim/baseline.ts <コミット> <日付> [作り直した理由]
import { writeFileSync } from 'node:fs';
import { createBattle, STAGES, stageSetupWith } from '../src/index.ts';
import { matchupSetup, SEEDS_10, TEMPLATE_IDS } from './lib.ts';
import { a8Order, a8Setup, A8_ORDER_TICK, A11_DEFENSE, A11_OFFENSE, allHold } from './scenes.ts';
import { applyTemplate, plainField } from '../src/index.ts';
import { playT10, type T10Battle, type T10File } from './t10.ts';

const commit = process.argv[2] ?? '(不明)';
const battles: T10Battle[] = [];
// 総当たりから10戦：ひな形の組を順にずらして選び、種も順に使う
const pairs: [string, string][] = [];
for (const a of TEMPLATE_IDS) for (const b of TEMPLATE_IDS) if (a !== b) pairs.push([a, b]);
for (let i = 0; i < 10; i++) {
  const [a, b] = pairs[(i * 4) % pairs.length]!;
  battles.push({ name: `総当たり ${a} 対 ${b} 種${SEEDS_10[i]}`, setup: matchupSetup(a as never, b as never, SEEDS_10[i]!), orders: {} });
}
// 第1章の5面の見本（見本の号令つき）
for (const st of STAGES.filter((s) => s.chapter === 1)) {
  battles.push({ name: `面 ${st.id} の見本`, setup: stageSetupWith(st, st.solution, 5000, st.solutionOrders ?? []), orders: {} });
}
// A8 の3場面（号令を出す場合）
for (const k of ['charge', 'brace', 'retreat'] as const) {
  battles.push({ name: `A8 ${k}`, setup: a8Setup(k, 1000), orders: { [String(A8_ORDER_TICK[k])]: [a8Order(k)] } });
}
// A11 と A14 から1戦ずつ
const f = plainField();
battles.push({
  name: 'A11 守る側が陣営0',
  setup: { field: plainField(), armies: [allHold(applyTemplate('line', A11_DEFENSE, f.zones[0], 0)), applyTemplate('line', A11_OFFENSE, f.zones[1], 1)], seed: 1000, maxTicks: 1800, timeout: 'compare' },
  orders: {},
});
battles.push({
  name: 'A14 鋒矢 対 横陣（全部守備）',
  setup: { field: plainField(), armies: [applyTemplate('arrow', { hq: 1, infantry: 5, shield: 3, cavalry: 3, archer: 3 }, f.zones[0], 0), allHold(applyTemplate('line', { hq: 1, infantry: 5, shield: 3, cavalry: 3, archer: 3 }, f.zones[1], 1))], seed: 1000, maxTicks: 1800, timeout: 'compare' },
  orders: {},
});

const probe = createBattle(battles[0]!.setup);
if (!probe.ok) throw new Error();
const stateKeys = Object.keys(probe.value).sort();
const unitKeys = Object.keys(probe.value.units[0]!).sort();
const out: T10File = {
  note: process.argv[4]
    ? `T10 の記録。${process.argv[3] ?? ""} コミット ${commit} の engine に段階4の変更を足したもので、sim/baseline.ts が作り直した。${process.argv[4]}`
    : `T10 の記録。${process.argv[3] ?? ""} コミット ${commit} の engine で、sim/baseline.ts が作った。地形を入れる前の値で、段階4の作業の間は作り直さない。`,
  stateKeys,
  unitKeys,
  battles: battles.map((b) => ({ name: b.name, setup: JSON.parse(JSON.stringify(b.setup)), orders: b.orders, ...playT10(b, stateKeys, unitKeys) })),
};
writeFileSync('test/fixtures/t10-baseline.json', JSON.stringify(out));
console.log(`${out.battles.length} 戦を書き出した（${out.battles.map((b) => b.ticks).join(', ')} 刻み）`);
