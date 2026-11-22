import http from 'node:http';
import path from 'node:path';
import { isHttpUrl, isMagnetUri, sanitizeFileName } from '../shared/constants';
import type { BridgeStatus, BrowserInterceptPayload } from '../shared/types';
import type { LogManager } from './logger';
import { isAllowedExtensionOrigin, sanitizeHeaderValue } from './security';

const MAX_BODY_BYTES = 64 * 1024;
const CLIENT_HEADER = 'x-myload-client';
const EXPECTED_CLIENT = 'myload-extension';

export interface BridgeHandlers {
  getHealth: () => {
    activeCount: number;
    totalDownloadSpeed: number;
    showConfirmationDialog: boolean;
  };
  onFocusWindow: () => void;
  onIntercept: (payload: BrowserInterceptPayload) => Promise<'confirm' | 'started'>;
}

export class BrowserBridgeServer {
  private readonly logger: LogManager;
  private readonly handlers: BridgeHandlers;
  private server: http.Server | null = null;
  private status: BridgeStatus = { running: false, port: 49173 };

  constructor(logger: LogManager, handlers: BridgeHandlers) {
    this.logger = logger;
    this.handlers = handlers;
  }

  getStatus(): BridgeStatus {
    return { ...this.status };
  }

  async start(port: number): Promise<BridgeStatus> {
    await this.stop();

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.server = server;

    return new Promise((resolve) => {
      const onError = (err: Error) => {
        const msg = err.message || 'Failed to start browser bridge';
        this.logger.error('Bridge', `Failed to bind 127.0.0.1:${port}: ${msg}`);
        this.status = { running: false, port, error: msg };
        try {
          server.close();
        } catch {

        }
        if (this.server === server) {
          this.server = null;
        }
        resolve(this.getStatus());
      };

      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        this.status = { running: true, port: actualPort };
        this.logger.info('Bridge', `Browser extension bridge listening on 127.0.0.1:${actualPort}`);
        resolve(this.getStatus());
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.status = { running: false, port: this.status.port };
    if (!server) return;

    await new Promise<void>((resolve) => {
      try {
        server.close(() => resolve());
        server.closeAllConnections?.();
      } catch {
        resolve();
      }
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';

    if (origin && !isAllowedExtensionOrigin(origin)) {
      this.sendJson(res, 403, { ok: false, error: 'Origin rejected' });
      return;
    }

    if (req.method === 'OPTIONS') {
      if (origin && isAllowedExtensionOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MyLoad-Client');
        res.writeHead(204);
        res.end();
        return;
      }
      this.sendJson(res, 403, { ok: false, error: 'Origin rejected' });
      return;
    }

    const clientHeader = req.headers[CLIENT_HEADER];
    if (clientHeader !== EXPECTED_CLIENT) {
      this.sendJson(res, 403, { ok: false, error: 'Missing or invalid X-MyLoad-Client header' });
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && reqUrl.pathname === '/api/v1/health') {
      const health = this.handlers.getHealth();
      this.sendJson(res, 200, {
        ok: true,
        app: 'MyLoad',
        version: '1.0.0',
        ...health,
      });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/v1/focus') {
      this.handlers.onFocusWindow();
      this.sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/v1/intercept') {
      let bodyText: string;
      try {
        bodyText = await readBodyLimited(req, MAX_BODY_BYTES);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          this.sendJson(res, 413, { ok: false, error: 'Payload too large' });
          return;
        }
        this.sendJson(res, 400, { ok: false, error: 'Invalid request body' });
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        this.sendJson(res, 400, { ok: false, error: 'Malformed JSON payload' });
        return;
      }

      const rawUrl = typeof parsed.url === 'string' ? parsed.url.trim() : '';
      if (!rawUrl || (!isHttpUrl(rawUrl) && !isMagnetUri(rawUrl))) {
        this.sendJson(res, 400, {
          ok: false,
          error: 'Unsupported URL scheme (only http, https, and magnet links are accepted)',
        });
        return;
      }

      const rawFileName =
        typeof parsed.fileName === 'string' && parsed.fileName.trim()
          ? sanitizeFileName(path.basename(parsed.fileName.trim()))
          : undefined;

      const rawRelated = Array.isArray(parsed.relatedParts) ? parsed.relatedParts : [];
      const relatedParts: Array<{ url: string; fileName?: string }> = [];
      for (const entry of rawRelated.slice(0, 100)) {
        if (!entry || typeof entry !== 'object') continue;
        const obj = entry as Record<string, unknown>;
        const partUrl = typeof obj.url === 'string' ? obj.url.trim() : '';
        if (!partUrl || !isHttpUrl(partUrl)) continue;
        const partName =
          typeof obj.fileName === 'string' && obj.fileName.trim()
            ? sanitizeFileName(path.basename(obj.fileName.trim()))
            : undefined;
        relatedParts.push({ url: partUrl, fileName: partName });
      }

      const rawReferrer =
        typeof parsed.referrer === 'string' ? sanitizeHeaderValue(parsed.referrer, 2048) : null;
      const safeReferrer = rawReferrer && isHttpUrl(rawReferrer) ? rawReferrer : undefined;
      const safeCookie =
        typeof parsed.cookie === 'string' ? sanitizeHeaderValue(parsed.cookie, 16384) ?? undefined : undefined;
      const safeUa =
        typeof parsed.userAgent === 'string'
          ? sanitizeHeaderValue(parsed.userAgent, 512) ?? undefined
          : undefined;

      const payload: BrowserInterceptPayload = {
        url: rawUrl,
        fileName: rawFileName,
        referrer: safeReferrer,
        cookie: safeCookie,
        userAgent: safeUa,
        fileSize:
          typeof parsed.fileSize === 'number' && Number.isFinite(parsed.fileSize) && parsed.fileSize >= 0
            ? parsed.fileSize
            : null,
        mime:
          typeof parsed.mime === 'string' && parsed.mime.trim()
            ? parsed.mime.trim()
            : undefined,
        relatedParts: relatedParts.length > 0 ? relatedParts : undefined,
      };

      const mode = await this.handlers.onIntercept(payload);
      this.sendJson(res, 200, { ok: true, mode });
      return;
    }

    this.sendJson(res, 404, { ok: false, error: 'Endpoint not found' });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(statusCode);
    res.end(JSON.stringify(body));
  }
}

class PayloadTooLargeError extends Error {}

function readBodyLimited(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        settled = true;
        req.destroy();
        reject(new PayloadTooLargeError('Payload exceeds limit'));
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

