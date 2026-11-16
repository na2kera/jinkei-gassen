// 仮の絵。ドットの並びを書いたデータから、起動時にテクスチャを作る（design §5.3：画像ファイルを置かない）。
// 段階2でドット絵に差し替えるときは、この並びと UnitSprite の組み立てを直す。

import type { Kind, Side } from '@jinkei/engine';
import type Phaser from 'phaser';
import { SIDE_COLOR } from './palette.ts';

/**
 * 兵1人の形。上が部隊の前。'a' は陣営の色、'b' は明るい色（前を示す印）、'.' は透明。
 * 4×4 の四角は回しても同じに見えるので、前の印で向きが分かるようにしている。
 * 兵種は形で見分ける：歩兵は前に兜、盾兵は前一面に盾、弓兵は細い体に弓の両端、騎兵は縦に長い、本陣は四隅に印。
 */
const SOLDIER: Record<Kind, string[]> = {
  infantry: ['.bb.', 'aaaa', 'aaaa', '.aa.'],
  shield: ['bbbb', 'aaaa', 'aaaa', 'aaaa'],
  archer: ['b..b', 'baab', '.aa.', '.aa.'],
  cavalry: ['.bb.', 'aaaa', 'aaaa', 'aaaa', 'aaaa', '.aa.'],
  hq: ['baab', 'aaaa', 'aaaa', 'baab'],
};

/** 4方向（0: 上、1: 右、2: 下、3: 左）。兵の絵は回さず、向きごとに作っておく（回すとドットが崩れるため） */
export type Dir4 = 0 | 1 | 2 | 3;

/** team は 0 が見ている人の自軍、1 が敵軍（palette の SIDE_COLOR と同じ） */
export function soldierKey(team: Side, kind: Kind, dir: Dir4): string {
  return `soldier-${team}-${kind}-${dir}`;
}

/** 並びを時計回りに dir × 90° 回す */
function rotate(rows: string[], dir: Dir4): string[] {
  let r = rows;
  for (let i = 0; i < dir; i++) {
    const h = r.length;
    const w = r[0]?.length ?? 0;
    const next: string[] = [];
    for (let x = 0; x < w; x++) {
      let line = '';
      for (let y = h - 1; y >= 0; y--) line += r[y]?.[x] ?? '.';
      next.push(line);
    }
    r = next;
  }
  return r;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function buildTextures(scene: Phaser.Scene): void {
  const kinds = Object.keys(SOLDIER) as Kind[];
  for (const side of [0, 1] as const) {
    const colors = { a: hex(SIDE_COLOR[side].main), b: hex(SIDE_COLOR[side].light) };
    for (const kind of kinds) {
      for (const dir of [0, 1, 2, 3] as const) {
        const key = soldierKey(side, kind, dir);
        if (scene.textures.exists(key)) continue;
        const rows = rotate(SOLDIER[kind], dir);
        const h = rows.length;
        const w = rows[0]?.length ?? 0;
        const tex = scene.textures.createCanvas(key, w, h);
        if (!tex) continue;
        const ctx = tex.getContext();
        rows.forEach((line, y) => {
          [...line].forEach((ch, x) => {
            if (ch === 'a' || ch === 'b') {
              ctx.fillStyle = colors[ch];
              ctx.fillRect(x, y, 1, 1);
            }
          });
        });
        tex.refresh();
      }
    }
  }
}

/** 兵1人の絵の大きさ（向き dir のとき） */
export function soldierSize(kind: Kind, dir: Dir4): { w: number; h: number } {
  const rows = SOLDIER[kind];
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  return dir % 2 === 0 ? { w, h } : { w: h, h: w };
}
