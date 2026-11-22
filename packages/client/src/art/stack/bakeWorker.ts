// 焼く仕事のワーカーの入口（design §14.3）。主スレッドから仕事の列をもらい、端から回す。
// 1 枚の絵ができるごとに、RGBA の ArrayBuffer を転送して（写しを作らずに）主スレッドへ送る。
// 仕事は小さく区切り、少し進めるたびに主スレッドからの頼み（先頭に入れる・捨てる）を受け取る。列が空になったら「終わった」と知らせる
// （主スレッドが terminate する。型はワーカーごと消える）。

import { BakeQueue, type BakedSheet, type QueueStats, type SetId, type TaskSpec } from './jobs.ts';

/** 主スレッド → ワーカー */
export type ToWorker =
  | { readonly t: 'start'; readonly tasks: readonly TaskSpec[]; readonly skip: readonly string[] }
  | { readonly t: 'front'; readonly tasks: readonly TaskSpec[] }
  | { readonly t: 'cancel'; readonly set: SetId };

/** ワーカー → 主スレッド */
export type FromWorker =
  | { readonly t: 'sheet'; readonly sheet: BakedSheet }
  | { readonly t: 'done'; readonly stats: QueueStats }
  | { readonly t: 'error'; readonly message: string };

/** 1 回に続けて回す時間（ミリ秒）。これを過ぎたら、頼みを受け取るためにいったん手を離す */
const SLICE_MS = 8;

// tsconfig は DOM の型だけを読むので、ワーカーの self の形をここで決める
const ctx = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

let queue: BakeQueue | null = null;
let scheduled = false;

function send(sheet: BakedSheet): void {
  ctx.postMessage({ t: 'sheet', sheet }, [sheet.rgba]);
}

function pump(): void {
  scheduled = false;
  const q = queue;
  if (!q) return;
  try {
    if (q.runFor(SLICE_MS)) {
      schedule();
      return;
    }
    q.dropModels();
    ctx.postMessage({ t: 'done', stats: q.stats });
  } catch (e) {
    ctx.postMessage({ t: 'error', message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(pump, 0);
}

ctx.onmessage = (e: MessageEvent<ToWorker>): void => {
  const m = e.data;
  if (m.t === 'start') {
    queue = new BakeQueue(send, { skip: m.skip });
    queue.push(m.tasks);
  } else if (m.t === 'front') {
    queue?.front(m.tasks);
  } else if (m.t === 'cancel') {
    queue?.cancel(m.set);
  }
  schedule();
};
