// T10 の記録を書き出す道具。最初は地形を入れる前のコミット（4b3a90b）で動かし、2026-11-17 に本陣狙いの直しのために作り直した
// （3つめの引数に、作り直した理由を書く）。平地の戦いを変える直しをしない限り、動かさない。
//   node --experimental-strip-types --no-warnings sim/baseline.ts <コミット> <日付> [作り直した理由]
// 平地の決まりを直して、決まった戦いだけが変わるときは、次の道を使う（design §3.6.6「記録の作り直し方」）。
// いまの記録の setup・orders・stateKeys・unitKeys をそのまま使い、名前を挙げた戦いの checkpoints・ticks・final だけを流し直して書き換える。
// STAGES やひな形から設定を作り直さないので、面を変えたあとでも、記録の中の「面 1-2 の見本」などの設定は変わらない。
//   node --experimental-strip-types --no-warnings sim/baseline.ts --redo <新しい note> <戦いの名前> [<戦いの名前> ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { createBattle, STAGES, stageSetupWith } from '../src/index.ts';
import { matchupSetup, SEEDS_10, TEMPLATE_IDS } from './lib.ts';
import { a8Order, a8Setup, A8_ORDER_TICK, A11_DEFENSE, A11_OFFENSE, allHold } from './scenes.ts';
import { applyTemplate, plainField } from '../src/index.ts';
import { playT10, type T10Battle, type T10File } from './t10.ts';

const FIXTURE = 'test/fixtures/t10-baseline.json';

function redo(): void {
  const [note, ...names] = process.argv.slice(3);
  if (!note || names.length === 0) throw new Error('使い方: sim/baseline.ts --redo <新しい note> <戦いの名前> ...');
  const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as T10File;
  for (const name of names) if (!file.battles.some((b) => b.name === name)) throw new Error(`記録にない戦い: ${name}`);
  const out: T10File = {
    ...file,
    note,
    battles: file.battles.map((b) => (names.includes(b.name) ? { name: b.name, setup: b.setup, orders: b.orders, ...playT10(b, file.stateKeys, file.unitKeys) } : b)),
  };
  writeFileSync(FIXTURE, JSON.stringify(out));
  console.log(`${names.length} 戦を流し直した（${names.join('、')}）`);
}

function full(): void {
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
writeFileSync(FIXTURE, JSON.stringify(out));
console.log(`${out.battles.length} 戦を書き出した（${out.battles.map((b) => b.ticks).join(', ')} 刻み）`);
}

if (process.argv[2] === '--redo') redo();
else full();
