import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserBridgeServer } from '../src/main/bridge';
import { LogManager } from '../src/main/logger';
import { BRIDGE_PORT_CANDIDATES } from '../src/main/native-host';
import type { BrowserInterceptPayload } from '../src/shared/types';

describe('BrowserBridgeServer', () => {
  let bridge: BrowserBridgeServer | null = null;

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
      bridge = null;
    }
  });

  it('rejects requests without X-MyLoad-Client or from web origins', async () => {
    const logger = new LogManager(null);
    bridge = new BrowserBridgeServer(logger, {
      getHealth: () => ({
        activeCount: 1,
        totalDownloadSpeed: 1024,
        showConfirmationDialog: true,
      }),
      onFocusWindow: vi.fn(),
      onIntercept: vi.fn(async () => 'confirm' as const),
    });

    const status = await bridge.start(0);
    expect(status.running).toBe(true);

    const missingHdr = await fetch(`http://127.0.0.1:${status.port}/api/v1/health`);
    expect(missingHdr.status).toBe(403);
    expect(missingHdr.headers.get('access-control-allow-origin')).toBeNull();

    const webOrigin = await fetch(`http://127.0.0.1:${status.port}/api/v1/health`, {
      headers: {
        Origin: 'https://evil.example',
        'X-MyLoad-Client': 'myload-extension',
      },
    });
    expect(webOrigin.status).toBe(403);
    expect(webOrigin.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('accepts extension requests for health, focus, and intercept and rejects unsupported URLs', async () => {
    const logger = new LogManager(null);
    const received: BrowserInterceptPayload[] = [];
    const onFocusWindow = vi.fn();

    bridge = new BrowserBridgeServer(logger, {
      getHealth: () => ({
        activeCount: 2,
        totalDownloadSpeed: 204800,
        showConfirmationDialog: true,
      }),
      onFocusWindow,
      onIntercept: async (payload) => {
        received.push(payload);
        return 'confirm';
      },
    });

    const status = await bridge.start(0);
    const headers = {
      Origin: 'chrome-extension://abcdefghijklmnop',
      'X-MyLoad-Client': 'myload-extension',
      'Content-Type': 'application/json',
    };

    const healthRes = await fetch(`http://127.0.0.1:${status.port}/api/v1/health`, { headers });
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson).toMatchObject({
      ok: true,
      app: 'MyLoad',
      activeCount: 2,
      totalDownloadSpeed: 204800,
    });

    const focusRes = await fetch(`http://127.0.0.1:${status.port}/api/v1/focus`, {
      method: 'POST',
      headers,
    });
    expect(focusRes.status).toBe(200);
    expect(onFocusWindow).toHaveBeenCalledTimes(1);

    const badUrlRes = await fetch(`http://127.0.0.1:${status.port}/api/v1/intercept`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'file:///C:/secret.txt' }),
    });
    expect(badUrlRes.status).toBe(400);

    const okRes = await fetch(`http://127.0.0.1:${status.port}/api/v1/intercept`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: 'https://downloads.example.com/archive.zip',
        fileName: 'subdir/archive.zip',
        referrer: 'https://downloads.example.com/',
        cookie: 'session=abc123',
        fileSize: 4096,
      }),
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ ok: true, mode: 'confirm' });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      url: 'https://downloads.example.com/archive.zip',
      fileName: 'archive.zip',
      referrer: 'https://downloads.example.com/',
      cookie: 'session=abc123',
      fileSize: 4096,
    });
  });

  it('automatically falls back to the next free localhost bridge port when preferred port is busy', async () => {
    const logger = new LogManager(null);
    const blocker = http.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const blockerAddr = blocker.address() as { port: number };
    const startedPorts: number[] = [];

    try {
      bridge = new BrowserBridgeServer(logger, {
        getHealth: () => ({
          activeCount: 0,
          totalDownloadSpeed: 0,
          showConfirmationDialog: true,
        }),
        onFocusWindow: vi.fn(),
        onIntercept: async () => 'confirm',
        onBridgeStarted: (p) => startedPorts.push(p),
      });

      const status = await bridge.start(blockerAddr.port);
      expect(status.running).toBe(true);
      expect(status.port).not.toBe(blockerAddr.port);
      expect(BRIDGE_PORT_CANDIDATES).toContain(status.port);
      expect(startedPorts).toEqual([status.port]);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});

