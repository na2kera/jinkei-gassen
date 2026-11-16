// 効果音（WebAudio で合成。音声ファイルは置かない。design §5.3）。
// 手本（走れだいごくん）と同じく、最初の操作で AudioContext を作って resume し、iOS Safari でも鳴るようにする。
// どの関数も例外を外に出さない。音が鳴らなくても遊べるようにするため。

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

/** 鳴らす関数が呼ばれた回数と、実際に鳴らした回数（開発用の口で確かめるため。耳では確かめられないので） */
export const sfxCounts: Record<string, { called: number; played: number }> = {};

function count(name: string, played: boolean): void {
  const c = (sfxCounts[name] ??= { called: 0, played: 0 });
  c.called++;
  if (played) c.played++;
}

function getCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** ユーザー操作の中で呼ぶ。AudioContext を作り、止まっていれば resume する。何度呼んでも安全 */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      const Ctor = getCtor();
      if (!Ctor) return;
      ctx = new Ctor();
    }
    // iOS の通話の割り込みのあとなどは "interrupted" になる（型に無いので文字列で比べる）
    const state: string = ctx.state;
    if (state !== 'running' && state !== 'closed') ctx.resume().catch(() => undefined);
  } catch {
    // 音が使えない環境では黙って無音にする
  }
}

let installed = false;

/**
 * どの画面でも音の解禁を試みるリスナーを登録する。起動時に1回呼ぶ。
 * WebKit では touch の pointerdown が利用者の操作として扱われないので、pointerup と touchend でも呼ぶ。
 */
export function installAudioUnlock(): void {
  if (installed) return;
  installed = true;
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const) {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx) unlockAudio();
  });
}

export function audioState(): string {
  return ctx ? ctx.state : 'none';
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
}

function ready(): AudioContext | null {
  if (muted || !ctx || ctx.state !== 'running') return null;
  return ctx;
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noise) return noise;
  const len = Math.floor(ac.sampleRate * 0.5);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

interface Tone {
  from: number;
  to: number;
  delay: number;
  duration: number;
  type: OscillatorType;
  volume: number;
}

function tones(ac: AudioContext, steps: Tone[]): void {
  const now = ac.currentTime;
  for (const s of steps) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const start = now + s.delay;
    const end = start + s.duration;
    osc.type = s.type;
    osc.frequency.setValueAtTime(s.from, start);
    osc.frequency.exponentialRampToValueAtTime(s.to, end);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(s.volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

interface Noise {
  delay: number;
  duration: number;
  /** 帯域フィルターの中心（Hz） */
  freq: number;
  q: number;
  volume: number;
}

function noises(ac: AudioContext, steps: Noise[]): void {
  const now = ac.currentTime;
  for (const s of steps) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac);
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = s.freq;
    filter.Q.value = s.q;
    const gain = ac.createGain();
    const start = now + s.delay;
    const end = start + s.duration;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(s.volume, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(start, Math.random() * 0.3);
    src.stop(end + 0.02);
  }
}

/** 同じ音が短い間に重なって鳴りっぱなしにならないよう、前に鳴らした時刻を覚えて間引く */
const lastPlayed: Record<string, number> = {};

function play(name: string, minGapMs: number, body: (ac: AudioContext) => void): void {
  try {
    const ac = ready();
    const nowMs = performance.now();
    const throttled = minGapMs > 0 && nowMs - (lastPlayed[name] ?? -Infinity) < minGapMs;
    if (!ac || throttled) {
      count(name, false);
      return;
    }
    lastPlayed[name] = nowMs;
    body(ac);
    count(name, true);
  } catch {
    count(name, false);
  }
}

/** 部隊を置く：木を軽くたたく音 */
export function playPlace(): void {
  play('place', 40, (ac) => tones(ac, [{ from: 520, to: 360, delay: 0, duration: 0.07, type: 'square', volume: 0.06 }]));
}

/** 部隊を外す：低く下がる音 */
export function playRemove(): void {
  play('remove', 40, (ac) => tones(ac, [{ from: 300, to: 160, delay: 0, duration: 0.09, type: 'square', volume: 0.05 }]));
}

/** 方針の切り替え：短い2音 */
export function playStance(): void {
  play('stance', 40, (ac) =>
    tones(ac, [
      { from: 660, to: 660, delay: 0, duration: 0.05, type: 'square', volume: 0.05 },
      { from: 880, to: 880, delay: 0.06, duration: 0.05, type: 'square', volume: 0.05 },
    ]),
  );
}

/** 太鼓1打：低い音の急な下がりと、打面のこすれ */
function drumHit(ac: AudioContext, delay: number, volume: number): void {
  tones(ac, [{ from: 140, to: 55, delay, duration: 0.28, type: 'sine', volume }]);
  noises(ac, [{ delay, duration: 0.06, freq: 900, q: 0.8, volume: volume * 0.25 }]);
}

/** 開戦：太鼓を3つ */
export function playStart(): void {
  play('start', 200, (ac) => {
    drumHit(ac, 0, 0.5);
    drumHit(ac, 0.22, 0.5);
    drumHit(ac, 0.44, 0.6);
  });
}

/** 号令の太鼓。敵の号令は少し小さく、遠くに聞こえるようにする */
export function playOrderDrum(enemy: boolean): void {
  play('order', 150, (ac) => {
    const v = enemy ? 0.3 : 0.5;
    drumHit(ac, 0, v);
    drumHit(ac, 0.16, v);
  });
}

/** ぶつかる音：金属の短いこすれ。戦っている場所が多くても鳴りっぱなしにならないよう強く間引く */
export function playClash(): void {
  play('clash', 180, (ac) => noises(ac, [{ delay: 0, duration: 0.05, freq: 3200, q: 3, volume: 0.05 }]));
}

/** 騎兵の突入：重い衝撃音 */
export function playImpact(): void {
  play('impact', 120, (ac) => {
    noises(ac, [{ delay: 0, duration: 0.18, freq: 220, q: 0.7, volume: 0.35 }]);
    tones(ac, [{ from: 90, to: 45, delay: 0, duration: 0.18, type: 'sine', volume: 0.25 }]);
  });
}

/** 矢：高い風切り音 */
export function playArrow(): void {
  play('arrow', 220, (ac) => noises(ac, [{ delay: 0, duration: 0.12, freq: 5200, q: 2, volume: 0.04 }]));
}

/** 敗走：下がっていく3音 */
export function playRout(): void {
  play('rout', 250, (ac) =>
    tones(ac, [
      { from: 392, to: 370, delay: 0, duration: 0.1, type: 'triangle', volume: 0.08 },
      { from: 330, to: 311, delay: 0.1, duration: 0.1, type: 'triangle', volume: 0.08 },
      { from: 262, to: 196, delay: 0.2, duration: 0.2, type: 'triangle', volume: 0.08 },
    ]),
  );
}

/** 勝ち：上がっていく音と太鼓 */
export function playWin(): void {
  play('win', 0, (ac) => {
    drumHit(ac, 0, 0.5);
    tones(ac, [
      { from: 523, to: 523, delay: 0.1, duration: 0.14, type: 'square', volume: 0.07 },
      { from: 659, to: 659, delay: 0.26, duration: 0.14, type: 'square', volume: 0.07 },
      { from: 784, to: 784, delay: 0.42, duration: 0.14, type: 'square', volume: 0.07 },
      { from: 1047, to: 1047, delay: 0.58, duration: 0.4, type: 'square', volume: 0.07 },
    ]);
  });
}

/** 負け：下がっていく低い音 */
export function playLose(): void {
  play('lose', 0, (ac) =>
    tones(ac, [
      { from: 392, to: 392, delay: 0, duration: 0.25, type: 'triangle', volume: 0.1 },
      { from: 330, to: 330, delay: 0.28, duration: 0.25, type: 'triangle', volume: 0.1 },
      { from: 262, to: 196, delay: 0.56, duration: 0.6, type: 'triangle', volume: 0.1 },
    ]),
  );
}

/** 引き分け：同じ高さの2音 */
export function playDraw(): void {
  play('draw', 0, (ac) =>
    tones(ac, [
      { from: 392, to: 392, delay: 0, duration: 0.2, type: 'triangle', volume: 0.08 },
      { from: 392, to: 392, delay: 0.26, duration: 0.3, type: 'triangle', volume: 0.08 },
    ]),
  );
}
