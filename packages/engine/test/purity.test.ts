// engine の原則（design §3.1）：Math.random・Date.now・時計・通信・DOM に触れない。例外を投げない。
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../src/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

describe('src に入出力と非決定的なものがない', () => {
  for (const f of files) {
    it(f, () => {
      const code = readFileSync(dir + f, 'utf8');
      for (const bad of ['Math.random', 'Date.now', 'new Date', 'performance.', 'setTimeout', 'setInterval', 'fetch(', 'document.', 'window.', 'process.', 'throw ']) {
        expect(code.includes(bad), `${f} に ${bad}`).toBe(false);
      }
    });
  }
});
