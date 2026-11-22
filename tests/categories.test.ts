import { describe, expect, it } from 'vitest';
import {
  classifyFileName,
  matchesCategory,
  sortDownloads,
} from '../src/shared/categories';
import type { DownloadItem } from '../src/shared/types';

function makeItem(overrides: Partial<DownloadItem>): DownloadItem {
  return {
    id: '1',
    kind: 'http',
    source: 'https://example.com/file.bin',
    name: 'file.bin',
    saveDir: 'C:/Downloads',
    filePath: 'C:/Downloads/file.bin',
    category: 'other',
    status: 'completed',
    totalBytes: 1000,
    downloadedBytes: 1000,
    uploadedBytes: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    etaSeconds: null,
    resumeSupported: true,
    segments: [],
    addedAt: 1000,
    retryCount: 0,
    ...overrides,
  };
}

describe('categories and sorting', () => {
  it('classifies common file types accurately', () => {
    expect(classifyFileName('photo.JPG')).toBe('images');
    expect(classifyFileName('report.pdf')).toBe('docs');
    expect(classifyFileName('notes.md')).toBe('docs');
    expect(classifyFileName('backup.tar.gz')).toBe('archives');
    expect(classifyFileName('movie.mkv')).toBe('videos');
    expect(classifyFileName('ubuntu.iso')).toBe('archives');
    expect(classifyFileName('linux.torrent')).toBe('torrents');
    expect(classifyFileName('anything.bin', 'torrent')).toBe('torrents');
    expect(classifyFileName('setup.exe')).toBe('other');
    expect(classifyFileName('README')).toBe('other');
  });

  it('matches items against smart and file categories', () => {
    const activeHttp = makeItem({
      id: 'a',
      status: 'downloading',
      category: 'images',
      downloadedBytes: 500,
    });
    const completedDoc = makeItem({
      id: 'b',
      status: 'completed',
      category: 'docs',
    });
    const seedingTorrent = makeItem({
      id: 'c',
      kind: 'torrent',
      status: 'seeding',
      category: 'torrents',
    });

    expect(matchesCategory(activeHttp, 'all')).toBe(true);
    expect(matchesCategory(activeHttp, 'active')).toBe(true);
    expect(matchesCategory(activeHttp, 'completed')).toBe(false);
    expect(matchesCategory(activeHttp, 'images')).toBe(true);

    expect(matchesCategory(completedDoc, 'completed')).toBe(true);
    expect(matchesCategory(completedDoc, 'active')).toBe(false);
    expect(matchesCategory(completedDoc, 'docs')).toBe(true);

    expect(matchesCategory(seedingTorrent, 'torrents')).toBe(true);
    expect(matchesCategory(seedingTorrent, 'completed')).toBe(true);
    expect(matchesCategory(seedingTorrent, 'active')).toBe(true);
  });

  it('sorts downloads by newest, name, size, and progress', () => {
    const a = makeItem({
      id: 'a',
      name: 'Zebra.zip',
      addedAt: 100,
      totalBytes: 500,
      downloadedBytes: 500,
      status: 'completed',
    });
    const b = makeItem({
      id: 'b',
      name: 'Alpha.pdf',
      addedAt: 300,
      totalBytes: 2000,
      downloadedBytes: 500,
      status: 'paused',
    });
    const c = makeItem({
      id: 'c',
      name: 'Mango.mp4',
      addedAt: 200,
      totalBytes: 1000,
      downloadedBytes: 800,
      status: 'downloading',
    });

    expect(sortDownloads([a, b, c], 'newest').map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortDownloads([a, b, c], 'oldest').map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(sortDownloads([a, b, c], 'name').map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortDownloads([a, b, c], 'size').map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortDownloads([a, b, c], 'progress').map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });
});

