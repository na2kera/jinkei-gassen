// 秒数と刻みの定数（design §4.2、§4.3）。時間に関わる数字はここだけで決める。
// テストでは、開発サーバーに JINKEI_TEST_MODE=1 を渡したときだけ、部屋を作るときに短い値へ差し替えられる（index.ts）。
// 本番の設定（wrangler.jsonc）には JINKEI_TEST_MODE を入れないので、第三者は秒数を変えられない。

export type Timing = {
  /** 配置の制限時間（120秒） */
  setupMs: number;
  /** 公開から開戦まで（3秒） */
  revealMs: number;
  /** 部屋を作ってから、作った人がつなぐまでの予約（60秒） */
  reserveMs: number;
  /** 結果の段階で、切れてからこれだけたった席を空ける（60秒） */
  awayMs: number;
  /** 誰もつながっていない状態がこれだけ続いたら部屋を片付ける（10分） */
  cleanupMs: number;
  /** 戦闘中の見張りのアラームを、どれだけ先に入れるか（5秒） */
  watchdogMs: number;
  /** 1刻みの実時間（100ms。engine の DT = 0.1 秒に合わせる）。テストでは縮めて戦闘を早回しにする */
  tickMs: number;
  /** 1戦の刻みの上限（1800 = 3分） */
  maxTicks: number;
  /**
   * テスト専用：アラームを、計算した時刻よりこれだけ遅らせて入れる（本番は常に 0）。
   * 「期限は過ぎたがアラームはまだ鳴っていない」場面を作り、テストからアラームを2回呼ぶために使う。
   */
  testAlarmLagMs: number;
};

export const DEFAULT_TIMING: Readonly<Timing> = Object.freeze({
  setupMs: 120_000,
  revealMs: 3_000,
  reserveMs: 60_000,
  awayMs: 60_000,
  cleanupMs: 10 * 60_000,
  watchdogMs: 5_000,
  tickMs: 100,
  maxTicks: 1800,
  testAlarmLagMs: 0,
});

/** 1回の呼び出しで進める刻みの上限（design §4.2） */
export const MAX_STEPS_PER_CALL = 5;
/**
 * これより大きく遅れていたら、追いかけずに時計を合わせ直す刻みの数。
 * design §4.2 の「0.5 秒」は 5 刻みぶん。tickMs を縮めたテストでも同じ割合で効くよう、刻みの数で持つ。
 */
export const LAG_RESET_TICKS = 5;
/** 場面を送る間隔（2刻みごと = 毎秒5回、assumptions S10） */
export const SNAP_EVERY_TICKS = 2;
/** 戦闘の状態を保存する間隔（10刻みごと、design §4.2） */
export const SAVE_EVERY_TICKS = 10;

const TIMING_KEYS = Object.keys(DEFAULT_TIMING) as (keyof Timing)[];

/** 値の範囲。範囲外の差し替えは部屋の作成を断る */
function range(k: keyof Timing): [number, number] {
  switch (k) {
    case 'testAlarmLagMs':
      return [0, 3_600_000];
    case 'tickMs':
      // 5ms より短いと setInterval の精度を超え、早回しのテストが不安定になる
      return [5, 1_000];
    case 'maxTicks':
      return [10, 1800];
    default:
      return [10, 3_600_000];
  }
}

/** テスト用の差し替えを読む。知らないキー・整数でない値・範囲外は null。指定のないキーは既定値のまま */
export function parseTimingOverride(v: unknown): Timing | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Timing = { ...DEFAULT_TIMING };
  for (const [k, val] of Object.entries(v)) {
    if (!(TIMING_KEYS as string[]).includes(k)) return null;
    const [min, max] = range(k as keyof Timing);
    if (typeof val !== 'number' || !Number.isInteger(val) || val < min || val > max) return null;
    out[k as keyof Timing] = val;
  }
  return out;
}
