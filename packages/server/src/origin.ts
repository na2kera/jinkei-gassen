// Origin の確認（design §4.1。超富豪の server と同じ考え方）。Worker の実行環境に依存しない関数だけを置く（単体テストのため）。

/**
 * - Origin が付いていれば、scheme・ホスト・ポートを含めて自分のサイト（リクエストの origin）と一致するときだけ通す。
 *   よそのサイトのページが、利用者のブラウザを使って部屋を作ったり入ったりするのを防ぐ。
 * - Origin が付いていなければ通す（ブラウザ以外は付けないことがあり、その場合は別のサイトのページから送られたものではない）。
 */
export function originAllowed(origin: string | null, requestUrl: URL): boolean {
  if (origin === null) return true;
  try {
    return new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
}
