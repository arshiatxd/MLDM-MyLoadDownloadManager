import net from 'node:net';
import type { GamingModeProfile, NetworkBalanceStats } from '../shared/types';
import type { LogManager } from './logger';

export type LatencyProbeFn = () => Promise<number | null>;

interface ProfileTuning {
  maxDeltaMs: number;
  maxJitterMs: number;
  floorBytesPerSec: number;
  initialCapBytesPerSec: number;
  maxDefaultBytesPerSec: number;
  uploadCapBytesPerSec: number;
}

const PROFILE_CONFIG: Record<GamingModeProfile, ProfileTuning> = {
  surfing: {
    maxDeltaMs: 25,
    maxJitterMs: 15,
    floorBytesPerSec: 512 * 1024,
    initialCapBytesPerSec: 3 * 1024 * 1024,
    maxDefaultBytesPerSec: 12 * 1024 * 1024,
    uploadCapBytesPerSec: 160 * 1024,
  },
  gaming: {
    maxDeltaMs: 12,
    maxJitterMs: 8,
    floorBytesPerSec: 256 * 1024,
    initialCapBytesPerSec: 1536 * 1024,
    maxDefaultBytesPerSec: 8 * 1024 * 1024,
    uploadCapBytesPerSec: 64 * 1024,
  },
};

const PROBE_ENDPOINTS: Array<{ host: string; port: number }> = [
  { host: '1.1.1.1', port: 443 },
  { host: '8.8.8.8', port: 443 },
];

export function createDefaultTcpProbe(): LatencyProbeFn {
  let idx = 0;
  return () => {
    const endpoint = PROBE_ENDPOINTS[idx % PROBE_ENDPOINTS.length];
    idx += 1;
    return measureTcpConnectRtt(endpoint.host, endpoint.port, 1200);
  };
}

function measureTcpConnectRtt(
  host: string,
  port: number,
  timeoutMs: number
): Promise<number | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;
    const socket = net.createConnection({ host, port });

    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      done(Math.max(1, Math.round(performance.now() - start)));
    });
    socket.once('timeout', () => done(null));
    socket.once('error', () => done(null));
  });
}

export class NetworkBalancer {
  private readonly logger: LogManager;
  private readonly probeFn: LatencyProbeFn;
  private readonly onLimitChange: (dlLimit: number | null, ulLimit: number | null) => void;
  private readonly intervalMs: number;

  private enabled = false;
  private active = false;
  private profile: GamingModeProfile = 'surfing';
  private userDownloadCap: number | null = null;
  private userUploadCap: number | null = null;
  private observedPeakSpeed = 0;

  private currentDlCap: number | null = null;
  private currentUlCap: number | null = null;
  private baselineRttMs: number | null = null;
  private lastRttMs: number | null = null;
  private jitterMs: number | null = null;
  private recentRtts: number[] = [];
  private cleanStreak = 0;
  private state: NetworkBalanceStats['state'] = 'idle';

  private timer: ReturnType<typeof setInterval> | null = null;
  private probing = false;

  constructor(opts: {
    logger: LogManager;
    onLimitChange: (dlLimit: number | null, ulLimit: number | null) => void;
    probeFn?: LatencyProbeFn;
    intervalMs?: number;
  }) {
    this.logger = opts.logger;
    this.onLimitChange = opts.onLimitChange;
    this.probeFn = opts.probeFn ?? createDefaultTcpProbe();
    this.intervalMs = opts.intervalMs ?? 2500;
  }

  configure(opts: {
    enabled: boolean;
    active: boolean;
    profile: GamingModeProfile;
    userDownloadCap: number | null;
    userUploadCap: number | null;
    currentDownloadSpeed?: number;
  }): void {
    const prevRunning = this.enabled && this.active;
    const prevProfile = this.profile;

    if (typeof opts.currentDownloadSpeed === 'number' && opts.currentDownloadSpeed > this.observedPeakSpeed) {
      this.observedPeakSpeed = opts.currentDownloadSpeed;
    }

    this.enabled = opts.enabled;
    this.active = opts.active;
    this.profile = opts.profile;
    this.userDownloadCap = opts.userDownloadCap;
    this.userUploadCap = opts.userUploadCap;

    const nextRunning = this.enabled && this.active;
    if (!nextRunning) {
      this.stopLoop();
      this.currentDlCap = this.userDownloadCap;
      this.currentUlCap = this.userUploadCap;
      this.state = 'idle';
      if (prevRunning) {
        this.onLimitChange(this.currentDlCap, this.currentUlCap);
      }
      return;
    }

    if (!prevRunning || prevProfile !== this.profile || this.currentDlCap === null) {
      this.initializeCaps();
      this.startLoop();
      void this.probeOnce();
    } else {
      this.clampToUserCeiling();
    }
  }

  getEffectiveLimits(): { downloadLimit: number | null; uploadLimit: number | null } {
    if (!this.enabled || !this.active) {
      return {
        downloadLimit: this.userDownloadCap,
        uploadLimit: this.userUploadCap,
      };
    }
    return {
      downloadLimit: this.currentDlCap,
      uploadLimit: this.currentUlCap,
    };
  }

  getStats(): NetworkBalanceStats {
    return {
      enabled: this.enabled,
      active: this.enabled && this.active,
      rttMs: this.lastRttMs,
      baselineRttMs: this.baselineRttMs,
      jitterMs: this.jitterMs,
      effectiveDownloadLimit: this.currentDlCap,
      effectiveUploadLimit: this.currentUlCap,
      state: this.state,
    };
  }

  async probeOnce(): Promise<void> {
    if (!this.enabled || !this.active || this.probing) return;
    this.probing = true;
    try {
      const rtt = await this.probeFn();
      if (!this.enabled || !this.active) return;
      this.applyProbeSample(rtt);
    } finally {
      this.probing = false;
    }
  }

  dispose(): void {
    this.stopLoop();
    this.enabled = false;
    this.active = false;
    this.state = 'idle';
  }

  private initializeCaps(): void {
    const tuning = PROFILE_CONFIG[this.profile];
    const peakSeed =
      this.observedPeakSpeed > 0
        ? Math.round(this.observedPeakSpeed * (this.profile === 'gaming' ? 0.6 : 0.75))
        : tuning.initialCapBytesPerSec;

    let dl = Math.max(tuning.floorBytesPerSec, Math.max(tuning.initialCapBytesPerSec, peakSeed));
    if (this.userDownloadCap !== null) {
      dl = Math.min(dl, this.userDownloadCap);
    }
    let ul = tuning.uploadCapBytesPerSec;
    if (this.userUploadCap !== null) {
      ul = Math.min(ul, this.userUploadCap);
    }

    this.currentDlCap = dl;
    this.currentUlCap = ul;
    this.cleanStreak = 0;
    this.recentRtts = [];
    this.baselineRttMs = null;
    this.lastRttMs = null;
    this.jitterMs = null;
    this.state = 'probing';
    this.logger.info(
      'NetBalance',
      `Gaming/Surfing Mode active (${this.profile}, initial cap ${Math.round(dl / 1024)} KB/s)`
    );
    this.onLimitChange(this.currentDlCap, this.currentUlCap);
  }

  private clampToUserCeiling(): void {
    const tuning = PROFILE_CONFIG[this.profile];
    let dl = this.currentDlCap ?? tuning.initialCapBytesPerSec;
    if (this.userDownloadCap !== null) {
      dl = Math.min(dl, this.userDownloadCap);
    }
    let ul = tuning.uploadCapBytesPerSec;
    if (this.userUploadCap !== null) {
      ul = Math.min(ul, this.userUploadCap);
    }
    if (dl !== this.currentDlCap || ul !== this.currentUlCap) {
      this.currentDlCap = dl;
      this.currentUlCap = ul;
      this.onLimitChange(this.currentDlCap, this.currentUlCap);
    }
  }

  private applyProbeSample(rtt: number | null): void {
    const tuning = PROFILE_CONFIG[this.profile];
    const ceiling = this.getUpperCeiling(tuning);
    let currentCap = this.currentDlCap ?? tuning.initialCapBytesPerSec;

    if (rtt === null) {
      this.cleanStreak = 0;
      const reduced = Math.max(tuning.floorBytesPerSec, Math.round(currentCap * 0.68));
      this.state = 'throttling';
      if (reduced !== currentCap) {
        this.currentDlCap = Math.min(ceiling, reduced);
        this.onLimitChange(this.currentDlCap, this.currentUlCap);
      }
      return;
    }

    const prevRtt = this.lastRttMs;
    const prevBaseline = this.baselineRttMs ?? rtt;
    this.lastRttMs = rtt;

    if (this.baselineRttMs === null || rtt < this.baselineRttMs) {
      this.baselineRttMs = rtt;
    } else if (rtt - this.baselineRttMs <= tuning.maxDeltaMs) {
      this.baselineRttMs = Math.round(this.baselineRttMs * 0.9 + rtt * 0.1);
    }

    const delta = rtt - this.baselineRttMs;
    if (prevRtt !== null && prevRtt - prevBaseline > tuning.maxDeltaMs && delta <= tuning.maxDeltaMs) {
      this.recentRtts = [rtt];
    } else {
      this.recentRtts.push(rtt);
      if (this.recentRtts.length > 3) {
        this.recentRtts.shift();
      }
    }

    this.jitterMs = computeJitter(this.recentRtts);
    const congested = delta > tuning.maxDeltaMs || this.jitterMs > tuning.maxJitterMs;

    if (congested) {
      this.cleanStreak = 0;
      const reduced = Math.max(tuning.floorBytesPerSec, Math.round(currentCap * 0.68));
      this.state = 'throttling';
      this.currentDlCap = Math.min(ceiling, reduced);
      this.onLimitChange(this.currentDlCap, this.currentUlCap);
      return;
    }

    this.cleanStreak += 1;
    if (this.cleanStreak >= 2) {
      const increased = Math.min(ceiling, Math.round(currentCap * 1.15 + 256 * 1024));
      this.state = 'steady';
      if (increased !== currentCap) {
        this.currentDlCap = increased;
        this.onLimitChange(this.currentDlCap, this.currentUlCap);
      }
    } else {
      this.state = 'steady';
    }
  }

  private getUpperCeiling(tuning: ProfileTuning): number {
    const dynamicMax = Math.max(
      tuning.maxDefaultBytesPerSec,
      Math.round(this.observedPeakSpeed * 1.1)
    );
    return this.userDownloadCap !== null
      ? Math.min(this.userDownloadCap, dynamicMax)
      : dynamicMax;
  }

  private startLoop(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.probeOnce();
    }, this.intervalMs);
  }

  private stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function computeJitter(samples: number[]): number {
  if (samples.length < 2) return 0;
  let totalDiff = 0;
  for (let i = 1; i < samples.length; i++) {
    totalDiff += Math.abs(samples[i] - samples[i - 1]);
  }
  return Math.round(totalDiff / (samples.length - 1));
}

