import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXTENSION_ID,
  NATIVE_HOST_NAME,
  encodeNativeMessage,
  ensureNativeMessagingHostRegistered,
  readActiveBridgePort,
  readOneNativeMessage,
  runNativeHostBridge,
  writeActiveBridgePort,
} from '../src/main/native-host';

function decodeSingleNativeResponse(buf: Buffer): Record<string, unknown> {
  const len = buf.readUInt32LE(0);
  const body = buf.subarray(4, 4 + len).toString('utf-8');
  return JSON.parse(body) as Record<string, unknown>;
}

describe('Native Messaging Host & Auto-Launch Bridge', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-native-host-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('encodes and decodes 4-byte length-prefixed Native Messaging frames', async () => {
    const stream = new PassThrough();
    const packet = encodeNativeMessage({ action: 'ping', count: 2 });
    stream.write(packet.subarray(0, 3));
    stream.write(packet.subarray(3));
    const parsed = await readOneNativeMessage(stream);
    expect(parsed).toEqual({ action: 'ping', count: 2 });
  });

  it('writes native host manifest and cmd wrapper and preserves both default and unpacked extension IDs', async () => {
    const manifestDir = path.join(tmpDir, 'native-host');
    const dummyScript = path.join(tmpDir, 'native-host-src.cjs');
    await fs.promises.writeFile(dummyScript, 'console.log("stub");', 'utf-8');
    const customId = 'abcdefghijklmnopabcdefghijklmnop';
    const secondId = 'ponmlkjihgfedcbaponmlkjihgfedcba';
    const exePath = 'C:\\Program Files\\MyLoad Download Manager\\MyLoad Download Manager.exe';

    const first = await ensureNativeMessagingHostRegistered({
      executablePath: exePath,
      hostScriptPath: dummyScript,
      userDataDir: path.join(tmpDir, 'userData'),
      manifestDir,
      extraExtensionIds: [customId],
      skipRegistry: true,
    });

    expect(first.manifestPath).toBe(path.join(manifestDir, `${NATIVE_HOST_NAME}.json`));
    expect(first.wrapperPath).toBe(path.join(manifestDir, `${NATIVE_HOST_NAME}.cmd`));
    expect(first.allowedOrigins).toContain(`chrome-extension://${DEFAULT_EXTENSION_ID}/`);
    expect(first.allowedOrigins).toContain(`chrome-extension://${customId}/`);

    const second = await ensureNativeMessagingHostRegistered({
      executablePath: exePath,
      hostScriptPath: dummyScript,
      userDataDir: path.join(tmpDir, 'userData'),
      manifestDir,
      extraExtensionIds: [secondId],
      skipRegistry: true,
    });

    expect(second.allowedOrigins).toContain(`chrome-extension://${customId}/`);
    expect(second.allowedOrigins).toContain(`chrome-extension://${secondId}/`);
    const diskJson = JSON.parse(await fs.promises.readFile(second.manifestPath, 'utf-8')) as {
      name: string;
      type: string;
      path: string;
    };
    expect(diskJson.name).toBe(NATIVE_HOST_NAME);
    expect(diskJson.type).toBe('stdio');
    expect(diskJson.path).toBe(second.wrapperPath);
    const cmdText = await fs.promises.readFile(second.wrapperPath, 'utf-8');
    expect(cmdText).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(cmdText).toContain(exePath);
    expect(cmdText).toContain('native-host.cjs');
  });

  it('responds to ping, returns active port when running, and launches app when offline', async () => {
    const stdinPing = new PassThrough();
    const stdoutPing = new PassThrough();
    const outPingChunks: Buffer[] = [];
    stdoutPing.on('data', (c: Buffer) => outPingChunks.push(c));

    stdinPing.end(encodeNativeMessage({ action: 'ping' }));
    await runNativeHostBridge({
      executablePath: 'C:\\MyLoad.exe',
      userDataDir: tmpDir,
      stdin: stdinPing,
      stdout: stdoutPing,
    });
    expect(decodeSingleNativeResponse(Buffer.concat(outPingChunks))).toEqual({
      ok: true,
      pong: true,
      host: NATIVE_HOST_NAME,
    });

    writeActiveBridgePort(tmpDir, 49174);
    expect(readActiveBridgePort(tmpDir)).toBe(49174);

    let online = false;
    const launchApp = vi.fn(() => {
      setTimeout(() => {
        online = true;
      }, 60);
    });

    const stdinWake = new PassThrough();
    const stdoutWake = new PassThrough();
    const outWakeChunks: Buffer[] = [];
    stdoutWake.on('data', (c: Buffer) => outWakeChunks.push(c));

    stdinWake.end(encodeNativeMessage({ action: 'ensure-running', preferredPort: 49173, focusMain: false }));
    await runNativeHostBridge({
      executablePath: 'C:\\MyLoad.exe',
      userDataDir: tmpDir,
      stdin: stdinWake,
      stdout: stdoutWake,
      launchApp,
      probePort: async (port) => online && port === 49174,
      waitTimeoutMs: 3000,
    });

    expect(launchApp).toHaveBeenCalledWith(false);
    expect(decodeSingleNativeResponse(Buffer.concat(outWakeChunks))).toEqual({
      ok: true,
      port: 49174,
      launched: true,
    });
  });
});

