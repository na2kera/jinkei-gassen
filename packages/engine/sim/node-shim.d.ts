// sim とテストで使う Node の機能の、最小の型宣言。
// @types/node を足さない（新しいパッケージを足さない決まり）ため、使う分だけをここに書く。

declare const process: {
  argv: string[];
  exitCode: number | undefined;
  /** 子プロセスを同じ node と同じ起動の引数で立てるため（sim reserve） */
  execPath: string;
  execArgv: string[];
};

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
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

declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module 'node:child_process' {
  export function spawn(command: string, args: string[], options?: { stdio?: 'inherit' }): { on(event: 'exit', listener: (code: number | null) => void): void };
}
