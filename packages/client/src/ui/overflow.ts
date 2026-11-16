// 開発時だけ：ボタンや文字の箱で、文字が枠の内側からはみ出した所を記録する（開発用の口 __jg.overflows で見る）。
// 画面の大きさと向きで置き方が変わるので、目で探すより、作った所で幅を比べて残すほうが漏れがない。

export interface Overflow {
  scene: string;
  text: string;
  /** 文字の幅・高さ（px） */
  w: number;
  h: number;
  /** 枠の内側の幅・高さ（px） */
  maxW: number;
  maxH: number;
}

export const overflows: Overflow[] = [];

/** 枠の線（2px）と、文字の左右に最低限ほしい余白（2px） */
const INSET = 4;

/** 文字の幅が枠の内側に収まっているかを比べ、はみ出していたら記録する（本番のビルドでは何もしない） */
export function checkFit(scene: string, text: string, w: number, h: number, boxW: number, boxH: number): void {
  if (!import.meta.env.DEV || text === '') return;
  const maxW = boxW - INSET * 2;
  const maxH = boxH - 4;
  if (w <= maxW && h <= maxH) return;
  if (overflows.some((o) => o.scene === scene && o.text === text && o.maxW === maxW)) return;
  overflows.push({ scene, text, w: Math.round(w), h: Math.round(h), maxW, maxH });
  if (overflows.length > 200) overflows.shift();
}
