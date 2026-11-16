// 対戦の出来事の重複を除く（design §4.3）。RemoteBattleSource から使う、画面にも通信にも触れない純粋な仕組み。
//
// サーバーが作り直されると、保存した刻みから続けるので tick が少し戻り、同じ出来事がもう一度届く。
// 通し番号（evBase）だけで見分けると、やり直しの区間に新しい号令が入ったとき番号がずれ、
// 新しい号令を捨てて、後ろにずれた出来事をもう一度演出してしまう。
// そこで「刻みと中身が同じ出来事を、何回渡したか」で見分ける：
//   - 刻みが戻った snap が届いたら、そこから「やり直しの区間」とし、区間の中で届いた回数を数え直す
//   - 刻みと中身ごとに、区間の中で届いた回数が、すでに渡した回数を超えた分だけを渡す
// こうすると、同じ出来事は二重に演出されず、やり直しの区間に入った新しい号令は渡される。
// 同じ刻み・同じ中身の号令が2つある場合も、回数で正しく扱える。
//
// engine の出来事の tick は「その step を始めたときの刻み」で、snap の tick は「終わった step の回数」なので、
// ふだんの snap の出来事は、どれも前の snap の tick 以上になる。それより小さい出来事が来たら、刻みが戻ったと分かる。

import type { BattleEvent } from '@jinkei/engine';

export interface EventDedup {
  /** 前に届いた snap の tick（まだなければ -1） */
  prevTick: number;
  /** 刻みと中身ごとの、渡した回数 */
  delivered: Map<string, number>;
  /** 刻みと中身ごとの、いまの区間で届いた回数（刻みが戻るたびに数え直す） */
  seen: Map<string, number>;
}

export function createEventDedup(): EventDedup {
  return { prevTick: -1, delivered: new Map(), seen: new Map() };
}

/** 刻みと中身を表す鍵。出来事はサーバーが同じ形で詰めて送るので、JSON にすれば同じ出来事は同じ鍵になる */
function keyOf(e: BattleEvent): string {
  return JSON.stringify(e);
}

/** snap 1つぶんの出来事のうち、まだ渡していないものを返す（state を進める） */
export function acceptEvents(state: EventDedup, tick: number, events: readonly BattleEvent[]): BattleEvent[] {
  const prev = state.prevTick;
  const rewound = prev >= 0 && (tick < prev || events.some((e) => e.tick < prev));
  // 刻みが戻った：ここから、やり直しの区間として届いた回数を数え直す
  if (rewound) state.seen.clear();
  const out: BattleEvent[] = [];
  for (const e of events) {
    const k = keyOf(e);
    const seen = (state.seen.get(k) ?? 0) + 1;
    state.seen.set(k, seen);
    const given = state.delivered.get(k) ?? 0;
    if (seen <= given) continue;
    state.delivered.set(k, given + 1);
    out.push(e);
  }
  state.prevTick = tick;
  return out;
}

/** 開発用：snap の並び（tick と出来事）を流して、渡された出来事の列を返す */
export function runEventDedup(snaps: readonly { tick: number; events: readonly BattleEvent[] }[]): BattleEvent[] {
  const st = createEventDedup();
  return snaps.flatMap((s) => acceptEvents(st, s.tick, s.events));
}
