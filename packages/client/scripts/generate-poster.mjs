// 印刷用のポスター（A4 横、300dpi 相当の 3508×2480 PNG と、同じ見た目の A4 横の PDF 1ページ）を作る。
// Node 22.13.1。依存追加なし。OGP（generate-ogp.mjs）と同じく、小さなサーバーがゲームの描画関数（型だけを除いた .ts）と
// 描画スクリプトを配り、ブラウザの canvas で描いた PNG を書き戻す。ブラウザは、ヘッドレスの Chrome をこのスクリプトが起こす。
//
//   node packages/client/scripts/generate-poster.mjs
//
// 出力：docs/poster/poster.png、docs/poster/poster.pdf
// Chrome の場所は環境変数 CHROME で変えられる（既定は macOS の場所）。ポートは 5193。
// Chrome は一時フォルダの --user-data-dir で起こし、ふだん使いの Chrome には触らない。終わったら止めて、一時フォルダを消す。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const PORT = 5193;
const W = 3508;
const H = 2480;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const client = new URL('../', import.meta.url);
const root = new URL('../../', client);
const outDir = new URL('docs/poster/', root);
const pngPath = new URL('poster.png', outDir);
const pdfPath = new URL('poster.pdf', outDir);
await mkdir(outDir, { recursive: true });

let resolveSaved;
let rejectSaved;
const saved = new Promise((resolve, reject) => { resolveSaved = resolve; rejectSaved = reject; });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    if (req.method === 'POST' && url.pathname === '/save') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 30_000_000) throw new Error('PNG が大きすぎます');
        chunks.push(chunk);
      }
      const png = Buffer.concat(chunks);
      if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== W || png.readUInt32BE(20) !== H) {
        throw new Error(`${W}×${H} の PNG ではありません`);
      }
      await writeFile(pngPath, png);
      console.log(fileURLToPath(pngPath));
      res.end('saved');
      resolveSaved();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/error') {
      let text = '';
      for await (const chunk of req) text += chunk;
      res.end('ok');
      rejectSaved(new Error(`描画で失敗：${text}`));
      return;
    }
    // ゲームの描画関数は client/src から、型だけを除いて配る（import の相対の関係を src と同じに保つ）
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.ts') && !url.pathname.includes('..')) {
      const body = await readFile(new URL(`.${url.pathname}`, client));
      res.setHeader('Content-Type', 'text/javascript');
      res.end(stripTypeScriptTypes(body.toString()));
      return;
    }
    const routes = {
      '/': ['text/html; charset=utf-8', new URL('scripts/poster.html', client)],
      '/render.js': ['text/javascript', new URL('scripts/render-poster.js', client)],
      '/font.ttf': ['font/ttf', new URL('public/fonts/DotGothic16-Regular.ttf', client)],
      '/pdf.html': ['text/html; charset=utf-8', new URL('scripts/poster-pdf.html', client)],
      '/poster.png': ['image/png', pngPath],
    };
    const route = routes[url.pathname];
    if (!route) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', route[0]);
    res.end(await readFile(route[1]));
  } catch (error) {
    console.error(error);
    res.writeHead(500).end(String(error));
  }
});

function chrome(profile, args) {
  return spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...args], { stdio: 'ignore' });
}
function exited(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });
}
function timeout(ms, what) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}が ${ms / 1000} 秒で終わりませんでした`)), ms).unref());
}

const profile = await mkdtemp(join(tmpdir(), 'jinkei-poster-chrome-'));
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  // 1. PNG：ページを開くと描いて /save へ送る。送り終えたら Chrome を止める
  browser = chrome(profile, ['--window-size=800,600', `http://127.0.0.1:${PORT}/`]);
  await Promise.race([saved, timeout(120_000, 'PNG の描画')]);
  browser.kill();
  await exited(browser);
  // 2. PDF：PNG を1枚、A4 横のページいっぱいに置いた HTML を印刷する
  await rm(pdfPath, { force: true });
  browser = chrome(profile, [`--print-to-pdf=${fileURLToPath(pdfPath)}`, '--no-pdf-header-footer', `http://127.0.0.1:${PORT}/pdf.html`]);
  await Promise.race([exited(browser), timeout(120_000, 'PDF の印刷')]);
  if (!(await stat(pdfPath)).size) throw new Error('PDF が空です');
  console.log(fileURLToPath(pdfPath));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser && browser.exitCode === null && browser.signalCode === null) { browser.kill(); await exited(browser); }
  server.close();
  await rm(profile, { recursive: true, force: true });
}
