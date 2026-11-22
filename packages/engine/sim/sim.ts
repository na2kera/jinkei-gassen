// 調整用の道具。
//   pnpm --filter @jinkei/engine sim battle <ひな形A> <ひな形B> [種] [何秒おき]
//   pnpm --filter @jinkei/engine sim matrix
//   pnpm --filter @jinkei/engine sim accept [a1 a2 ...]（合格条件の実測値）
// Node 22 の --experimental-strip-types で TS を直接動かす（新しいパッケージを足さないため）。

import { DT, STAGES, stageLineArmy, starsFor, summarize } from '../src/index.ts';
import { runStage, templateWins } from './stagelib.ts';
import { castleSetup, stdCastleSetup } from './terrain-scenes.ts';
import type { TemplateId } from '../src/index.ts';
import { a1, a2, a3, a4, a5, a8, a11, a13, a14 } from './scenes.ts';
import { reserveMain } from './reserve.ts';
import { starMain } from './star.ts';
import { formatMatrix, matchupSetup, matrixStats, renderBoard, runMatrix, runSetup, TEMPLATE_IDS, unitLine } from './lib.ts';

function usage(): void {
  console.log('使い方:');
  console.log('  sim battle <ひな形A> <ひな形B> [種=1] [何秒おき=3]');
  console.log('  sim matrix');
  console.log('  sim stage <面の id> [solution|line] [種] [何秒おき]');
  console.log('  sim stage-templates [面の id ...]   7つのひな形をそのまま置いたときの勝ち数');
  console.log('  sim castle [advance|flank|hunt] [種] [何秒おき] [--old]   城壁と門の戦場（T5。既定は標準の盤、--old で古い 12×16 の盤）');
  console.log('  sim accept [a1 a2 a3 a4 a5 a8 a11 a13 a14]   合格条件の実測値');
  console.log('  sim star <面の id ...> [--iters 400] [--screen 6] [--keep 4] [--rand 1] [--quiet]   星3つの配置を探す（テストには使わない）');
  console.log('  sim reserve [a|b|all] [--jobs 8] [--out .reserve-out]   遊軍の強さ（design §7.9 の R13）');
  console.log(`ひな形: ${TEMPLATE_IDS.join(', ')}`);
}

function isTemplate(s: string | undefined): s is TemplateId {
  return s !== undefined && (TEMPLATE_IDS as string[]).includes(s);
}

function battle(args: string[]): void {
  const [a, b, seedArg, everyArg] = args;
  if (!isTemplate(a) || !isTemplate(b)) {
    usage();
    process.exitCode = 1;
    return;
  }
  const seed = seedArg ? Number(seedArg) : 1;
  const every = Math.max(1, Math.round((everyArg ? Number(everyArg) : 3) / DT));
  console.log(`${a}（陣営0・下・大文字） 対 ${b}（陣営1・上・小文字）  種 ${seed}`);
  const show = (state: Parameters<typeof renderBoard>[0]): void => {
    console.log(`--- ${(state.tick * DT).toFixed(1)} 秒`);
    console.log(renderBoard(state));
    console.log(`  0: ${unitLine(state, 0)}`);
    console.log(`  1: ${unitLine(state, 1)}`);
  };
  const { state } = runSetup(matchupSetup(a, b, seed), {
    onTick: (s, ev) => {
      for (const e of ev) {
        if (e.type === 'rout' || e.type === 'destroyed' || e.type === 'impact' || e.type === 'end') {
          console.log(`  [${(e.tick * DT).toFixed(1)}s] ${JSON.stringify(e)}`);
        }
      }
      if (s.tick % every === 0 || s.outcome) show(s);
    },
  });
  const sum = summarize(state);
  console.log(`結果: 勝者 ${sum.winner} 理由 ${sum.reason} ${sum.seconds}秒 残り ${(sum.remaining[0] * 100).toFixed(0)}% 対 ${(sum.remaining[1] * 100).toFixed(0)}%`);
}

function accept(which: string[]): void {
  const want = (k: string): boolean => which.length === 0 || which.includes(k);
  const f = (x: number): string => x.toFixed(3);
  if (want('a1')) for (const t of ['line', 'crane', 'scale'] as const) console.log(`A1 ${t}: 陣営0の得点率 ${f(a1(t, false))} 逆順 ${f(a1(t, true))}`);
  if (want('a2')) { const fr = a2('front'); const fl = a2('flank'); console.log(`A2 正面 得点率 ${f(fr.score)} 残り ${f(fr.remaining)} 時間 ${f(fr.seconds)} / 側面 得点率 ${f(fl.score)} 残り ${f(fl.remaining)} 時間 ${f(fl.seconds)}`); }
  if (want('a3')) { const r = a3(); console.log(`A3 (a) 騎兵のほうが失った割合 ${f(r.frontCavWorse)}（騎兵 ${f(r.frontCavLoss)} 盾 ${f(r.frontShieldLoss)}） (b) 盾兵が消えた割合 ${f(r.rearShieldGone)}`); }
  if (want('a4')) { const r = a4(); console.log(`A4 (a) 歩兵の損害 最小 ${f(r.infLossMin)} 平均 ${f(r.infLossMean)} 弓兵の損害 ${f(r.archerTaken)} (b) 歩兵の勝ち ${f(r.infWins)}`); }
  if (want('a5')) { const r = a5(); console.log(`A5 騎兵あり 5秒以内に2部隊目 ${f(r.withCav)} 2部隊目までの中央値 騎兵あり ${f(r.medianWithCav)} 騎兵なし ${f(r.medianWithoutCav)}`); }
  if (want('a8')) for (const k of ['charge', 'brace', 'retreat'] as const) { const r = a8(k); console.log(`A8 ${k}: 出した ${f(r.withOrder)} 出さない ${f(r.without)}`); }
  if (want('a11')) { const r = a11(); console.log(`A11 守る側 ${f(r.defenderScore)} 守備どうし全部引き分け ${r.holdVsHoldAllDraw}`); }
  if (want('a13')) { const r = a13(); console.log(`A13 6対4 ${f(r.sixVsFour)} 4対4 ${f(r.fourVsFour)}`); }
  if (want('a14')) { const r = a14(); console.log(`A14 陣営0の勝ち ${r.side0Wins} そのうち hq ${f(r.hqShare)}`); }
}

function stage(args: string[]): void {
  const [id, which, seedArg, everyArg] = args;
  const st = STAGES.find((x) => x.id === id);
  if (!st || (which !== undefined && which !== 'solution' && which !== 'line')) {
    console.log('使い方: sim stage <面の id> [solution|line] [種=5000] [何秒おき=3]');
    console.log(`面: ${STAGES.map((x) => x.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const army = which === 'line' ? stageLineArmy(st) : st.solution;
  const seed = seedArg ? Number(seedArg) : 5000;
  const every = Math.max(1, Math.round((everyArg ? Number(everyArg) : 3) / DT));
  console.log(`${st.id} ${st.name}（${which ?? 'solution'}）  種 ${seed}  ヒント「${st.hint}」`);
  const show = (s: Parameters<typeof renderBoard>[0]): void => {
    console.log(`--- ${(s.tick * DT).toFixed(1)} 秒`);
    console.log(renderBoard(s));
    console.log(`  0: ${unitLine(s, 0)}`);
    console.log(`  1: ${unitLine(s, 1)}`);
  };
  const state = runStage(
    st,
    army,
    seed,
    (s) => {
      if (s.tick % every === 0 || s.outcome) show(s);
    },
    which === 'line' ? [] : (st.solutionOrders ?? []),
  );
  const sum = summarize(state);
  // 判定に使う割合と、星に使う割合（呼ばなかった遊軍を無傷として数える。design §7.5）を別々に出す
  console.log(`結果: 勝者 ${sum.winner} 理由 ${sum.reason} ${sum.seconds}秒 残り（判定） ${(sum.remaining[0] * 100).toFixed(0)}% 残り（星） ${(sum.remainingForStars[0] * 100).toFixed(0)}% 星 ${starsFor(sum, 0)}`);
}

function matrix(): void {
  const t0 = performance.now();
  const games = runMatrix();
  console.log(formatMatrix(matrixStats(games)));
  console.log(`（${((performance.now() - t0) / 1000).toFixed(1)} 秒）`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'battle') battle(rest);
else if (cmd === 'matrix') matrix();
else if (cmd === 'accept') accept(rest);
else if (cmd === 'stage') stage(rest);
else if (cmd === 'star') starMain(rest);
else if (cmd === 'reserve') {
  reserveMain(rest).catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
else if (cmd === 'castle') {
  // T5 の戦場（城壁と門）を、攻める側の方針を変えて流す：sim castle [advance|flank|hunt] [種] [何秒おき] [--old]
  // 既定は標準の盤（10×12、通り道つき）の城の場面。--old で古い盤（12×16）の城の場面（design §13.5）
  const old = rest.includes('--old');
  const args = rest.filter((a) => a !== '--old');
  const stance = (args[0] ?? 'advance') as 'advance' | 'flank' | 'hunt';
  const seed = args[1] ? Number(args[1]) : 1;
  const every = Math.max(1, Math.round((args[2] ? Number(args[2]) : 3) / DT));
  console.log(`城壁と門（${old ? '古い盤 12×16' : '標準の盤'}・攻める側は ${stance}）  種 ${seed}`);
  const { state } = runSetup((old ? castleSetup : stdCastleSetup)(stance, seed), {
    onTick: (st, ev) => {
      for (const e of ev) if (e.type === 'destroyed' && st.gate && e.unit === st.gate.id) console.log(`  [${(e.tick * DT).toFixed(1)}s] 門が破れた`);
      if (st.tick % every === 0 || st.outcome) {
        console.log(`--- ${(st.tick * DT).toFixed(1)} 秒`);
        console.log(renderBoard(st));
        console.log(`  0: ${unitLine(st, 0)}`);
        console.log(`  1: ${unitLine(st, 1)}`);
      }
    },
  });
  const sum = summarize(state);
  console.log(`結果: 勝者 ${sum.winner} 理由 ${sum.reason} ${sum.seconds}秒`);
}
else if (cmd === 'stage-templates') {
  for (const st of STAGES.filter((x) => rest.length === 0 || rest.includes(x.id))) {
    const rows = templateWins(st);
    console.log(`${st.id} ${st.name}: ${rows.map((r) => `${r.id} ${r.wins}`).join('  ')}（10個より多く勝つひな形 ${rows.filter((r) => r.wins > 10).length}）`);
  }
}
else usage();
