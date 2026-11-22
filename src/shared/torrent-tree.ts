import type { TorrentFileInfo } from './types';

export interface TorrentTreeNode {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  children: TorrentTreeNode[];
  file?: TorrentFileInfo;
  fileIndices: number[];
  totalBytes: number;
  downloadedBytes: number;
}

export function buildTorrentTree(
  files: TorrentFileInfo[],
  filterQuery = ''
): TorrentTreeNode[] {
  const q = filterQuery.trim().toLowerCase();
  const filteredFiles = q
    ? files.filter(
        (f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
      )
    : files;

  interface MutableFolder {
    id: string;
    name: string;
    path: string;
    folders: Map<string, MutableFolder>;
    leaves: TorrentTreeNode[];
  }

  const root: MutableFolder = {
    id: '__root__',
    name: '',
    path: '',
    folders: new Map(),
    leaves: [],
  };

  for (const file of filteredFiles) {
    const rawParts = file.path.split(/[\\/]+/).filter(Boolean);
    const parts = rawParts.length > 0 ? rawParts : [file.name || `file-${file.index}`];
    let current = root;
    let accumPath = '';

    for (let i = 0; i < parts.length - 1; i += 1) {
      const folderName = parts[i];
      accumPath = accumPath ? `${accumPath}/${folderName}` : folderName;
      let childFolder = current.folders.get(folderName);
      if (!childFolder) {
        childFolder = {
          id: `dir:${accumPath}`,
          name: folderName,
          path: accumPath,
          folders: new Map(),
          leaves: [],
        };
        current.folders.set(folderName, childFolder);
      }
      current = childFolder;
    }

    const leafName = parts[parts.length - 1];
    current.leaves.push({
      id: `file:${file.index}`,
      name: leafName,
      path: file.path,
      isFolder: false,
      children: [],
      file,
      fileIndices: [file.index],
      totalBytes: file.length,
      downloadedBytes: Math.min(file.length, file.downloaded),
    });
  }

  const finalize = (folder: MutableFolder): TorrentTreeNode[] => {
    const nodes: TorrentTreeNode[] = [];

    for (const sub of folder.folders.values()) {
      const children = finalize(sub);
      const fileIndices: number[] = [];
      let totalBytes = 0;
      let downloadedBytes = 0;
      for (const ch of children) {
        for (const idx of ch.fileIndices) fileIndices.push(idx);
        totalBytes += ch.totalBytes;
        downloadedBytes += ch.downloadedBytes;
      }
      nodes.push({
        id: sub.id,
        name: sub.name,
        path: sub.path,
        isFolder: true,
        children,
        fileIndices,
        totalBytes,
        downloadedBytes,
      });
    }

    for (const leaf of folder.leaves) {
      nodes.push(leaf);
    }

    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });

    return nodes;
  };

  return finalize(root);
}

