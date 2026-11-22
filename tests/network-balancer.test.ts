import { describe, expect, it, vi } from 'vitest';
import { LogManager } from '../src/main/logger';
import { NetworkBalancer } from '../src/main/network-balancer';

describe('NetworkBalancer', () => {
  it('reduces bandwidth on latency spikes or timeouts and recovers cleanly when latency stabilizes', async () => {
    const logger = new LogManager(null);
    const rttQueue: Array<number | null> = [15, 16, 15, 65, null, 15, 16, 15];
    const probeFn = vi.fn(async () => (rttQueue.length > 0 ? rttQueue.shift()! : 15));
    const limitHistory: Array<{ dl: number | null; ul: number | null }> = [];

    const balancer = new NetworkBalancer({
      logger,
      probeFn,
      intervalMs: 60000,
      onLimitChange: (dl, ul) => limitHistory.push({ dl, ul }),
    });

    balancer.configure({
      enabled: true,
      active: true,
      profile: 'gaming',
      userDownloadCap: null,
      userUploadCap: null,
      currentDownloadSpeed: 4 * 1024 * 1024,
    });

    await vi.waitFor(() => expect(probeFn).toHaveBeenCalledTimes(1));
    const initialCap = balancer.getEffectiveLimits().downloadLimit!;
    expect(initialCap).toBeGreaterThan(0);

    await balancer.probeOnce();
    await balancer.probeOnce();
    const afterSteadyCap = balancer.getEffectiveLimits().downloadLimit!;
    expect(balancer.getStats().state).toBe('steady');
    expect(afterSteadyCap).toBeGreaterThanOrEqual(initialCap);

    await balancer.probeOnce();
    const afterSpikeCap = balancer.getEffectiveLimits().downloadLimit!;
    expect(balancer.getStats().state).toBe('throttling');
    expect(afterSpikeCap).toBeLessThan(afterSteadyCap);

    await balancer.probeOnce();
    const afterTimeoutCap = balancer.getEffectiveLimits().downloadLimit!;
    expect(afterTimeoutCap).toBeLessThan(afterSpikeCap);
    expect(afterTimeoutCap).toBeGreaterThanOrEqual(256 * 1024);

    await balancer.probeOnce();
    await balancer.probeOnce();
    await balancer.probeOnce();
    expect(balancer.getStats().state).toBe('steady');
    expect(balancer.getEffectiveLimits().downloadLimit!).toBeGreaterThan(afterTimeoutCap);

    balancer.configure({
      enabled: true,
      active: false,
      profile: 'gaming',
      userDownloadCap: 5 * 1024 * 1024,
      userUploadCap: null,
    });
    expect(balancer.getEffectiveLimits().downloadLimit).toBe(5 * 1024 * 1024);
    expect(balancer.getStats().state).toBe('idle');
    balancer.dispose();
  });

  it('never exceeds the user manual download ceiling', async () => {
    const logger = new LogManager(null);
    const balancer = new NetworkBalancer({
      logger,
      probeFn: async () => 12,
      intervalMs: 60000,
      onLimitChange: () => {},
    });

    const userCap = 1024 * 1024;
    balancer.configure({
      enabled: true,
      active: true,
      profile: 'surfing',
      userDownloadCap: userCap,
      userUploadCap: null,
      currentDownloadSpeed: 8 * 1024 * 1024,
    });

    await balancer.probeOnce();
    await balancer.probeOnce();
    await balancer.probeOnce();

    expect(balancer.getEffectiveLimits().downloadLimit).toBeLessThanOrEqual(userCap);
    balancer.dispose();
  });
});

