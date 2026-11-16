import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

// 開発サーバー1つで、画面と Worker（Durable Object を含む）を動かす。
// Worker の設定は packages/server/wrangler.jsonc を使い、静的ファイルの経路だけここで足す。
// （wrangler.jsonc に assets を書くと、directory のない assets を server 単体の `wrangler dev` が拒否し、
//   server のテストが起動しなくなるため。directory はこのプラグインがビルドの出力先を入れる。）
export default defineConfig({
  plugins: [
    cloudflare({
      configPath: '../server/wrangler.jsonc',
      config: {
        assets: {
          not_found_handling: 'single-page-application',
          run_worker_first: ['/api/*'],
        },
      },
    }),
  ],
  server: { port: 5174, strictPort: true },
});
