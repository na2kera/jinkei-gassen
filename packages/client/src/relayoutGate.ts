// 入力中は画面を組み直さない守り（design §12.4。Android でキーボードが画面の高さを縮めるとき用）。
// main.ts の relayout から使う。画面なしで確かめられるように、判定だけをここに分ける。

/** フォーカスのある要素が入力欄なら true（document.activeElement を渡す） */
export function isTyping(active: { tagName?: string } | null | undefined): boolean {
  return active?.tagName === 'INPUT';
}

export interface RelayoutGate {
  /** 組み直しの時が来たら呼ぶ。入力中なら走らせずに「あとでやる」印を立てる */
  attempt(): void;
  /** フォーカスが外れたら呼ぶ。印があれば、組み直しをもう一度頼む（1回だけ） */
  focusOut(): void;
}

/**
 * typing：いま入力中か。run：組み直す。retry：組み直しをもう一度頼む（main.ts では、少し待ってから attempt を呼ぶ relayout）。
 * focusOut ですぐ run しないのは、名前の欄からコードの欄へ移るときにも focusout が起きるため。待ったあとの attempt でもう一度見る。
 */
export function relayoutGate(typing: () => boolean, run: () => void, retry: () => void): RelayoutGate {
  let pending = false;
  return {
    attempt() {
      if (typing()) {
        pending = true;
        return;
      }
      pending = false;
      run();
    },
    focusOut() {
      if (!pending) return;
      pending = false;
      retry();
    },
  };
}
