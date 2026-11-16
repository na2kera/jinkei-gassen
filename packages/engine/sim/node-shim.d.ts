// sim とテストで使う Node の機能の、最小の型宣言。
// @types/node を足さない（新しいパッケージを足さない決まり）ため、使う分だけをここに書く。

declare const process: {
  argv: string[];
  exitCode: number | undefined;
};

declare const console: {
  log(...args: unknown[]): void;
};

declare const performance: {
  now(): number;
};

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
}

interface ImportMeta {
  url: string;
}

declare class URL {
  constructor(url: string, base?: string);
  pathname: string;
}
