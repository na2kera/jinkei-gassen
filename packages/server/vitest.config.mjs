import { defineConfig } from 'vitest/config';

// 通しのテスト。各ファイルが自分の開発サーバー（wrangler dev）を起動するので、ファイルは1つずつ順に実行する。
export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 90_000,
  },
});
