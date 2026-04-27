import { describe, expect, it } from 'vitest';
import { InMemoryTokenBucketLimiter } from '../src/rateLimit.js';

describe('InMemoryTokenBucketLimiter', () => {
  it('allows under capacity', async () => {
    const l = new InMemoryTokenBucketLimiter({ capacity: 3 });
    expect((await l.check('a')).allowed).toBe(true);
    expect((await l.check('a')).allowed).toBe(true);
    expect((await l.check('a')).allowed).toBe(true);
  });

  it('denies when bucket empty', async () => {
    const l = new InMemoryTokenBucketLimiter({ capacity: 2 });
    await l.check('a');
    await l.check('a');
    const third = await l.check('a');
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('refills after interval', async () => {
    let now = 0;
    const l = new InMemoryTokenBucketLimiter({
      capacity: 1,
      refillIntervalMs: 1000,
      now: () => now,
    });
    expect((await l.check('a')).allowed).toBe(true);
    expect((await l.check('a')).allowed).toBe(false);
    now += 1000;
    expect((await l.check('a')).allowed).toBe(true);
  });

  it('isolates per-key buckets', async () => {
    const l = new InMemoryTokenBucketLimiter({ capacity: 1 });
    expect((await l.check('a')).allowed).toBe(true);
    expect((await l.check('b')).allowed).toBe(true);
    expect((await l.check('a')).allowed).toBe(false);
  });
});
