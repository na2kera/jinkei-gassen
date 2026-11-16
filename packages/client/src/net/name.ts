// 対戦で使う名前の検査。サーバーと同じ決まりにして、つなぐ前に入力の誤りを知らせる
// （違うと、サーバーに断られて「つながりません」と出てしまうため）。
// 写した元：packages/server/src/validate.ts の MAX_NAME_LENGTH・BAD_NAME_CHAR・normalizeName。
// client は server のファイルを実行時に読み込まないので、同じ中身をここに置く。決まりが変わったら両方を直す。

/** 名前の最大文字数（コードポイント） */
export const MAX_NAME_LENGTH = 12;

// 制御文字・書式文字・行区切り・段落区切り・私用領域・サロゲートの片割れを拒否する（相手の画面に出るため）
const BAD_NAME_CHAR = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u;

/** 名前を整える。前後の空白を除き NFC にする。不正なら null */
export function normalizeName(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 64) return null;
  const s = v.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const len = [...s].length;
  if (len < 1 || len > MAX_NAME_LENGTH) return null;
  if (BAD_NAME_CHAR.test(s)) return null;
  return s;
}
