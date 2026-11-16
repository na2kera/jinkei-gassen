import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index.ts';

describe('engine', () => {
  it('ENGINE_VERSION は 1', () => {
    expect(ENGINE_VERSION).toBe(1);
  });
});
