declare module 'parse-torrent' {
  export interface ParsedTorrentFile {
    path: string;
    name: string;
    length: number;
    offset: number;
  }

  export interface ParsedTorrent {
    infoHash: string;
    name?: string;
    dn?: string | string[];
    announce?: string[];
    urlList?: string[];
    length?: number;
    files?: ParsedTorrentFile[];
  }

  export default function parseTorrent(
    torrentId: string | Uint8Array | Buffer | Record<string, unknown>
  ): Promise<ParsedTorrent>;

  export function toMagnetURI(parsed: ParsedTorrent): string;
}

declare module 'webtorrent' {
  import type { EventEmitter } from 'node:events';

  export interface WebTorrentFile extends EventEmitter {
    name: string;
    path: string;
    length: number;
    size: number;
    downloaded: number;
    progress: number;
    done: boolean;
    select(priority?: number): void;
    deselect(): void;
  }

  export interface WebTorrentTorrent extends EventEmitter {
    infoHash: string;
    name: string;
    magnetURI: string;
    path: string;
    length: number;
    downloaded: number;
    uploaded: number;
    downloadSpeed: number;
    uploadSpeed: number;
    progress: number;
    ratio: number;
    numPeers: number;
    timeRemaining: number;
    done: boolean;
    destroyed: boolean;
    paused: boolean;
    announce: string[];
    torrentFile?: Uint8Array;
    pieces?: unknown[];
    files: WebTorrentFile[];
    wires: Array<{
      peerId?: string;
      remoteAddress?: string;
      remotePort?: number;
      downloaded?: number;
      uploaded?: number;
      peerPieces?: { get: (idx: number) => boolean };
    }>;
    addPeer(peer: string): boolean;
    select(start: number, end: number, priority?: number, notify?: () => void): void;
    deselect(start: number, end: number): void;
    destroy(opts?: { destroyStore?: boolean }, cb?: (err?: Error | null) => void): void;
  }

  export interface WebTorrentOptions {
    downloadLimit?: number;
    uploadLimit?: number;
    maxConns?: number;
    utp?: boolean;
    dht?: boolean | Record<string, unknown>;
    tracker?: boolean | Record<string, unknown>;
    lsd?: boolean;
    utPex?: boolean;
    webSeeds?: boolean;
  }

  export interface TorrentAddOptions {
    path?: string;
    deselect?: boolean;
    skipVerify?: boolean;
    storeCacheSlots?: number;
    strategy?: 'rarest' | 'sequential';
    uploads?: number | false;
    maxWebConns?: number;
    announce?: string[];
  }

  export default class WebTorrent extends EventEmitter {
    torrents: WebTorrentTorrent[];
    maxConns: number;
    destroyed: boolean;
    downloadSpeed: number;
    uploadSpeed: number;
    constructor(opts?: WebTorrentOptions);
    add(
      torrentId: string | Uint8Array | Buffer,
      opts?: TorrentAddOptions,
      ontorrent?: (torrent: WebTorrentTorrent) => void
    ): WebTorrentTorrent;
    throttleDownload(rate: number): boolean | void;
    throttleUpload(rate: number): boolean | void;
    destroy(cb?: (err?: Error | null) => void): void;
  }
}

declare module 'create-torrent' {
  export default function createTorrent(
    input: string | string[],
    opts: Record<string, unknown>,
    cb: (err: Error | null, torrent: Buffer) => void
  ): void;
}

