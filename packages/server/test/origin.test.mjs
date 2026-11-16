// Origin の比較（scheme・ホスト・ポートのすべて）。開発サーバー越しには scheme だけの違いを試せないので単体で確かめる。

import { describe, expect, it } from 'vitest';
import { originAllowed } from '../src/origin.ts';

describe('originAllowed', () => {
  const url = new URL('https://jinkei-gassen.example.workers.dev/api/rooms/1234/ws');
  it('同じ origin だけを通す', () => {
    expect(originAllowed('https://jinkei-gassen.example.workers.dev', url)).toBe(true);
    expect(originAllowed('http://jinkei-gassen.example.workers.dev', url)).toBe(false);
    expect(originAllowed('https://jinkei-gassen.example.workers.dev:8443', url)).toBe(false);
    expect(originAllowed('https://evil.example', url)).toBe(false);
    expect(originAllowed('https://jinkei-gassen.example.workers.dev.evil.example', url)).toBe(false);
    expect(originAllowed('null', url)).toBe(false);
    expect(originAllowed('not a url', url)).toBe(false);
  });
  it('Origin がなければ通す', () => {
    expect(originAllowed(null, url)).toBe(true);
  });
});
