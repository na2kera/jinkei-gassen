// 小さな場面を文字の盤面で見る（調整用）。node --experimental-strip-types sim/view-scene.ts <json の setup ファイル> [何秒おき]
import { readFileSync } from 'node:fs';
import { DT, summarize, type BattleSetup } from '../src/index.ts';
import { renderBoard, runSetup, unitLine } from './lib.ts';

const [file, everyArg, untilArg] = process.argv.slice(2);
const setup = JSON.parse(readFileSync(file as string, 'utf8')) as BattleSetup;
const every = Math.max(1, Math.round(Number(everyArg ?? '2') / DT));
const until = Number(untilArg ?? '1800');
const { state } = runSetup(setup, {
  stopWhen: (s) => s.tick >= until,
  onTick: (s, ev) => {
    for (const e of ev) if (e.type !== 'order') console.log(`  [${(e.tick * DT).toFixed(1)}s] ${JSON.stringify(e)}`);
    if (s.tick % every === 0 || s.outcome) {
      console.log(`--- ${(s.tick * DT).toFixed(1)} 秒`);
      console.log(renderBoard(s));
      console.log(`  0: ${unitLine(s, 0)}`);
      console.log(`  1: ${unitLine(s, 1)}`);
    }
  },
});
const sum = summarize(state);
console.log(`結果: ${sum.winner} ${sum.reason} ${sum.seconds}s`);
for (const u of state.units) console.log(u.id, u.side, u.kind, 'dealt', u.stats.dealt.toFixed(1), 'flank', u.stats.flankDealt.toFixed(1));
