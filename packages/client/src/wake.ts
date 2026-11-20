// 画面を消さない（design §9.5、§9.9-7。Screen Wake Lock）。
// 1人用の戦闘と、対戦の部屋にいるあいだ、画面が暗くならないようにしたい。理由（'battle'・'pvp' など）の集まりで持ち、
// 空でないあいだだけ頼む（1人用と対戦が、互いの分を外さないように）。
// iOS の Safari は、指を離した直後（pointerup・touchend の中）の頼みしか受け付けない。そこで、
//   (1) document の pointerup・touchend（capture）、(2) holdWake、(3) 見える状態に戻ったとき、の3つの折に試す。
// 断られても何もしない（次に指を離したときにまた試す）。仕組みがない端末（古い iOS、http のページ）では何も起きない。
// Phaser は読まない（node のテストで、仕組みを差し替えて確かめるため）。

interface Sentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>;
}

const reasons = new Set<string>();
let sentinel: Sentinel | null = null;
let requesting = false;
let installed = false;
/** 外すのを次の小さな区切りまで待っているか（外してすぐ入れ直したとき、持ったままにするため） */
let releaseQueued = false;
const counts = { requests: 0, denied: 0 };

function api(): WakeLockApi | null {
  const nav = (globalThis as { navigator?: { wakeLock?: WakeLockApi } }).navigator;
  return nav && 'wakeLock' in nav && nav.wakeLock ? nav.wakeLock : null;
}

function held(): boolean {
  return sentinel !== null && !sentinel.released;
}

/** 理由があり、仕組みがあり、いま持っておらず、頼んでいる途中でもないときだけ頼む */
function tryRequest(): void {
  if (reasons.size === 0 || requesting || held()) return;
  const wl = api();
  if (!wl) return;
  // 印は request を呼ぶ前に立てる（pointerup と touchend が続けて来ても、頼むのは1回）
  requesting = true;
  counts.requests++;
  let p: Promise<Sentinel>;
  try {
    p = wl.request('screen');
  } catch {
    requesting = false;
    counts.denied++;
    return;
  }
  p.then(
    (s) => {
      requesting = false;
      // 頼んでいる途中に理由がなくなったら、届いた見張りをすぐ放す
      if (reasons.size === 0) {
        s.release().catch(() => undefined);
        return;
      }
      sentinel = s;
      // 画面を閉じたときなどに放された。合図を出した見張りが、いま持っているものと同じときだけ消す
      // （古い見張りの合図で、新しい見張りを「持っていない」にしないため）
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
      });
    },
    () => {
      // 断られた（Safari で、指を離した直後でないときなど）。次に指を離したときにまた試す
      requesting = false;
      counts.denied++;
    },
  );
}

/** reason のために、画面を消さないようにしたい */
export function holdWake(reason: string): void {
  reasons.add(reason);
  tryRequest();
}

/** reason の分を外す。理由が空になったら、持っている見張りを放す */
export function releaseWake(reason: string): void {
  if (!reasons.delete(reason) || reasons.size > 0 || releaseQueued) return;
  // 同じ流れの中で入れ直されたら放さない（戦闘の画面を作り直すときなど。放すと、押した流れの外で頼み直すことになり断られる）
  releaseQueued = true;
  void Promise.resolve().then(() => {
    releaseQueued = false;
    if (reasons.size > 0) return;
    const s = sentinel;
    sentinel = null;
    s?.release().catch(() => undefined);
  });
}

/** main.ts から1回。2度呼んでも1度ぶんだけ働く */
export function installWake(): void {
  if (installed) return;
  installed = true;
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return;
  // passive で、preventDefault・stopPropagation は呼ばない（ほかの受け手の邪魔をしない）
  for (const type of ['pointerup', 'touchend'] as const) {
    doc.addEventListener(type, tryRequest, { capture: true, passive: true });
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') tryRequest();
  });
}

export interface WakeState {
  reasons: string[];
  supported: boolean;
  held: boolean;
  requests: number;
  denied: number;
}

/** 開発用の口（__jg.wake）とテストのための、いまの様子 */
export function wakeState(): WakeState {
  return { reasons: [...reasons], supported: api() !== null, held: held(), requests: counts.requests, denied: counts.denied };
}
