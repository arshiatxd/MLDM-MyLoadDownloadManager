export class TokenBucket {
  private limitBytesPerSec: number | null = null;
  private tokens = Number.POSITIVE_INFINITY;
  private lastRefillMs = Date.now();
  private waiters = new Set<() => void>();
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(limitBytesPerSec: number | null = null) {
    this.setLimit(limitBytesPerSec);
  }

  setLimit(limitBytesPerSec: number | null): void {
    if (limitBytesPerSec === null || !Number.isFinite(limitBytesPerSec) || limitBytesPerSec <= 0) {
      this.limitBytesPerSec = null;
      this.tokens = Number.POSITIVE_INFINITY;
    } else {
      const normalized = Math.max(1024, Math.round(limitBytesPerSec));
      const cap = this.getCapacity(normalized);
      this.limitBytesPerSec = normalized;
      this.tokens = Number.isFinite(this.tokens) ? Math.min(this.tokens, cap) : cap;
      this.lastRefillMs = Date.now();
    }
    this.wakeAll();
  }

  getLimit(): number | null {
    return this.limitBytesPerSec;
  }

  async consume(bytes: number, signal?: AbortSignal): Promise<void> {
    if (bytes <= 0 || this.limitBytesPerSec === null) return;
    if (signal?.aborted) {
      throw createAbortError();
    }

    let remaining = bytes;
    while (remaining > 0) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const limit = this.limitBytesPerSec;
      if (limit === null) return;

      this.refill(limit);
      const chunkCap = Math.max(512, Math.min(32 * 1024, Math.floor(limit / 4)));
      const want = Math.min(remaining, chunkCap);

      if (this.tokens >= want) {
        this.tokens -= want;
        remaining -= want;
        continue;
      }

      if (this.tokens >= Math.min(1024, chunkCap)) {
        const take = Math.min(remaining, Math.floor(this.tokens));
        this.tokens -= take;
        remaining -= take;
        continue;
      }

      const deficit = Math.min(want, this.getCapacity(limit)) - this.tokens;
      const waitMs = Math.max(10, Math.ceil((deficit / limit) * 1000));
      await this.waitForWake(waitMs, signal);
    }
  }

  dispose(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    this.wakeAll();
  }

  private getCapacity(limit: number): number {
    return Math.max(1024, Math.min(128 * 1024, Math.round(limit * 0.25)));
  }

  private refill(limit: number): void {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.lastRefillMs);
    if (elapsedMs === 0) return;
    this.lastRefillMs = now;
    const added = (elapsedMs / 1000) * limit;
    this.tokens = Math.min(this.getCapacity(limit), this.tokens + added);
  }

  private wakeAll(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    const pending = [...this.waiters];
    this.waiters.clear();
    for (const wake of pending) {
      wake();
    }
  }

  private waitForWake(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        this.waiters.delete(onWake);
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      const onWake = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(createAbortError());
      };

      this.waiters.add(onWake);
      timer = setTimeout(onWake, ms);
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

function createAbortError(): Error {
  const err = new Error('Download aborted');
  err.name = 'AbortError';
  return err;
}

