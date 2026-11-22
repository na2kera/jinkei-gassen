// 揃いの頼みの世代と、届いた絵を受け付けるかの判断（design §14.3）。Phaser を読まない（画面なしで確かめるため）。
// 揃いを捨てる（release）たびに、その揃いの世代を 1 つ進める。頼んだ絵には頼んだときの世代を付けて焼かせ、
// 届いた絵の世代が、いまの世代と違えば捨てる（捨てる前にワーカーが送っていた古い応答を、新しい頼みの応答として取り込まないため）。
// 同じ鍵の絵は、もうある・取り込み待ちなら重ねて受け付けない（取り込みを何度呼んでも同じ結果にするため）。

import type { BakedSheet, SetId, SheetSpec } from './jobs.ts';

export class SheetBook {
  private readonly gens = new Map<SetId, number>();

  /** いまの世代 */
  gen(set: SetId): number {
    return this.gens.get(set) ?? 0;
  }

  /** 頼む絵に、いまの世代を付ける */
  stamp(specs: readonly SheetSpec[]): SheetSpec[] {
    return specs.map((s) => ({ ...s, gen: this.gen(s.set) }));
  }

  /** 揃いを捨てた：世代を進める（それより前に頼んだ絵は、届いても受け付けない） */
  release(set: SetId): void {
    this.gens.set(set, this.gen(set) + 1);
  }

  /**
   * 届いた絵を受け付けるか。wanted は要る絵の鍵、ready はもうある鍵、pending は取り込み待ちの鍵。
   * 世代が違う・要らない・もうある・取り込み待ち、のどれかなら受け付けない
   */
  accepts(sheet: Pick<BakedSheet, 'key' | 'set' | 'gen'>, wanted: (key: string) => boolean, ready: (key: string) => boolean, pending: (key: string) => boolean): boolean {
    if ((sheet.gen ?? 0) !== this.gen(sheet.set)) return false;
    if (!wanted(sheet.key)) return false;
    return !ready(sheet.key) && !pending(sheet.key);
  }
}
