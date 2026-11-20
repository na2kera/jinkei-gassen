// Node 22.13.1。依存追加なし。起動後、表示された URL をブラウザで開く。
// 既存の TypeScript の型だけを除いて配信し、Canvas が PNG を書き戻す。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const client = new URL('../', import.meta.url);
const root = new URL('../../', client);
const outputs = {
  selected: new URL('public/ogp.png', client),
  banner: new URL('.ogp-alt/banner.png', root),
  field: new URL('.ogp-alt/field.png', root),
  favicon: new URL('public/favicon.png', client),
  'icon-180': new URL('public/icon-180.png', client),
  'icon-192': new URL('public/icon-192.png', client),
  'icon-512': new URL('public/icon-512.png', client),
};
// 保存を受け付ける大きさ（幅, 高さ）。favicon だけ 64×64
const sizes = { favicon: [64, 64], 'icon-180': [180, 180], 'icon-192': [192, 192], 'icon-512': [512, 512] };
await mkdir(new URL('.ogp-alt/', root), { recursive: true });
const saved = new Set();
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url?.startsWith('/save/')) {
      const name = req.url.slice(6);
      if (!Object.hasOwn(outputs, name)) { res.writeHead(404).end(); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_000_000) throw new Error('PNG が大きすぎます');
        chunks.push(chunk);
      }
      const png = Buffer.concat(chunks);
      if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== (sizes[name]?.[0] ?? 1200) || png.readUInt32BE(20) !== (sizes[name]?.[1] ?? 630)) {
        throw new Error('決めた大きさの PNG ではありません');
      }
      await writeFile(outputs[name], png);
      console.log(fileURLToPath(outputs[name]));
      saved.add(name);
      res.end('saved');
      if (saved.size === Object.keys(outputs).length) server.close();
      return;
    }
    const routes = {
      '/': ['text/html; charset=utf-8', new URL('scripts/ogp.html', client)],
      '/render.js': ['text/javascript', new URL('scripts/render-ogp.js', client)],
      '/textures.ts': ['text/javascript', new URL('src/art/textures.ts', client)],
      '/palette.ts': ['text/javascript', new URL('src/art/palette.ts', client)],
      '/font.ttf': ['font/ttf', new URL('public/fonts/DotGothic16-Regular.ttf', client)],
    };
    const route = routes[req.url];
    if (!route) { res.writeHead(404).end(); return; }
    let body = await readFile(route[1]);
    if (req.url.endsWith('.ts')) body = stripTypeScriptTypes(body.toString());
    res.setHeader('Content-Type', route[0]);
    res.end(body);
  } catch (error) {
    console.error(error);
    res.writeHead(500).end(String(error));
  }
});
server.listen(5191, '127.0.0.1', () => console.log('http://127.0.0.1:5191/ を開くと OGP の3案と favicon、ホーム画面用のアイコンを保存し、サーバーを停止します。'));
server.on('error', (error) => { console.error(error); process.exitCode = 1; });
