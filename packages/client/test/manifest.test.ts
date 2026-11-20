// ホーム画面への追加（design §9.4、§9.9-11。M16）：manifest とアイコンと index.html のタグを確かめる。
// もとのファイル（public/・index.html）はいつも見る。ビルドの出力（dist/client/）は、あれば同じことを見る
// （pnpm test はビルドせずに走るため。ビルドのあとにもう一度走らせると、出力も確かめられる）。
// node --experimental-strip-types --test で動かす（クライアントにはテストの道具を入れていないため）。

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist', 'client');

/** PNG の幅と高さ（IHDR） */
function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${path} が PNG でない`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function check(dir: string, html: string, at: string): void {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8')) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    background_color: string;
    theme_color: string;
    lang: string;
    orientation?: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  assert.equal(m.name, '陣形合戦', at);
  assert.equal(m.short_name, '陣形合戦', at);
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.equal(m.background_color, '#100d08');
  assert.equal(m.theme_color, '#100d08');
  assert.equal(m.lang, 'ja');
  assert.equal(m.orientation, undefined, '向きは固定しない');
  assert.deepEqual(
    m.icons.map((i) => i.src),
    ['/icon-192.png', '/icon-512.png'],
  );
  for (const i of m.icons) {
    const [w, h] = i.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(join(dir, i.src)), { w, h }, `${at} ${i.src} の大きさ`);
    assert.equal(i.purpose, 'any');
  }
  // 3つ目（180）は index.html の apple-touch-icon が指す
  assert.deepEqual(pngSize(join(dir, 'icon-180.png')), { w: 180, h: 180 });

  for (const tag of [
    '<link rel="manifest" href="/manifest.webmanifest"',
    '<link rel="apple-touch-icon" href="/icon-180.png"',
    '<meta name="apple-mobile-web-app-capable" content="yes"',
    '<meta name="mobile-web-app-capable" content="yes"',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"',
    '<meta name="apple-mobile-web-app-title" content="陣形合戦"',
    '<meta name="theme-color" content="#100d08"',
  ]) {
    assert.ok(html.includes(tag), `${at} の index.html に ${tag} がない`);
  }
  // viewport の meta のすぐ下に足す（OGP の PR が title の下に足すので、食い違わないように）
  assert.ok(html.indexOf('rel="manifest"') > html.indexOf('name="viewport"') && html.indexOf('rel="manifest"') < html.indexOf('<title>'), `${at}：置き場所`);
}

test('M16 もとのファイル：manifest が JSON として読め、icons の指すファイルがある。index.html に manifest とアイコンの指定がある', () => {
  check(join(ROOT, 'public'), readFileSync(join(ROOT, 'index.html'), 'utf8'), 'もと');
});

test('M16 ビルドの出力（dist/client/ があるときだけ）', { skip: !existsSync(join(DIST, 'index.html')) && 'ビルドの出力がない' }, () => {
  check(DIST, readFileSync(join(DIST, 'index.html'), 'utf8'), 'ビルド');
});
