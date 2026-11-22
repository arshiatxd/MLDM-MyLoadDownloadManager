import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, LogLevel } from '../shared/types';

const MAX_MEMORY_ENTRIES = 500;
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;

export class LogManager {
  private entries: LogEntry[] = [];
  private readonly logFilePath: string | null;
  private readonly onAppend?: (entry: LogEntry) => void;
  private writeChain: Promise<void> = Promise.resolve();
  private dirReady = false;

  constructor(logFilePath: string | null, onAppend?: (entry: LogEntry) => void) {
    this.logFilePath = logFilePath;
    this.onAppend = onAppend;
  }

  log(level: LogLevel, source: string, message: string, downloadId?: string): LogEntry {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level,
      source,
      downloadId,
      message,
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_MEMORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_MEMORY_ENTRIES);
    }

    this.onAppend?.(entry);

    if (this.logFilePath) {
      const iso = new Date(entry.timestamp).toISOString();
      const idTag = downloadId ? ` [${downloadId.slice(0, 8)}]` : '';
      const line = `[${iso}] [${level.toUpperCase()}] [${source}]${idTag} ${message}\n`;
      this.appendToFile(line);
    }

    return entry;
  }

  info(source: string, message: string, downloadId?: string): LogEntry {
    return this.log('info', source, message, downloadId);
  }

  warn(source: string, message: string, downloadId?: string): LogEntry {
    return this.log('warn', source, message, downloadId);
  }

  error(source: string, message: string, downloadId?: string): LogEntry {
    return this.log('error', source, message, downloadId);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    if (this.logFilePath) {
      const target = this.logFilePath;
      this.writeChain = this.writeChain
        .then(async () => {
          if (fs.existsSync(target)) {
            await fs.promises.writeFile(target, '', 'utf-8');
          }
        })
        .catch(() => {});
    }
  }

  formatForExport(entries: LogEntry[] = this.entries): string {
    return entries
      .map((entry) => {
        const iso = new Date(entry.timestamp).toISOString();
        const idTag = entry.downloadId ? ` [${entry.downloadId}]` : '';
        return `[${iso}] [${entry.level.toUpperCase()}] [${entry.source}]${idTag} ${entry.message}`;
      })
      .join('\n');
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  private appendToFile(line: string): void {
    const target = this.logFilePath;
    if (!target) return;

    this.writeChain = this.writeChain
      .then(async () => {
        if (!this.dirReady) {
          await fs.promises.mkdir(path.dirname(target), { recursive: true });
          this.dirReady = true;
        }
        try {
          const stat = await fs.promises.stat(target);
          if (stat.size >= MAX_LOG_FILE_BYTES) {
            const rotated = `${target}.1`;
            await fs.promises.rm(rotated, { force: true });
            await fs.promises.rename(target, rotated);
          }
        } catch {

        }
        await fs.promises.appendFile(target, line, 'utf-8');
      })
      .catch(() => {});
  }
}

