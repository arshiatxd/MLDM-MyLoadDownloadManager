import { execFile } from 'node:child_process';
import type { PowerAction, ShutdownCountdownState } from '../shared/types';

export interface PowerPlatformAdapter {
  startSleepBlocker: () => number;
  stopSleepBlocker: (id: number) => void;
  executeSystemAction: (action: Exclude<PowerAction, 'off'>) => Promise<void>;
}

export function createElectronPowerAdapter(
  powerSaveBlocker: { start: (type: 'prevent-app-suspension') => number; stop: (id: number) => void; isStarted: (id: number) => boolean },
  quitApp: () => void
): PowerPlatformAdapter {
  return {
    startSleepBlocker: () => powerSaveBlocker.start('prevent-app-suspension'),
    stopSleepBlocker: (id: number) => {
      if (powerSaveBlocker.isStarted(id)) {
        powerSaveBlocker.stop(id);
      }
    },
    executeSystemAction: async (action) => {
      if (action === 'exit') {
        quitApp();
        return;
      }

      if (process.platform === 'win32') {
        if (action === 'shutdown') {
          await runExec('shutdown', ['/s', '/t', '0']);
          return;
        }
        if (action === 'hibernate') {
          await runExec('shutdown', ['/h']);
          return;
        }
        if (action === 'sleep') {
          await runExec('powershell', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)",
          ]);
          return;
        }
      } else if (process.platform === 'linux') {
        if (action === 'shutdown') await runExec('systemctl', ['poweroff']);
        if (action === 'sleep') await runExec('systemctl', ['suspend']);
        if (action === 'hibernate') await runExec('systemctl', ['hibernate']);
      } else if (process.platform === 'darwin') {
        if (action === 'sleep') await runExec('pmset', ['sleepnow']);
        if (action === 'shutdown') {
          await runExec('osascript', ['-e', 'tell app "System Events" to shut down']);
        }
      }
    },
  };
}

function runExec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export class PowerManager {
  private readonly adapter: PowerPlatformAdapter;
  private blockerId: number | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private countdownState: ShutdownCountdownState | null = null;
  private onCountdownUpdate?: (state: ShutdownCountdownState | null) => void;
  private onActionComplete?: (action: Exclude<PowerAction, 'off'>) => void;

  constructor(
    adapter: PowerPlatformAdapter,
    handlers?: {
      onCountdownUpdate?: (state: ShutdownCountdownState | null) => void;
      onActionComplete?: (action: Exclude<PowerAction, 'off'>) => void;
    }
  ) {
    this.adapter = adapter;
    this.onCountdownUpdate = handlers?.onCountdownUpdate;
    this.onActionComplete = handlers?.onActionComplete;
  }

  isPreventSleepActive(): boolean {
    return this.blockerId !== null;
  }

  setPreventSleep(active: boolean): boolean {
    if (active && this.blockerId === null) {
      this.blockerId = this.adapter.startSleepBlocker();
      return true;
    }
    if (!active && this.blockerId !== null) {
      const id = this.blockerId;
      this.blockerId = null;
      this.adapter.stopSleepBlocker(id);
      return false;
    }
    return this.blockerId !== null;
  }

  getCountdownState(): ShutdownCountdownState | null {
    return this.countdownState ? { ...this.countdownState } : null;
  }

  startCountdown(action: Exclude<PowerAction, 'off'>, totalSeconds = 60): void {
    this.cancelCountdown();

    this.countdownState = {
      active: true,
      action,
      remainingSeconds: totalSeconds,
      totalSeconds,
    };
    this.onCountdownUpdate?.({ ...this.countdownState });

    this.countdownTimer = setInterval(() => {
      if (!this.countdownState) return;
      const next = this.countdownState.remainingSeconds - 1;
      if (next <= 0) {
        void this.executeNow();
        return;
      }
      this.countdownState = {
        ...this.countdownState,
        remainingSeconds: next,
      };
      this.onCountdownUpdate?.({ ...this.countdownState });
    }, 1000);
  }

  cancelCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.countdownState) {
      this.countdownState = null;
      this.onCountdownUpdate?.(null);
    }
  }

  async executeNow(): Promise<void> {
    if (!this.countdownState) return;
    const action = this.countdownState.action;
    this.cancelCountdown();
    this.onActionComplete?.(action);
    await this.adapter.executeSystemAction(action);
  }

  dispose(): void {
    this.cancelCountdown();
    this.setPreventSleep(false);
  }
}

