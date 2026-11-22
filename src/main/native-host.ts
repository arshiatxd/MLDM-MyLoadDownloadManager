import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const NATIVE_HOST_NAME = 'com.myload.host';
export const DEFAULT_EXTENSION_ID = 'cbnkknogojpgeikfeaploefenabcgiai';
export const BRIDGE_PORT_CANDIDATES = [
  49173,
  49174,
  49175,
  49176,
  49177,
  49178,
  49179,
  49180,
  49181,
  49182,
];

const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;
const WINDOWS_NATIVE_HOST_REG_KEYS = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Vivaldi\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Opera Software\\Opera Stable\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
];

export function encodeNativeMessage(payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function readOneNativeMessage(
  stream: NodeJS.ReadableStream,
  timeoutMs = 5000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer: Buffer = Buffer.alloc(0);
    let expectedLen: number | null = null;
    let settled = false;

    const timer = setTimeout(() => {
      finish(new Error('Timed out waiting for native host message'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    };

    const finish = (err: Error | null, parsed?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) {
        reject(err);
      } else {
        resolve(parsed ?? {});
      }
    };

    const tryConsume = () => {
      if (expectedLen === null && buffer.length >= 4) {
        expectedLen = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
        if (expectedLen === 0) {
          finish(new Error('Empty native message frame'));
          return;
        }
        if (expectedLen > MAX_NATIVE_MESSAGE_BYTES) {
          finish(new Error('Native message frame exceeded size limit'));
          return;
        }
      }
      if (expectedLen !== null && buffer.length >= expectedLen) {
        const jsonBuf = buffer.subarray(0, expectedLen);
        try {
          const parsed = JSON.parse(jsonBuf.toString('utf-8')) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            finish(new Error('Invalid native message payload'));
            return;
          }
          finish(null, parsed as Record<string, unknown>);
        } catch (err) {
          finish(err instanceof Error ? err : new Error('Malformed native message JSON'));
        }
      }
    };

    const onData = (chunk: Buffer | string) => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = buffer.length === 0 ? part : Buffer.concat([buffer, part]);
      tryConsume();
    };

    const onEnd = () => {
      if (!settled) {
        finish(new Error('Native messaging stdin closed before a complete message was received'));
      }
    };

    const onError = (err: Error) => {
      finish(err);
    };

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

export function getNativeHostManifestDir(fallbackDir?: string): string {
  const base = process.env.LOCALAPPDATA || fallbackDir || os.tmpdir();
  return path.join(base, 'MyLoad', 'native-host');
}

export function writeActiveBridgePort(userDataDir: string, port: number): void {
  if (!userDataDir || !Number.isInteger(port) || port < 1024 || port > 65535) return;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, 'bridge.json'),
      JSON.stringify({ port, updatedAt: Date.now() }),
      'utf-8'
    );
  } catch {
  }
}

export function readActiveBridgePort(userDataDir: string, fallbackPort = 49173): number {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, 'bridge.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { port?: unknown };
    const port = Number(parsed?.port);
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
      return port;
    }
  } catch {
  }
  return fallbackPort;
}

export async function ensureNativeMessagingHostRegistered(opts: {
  executablePath: string;
  launchExecutablePath?: string;
  hostScriptPath: string;
  userDataDir: string;
  manifestDir?: string;
  extraExtensionIds?: string[];
  skipRegistry?: boolean;
}): Promise<{ manifestPath: string; wrapperPath: string; allowedOrigins: string[] }> {
  const targetDir = opts.manifestDir || getNativeHostManifestDir();
  await fs.promises.mkdir(targetDir, { recursive: true });
  const manifestPath = path.join(targetDir, `${NATIVE_HOST_NAME}.json`);
  const wrapperPath = path.join(targetDir, `${NATIVE_HOST_NAME}.cmd`);

  let resolvedScriptPath = opts.hostScriptPath;
  if (fs.existsSync(opts.hostScriptPath)) {
    const copiedScriptPath = path.join(targetDir, 'native-host.cjs');
    try {
      await fs.promises.copyFile(opts.hostScriptPath, copiedScriptPath);
      resolvedScriptPath = copiedScriptPath;
    } catch {
      resolvedScriptPath = opts.hostScriptPath;
    }
  }

  const launchExe = opts.launchExecutablePath || opts.executablePath;
  const cmdContent = [
    '@echo off',
    'setlocal',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `set "MYLOAD_LAUNCH_EXE=${launchExe}"`,
    `set "MYLOAD_USER_DATA_DIR=${opts.userDataDir}"`,
    `"${opts.executablePath}" "${resolvedScriptPath}" %*`,
    '',
  ].join('\r\n');
  await fs.promises.writeFile(wrapperPath, cmdContent, 'utf-8');

  const originSet = new Set<string>([`chrome-extension://${DEFAULT_EXTENSION_ID}/`]);
  try {
    if (fs.existsSync(manifestPath)) {
      const existing = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8')) as {
        allowed_origins?: unknown;
      };
      if (Array.isArray(existing.allowed_origins)) {
        for (const item of existing.allowed_origins) {
          if (typeof item === 'string' && /^chrome-extension:\/\/[a-p]{32}\/$/i.test(item.trim())) {
            originSet.add(item.trim().toLowerCase());
          }
        }
      }
    }
  } catch {
  }

  for (const id of opts.extraExtensionIds ?? []) {
    const clean = id.trim().toLowerCase();
    if (/^[a-p]{32}$/.test(clean)) {
      originSet.add(`chrome-extension://${clean}/`);
    }
  }

  const allowedOrigins = [...originSet];
  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'MyLoad Download Manager Native Launch Host',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: allowedOrigins,
  };

  await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  if (process.platform === 'win32' && !opts.skipRegistry) {
    for (const regKey of WINDOWS_NATIVE_HOST_REG_KEYS) {
      try {
        await execFileAsync(
          'reg.exe',
          ['add', regKey, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
          { windowsHide: true }
        );
      } catch {
      }
    }
  }

  return { manifestPath, wrapperPath, allowedOrigins };
}

function defaultProbePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      `http://127.0.0.1:${port}/api/v1/health`,
      {
        method: 'GET',
        headers: { 'X-MyLoad-Client': 'myload-extension' },
        timeout: 450,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function sendFocusSignal(port: number): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request(
      `http://127.0.0.1:${port}/api/v1/focus`,
      {
        method: 'POST',
        headers: { 'X-MyLoad-Client': 'myload-extension' },
        timeout: 800,
      },
      (res) => {
        res.resume();
        resolve();
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.on('error', () => resolve());
    req.end();
  });
}

function buildPortSearchList(userDataDir: string, preferredPort?: number): number[] {
  const seen = new Set<number>();
  const add = (p: number | undefined) => {
    if (typeof p === 'number' && Number.isInteger(p) && p >= 1024 && p <= 65535) {
      seen.add(p);
    }
  };
  add(preferredPort);
  add(readActiveBridgePort(userDataDir));
  for (const p of BRIDGE_PORT_CANDIDATES) add(p);
  return [...seen];
}

function writeFramed(
  stdout: NodeJS.WritableStream,
  payload: unknown
): Promise<void> {
  return new Promise((resolve) => {
    const frame = encodeNativeMessage(payload);
    stdout.write(frame, () => resolve());
  });
}

export async function runNativeHostBridge(opts: {
  executablePath: string;
  userDataDir: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  launchApp?: (focusMain: boolean) => void;
  probePort?: (port: number) => Promise<boolean>;
  waitTimeoutMs?: number;
}): Promise<void> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const probe = opts.probePort ?? defaultProbePort;
  const waitTimeoutMs = opts.waitTimeoutMs ?? 12000;

  let msg: Record<string, unknown>;
  try {
    msg = await readOneNativeMessage(stdin);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to read native message';
    await writeFramed(stdout, { ok: false, error: message });
    return;
  }

  if (msg.action === 'ping') {
    await writeFramed(stdout, { ok: true, pong: true, host: NATIVE_HOST_NAME });
    return;
  }

  const preferredPort =
    typeof msg.preferredPort === 'number' ? msg.preferredPort : undefined;
  const focusMain = Boolean(msg.focusMain);

  const findHealthyPort = async (): Promise<number | null> => {
    const candidates = buildPortSearchList(opts.userDataDir, preferredPort);
    for (const port of candidates) {
      if (await probe(port)) {
        return port;
      }
    }
    return null;
  };

  const existingPort = await findHealthyPort();
  if (existingPort !== null) {
    if (focusMain) {
      await sendFocusSignal(existingPort);
    }
    await writeFramed(stdout, { ok: true, port: existingPort, launched: false });
    return;
  }

  const launch =
    opts.launchApp ??
    ((wantMainFocus: boolean) => {
      const args = wantMainFocus ? [] : ['--background-launch'];
      const childEnv = { ...process.env };
      delete childEnv.ELECTRON_RUN_AS_NODE;
      const child = spawn(opts.executablePath, args, {
        detached: true,
        stdio: 'ignore',
        env: childEnv,
      });
      child.unref();
    });

  launch(focusMain);

  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const readyPort = await findHealthyPort();
    if (readyPort !== null) {
      await writeFramed(stdout, { ok: true, port: readyPort, launched: true });
      return;
    }
  }

  await writeFramed(stdout, {
    ok: false,
    error: 'Timed out waiting for MyLoad bridge',
  });
}

