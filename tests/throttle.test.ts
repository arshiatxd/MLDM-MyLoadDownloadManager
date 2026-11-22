import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../src/main/throttle';

describe('TokenBucket', () => {
  it('passes through immediately when unlimited', async () => {
    const bucket = new TokenBucket(null);
    const start = Date.now();
    await bucket.consume(5 * 1024 * 1024);
    expect(Date.now() - start).toBeLessThan(80);
    bucket.dispose();
  });

  it('throttles sustained throughput near configured rate', async () => {
    const bucket = new TokenBucket(100 * 1024);
    const start = Date.now();

    await bucket.consume(32 * 1024);
    await bucket.consume(32 * 1024);
    await bucket.consume(16 * 1024);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(400);
    bucket.dispose();
  });

  it('wakes pending waiters immediately when limit is removed', async () => {
    const bucket = new TokenBucket(2048);

    await bucket.consume(1024);

    const start = Date.now();
    const pending = bucket.consume(64 * 1024);
    setTimeout(() => bucket.setLimit(null), 50);
    await pending;
    expect(Date.now() - start).toBeLessThan(350);
    bucket.dispose();
  });

  it('rejects immediately when aborted via AbortSignal', async () => {
    const bucket = new TokenBucket(2048);
    await bucket.consume(1024);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 40);
    await expect(bucket.consume(64 * 1024, ac.signal)).rejects.toThrow(/abort/i);
    bucket.dispose();
  });
});

