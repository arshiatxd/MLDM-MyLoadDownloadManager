import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DARK_CUSTOM_COLORS,
  DEFAULT_FILTER_TAB_ORDER,
  FILE_CATEGORIES,
  createDefaultCategoryDirs,
  createDefaultSettings,
  normalizeHexColor,
} from '../shared/constants';
import type {
  AppSettings,
  CategoryDownloadDirs,
  CategoryId,
  CustomTheme,
  DownloadItem,
} from '../shared/types';

export interface PersistedState {
  version: number;
  downloads: DownloadItem[];
  settings: AppSettings;
}

const VALID_CATEGORY_SET = new Set<CategoryId>(DEFAULT_FILTER_TAB_ORDER);

export function normalizeFilterTabOrder(order: unknown): CategoryId[] {
  const result: CategoryId[] = [];
  const seen = new Set<CategoryId>();
  if (Array.isArray(order)) {
    for (const item of order) {
      if (typeof item === 'string' && VALID_CATEGORY_SET.has(item as CategoryId) && !seen.has(item as CategoryId)) {
        seen.add(item as CategoryId);
        result.push(item as CategoryId);
      }
    }
  }
  for (const fallback of DEFAULT_FILTER_TAB_ORDER) {
    if (!seen.has(fallback)) {
      seen.add(fallback);
      result.push(fallback);
    }
  }
  return result;
}

export function normalizeDownloadsOnLoad(
  downloads: DownloadItem[],
  autoResumeOnStart: boolean,
  keepSeedingAfterComplete: boolean
): DownloadItem[] {
  return downloads.map((item) => {
    const segments = (item.segments ?? []).map((seg) => ({
      ...seg,
      speed: 0,
      status: seg.status === 'active' || seg.status === 'error' ? 'pending' : seg.status,
    }));

    let status = item.status;
    let errorMessage = item.errorMessage;
    if (status === 'downloading' || status === 'probing' || status === 'queued') {
      if (item.kind === 'media') {
        status = 'error';
        errorMessage = 'Interrupted when app closed — start again from the browser extension';
      } else {
        status = autoResumeOnStart ? 'queued' : 'paused';
      }
    } else if (status === 'seeding') {
      status = keepSeedingAfterComplete ? (autoResumeOnStart ? 'seeding' : 'paused') : 'completed';
    }

    return {
      ...item,
      status,
      errorMessage,
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      segments,
    };
  });
}

export class StateStore {
  private readonly filePath: string;
  private readonly defaultDownloadDir: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string, defaultDownloadDir: string) {
    this.filePath = filePath;
    this.defaultDownloadDir = defaultDownloadDir;
  }

  load(): { downloads: DownloadItem[]; settings: AppSettings } {
    const defaults = createDefaultSettings(this.defaultDownloadDir);

    if (!fs.existsSync(this.filePath)) {
      return { downloads: [], settings: defaults };
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const rawSettings = parsed.settings ?? ({} as Partial<AppSettings>);

      const settings: AppSettings = {
        ...defaults,
        ...rawSettings,

        autoPowerAction: 'off',
        folderRoutingMode:
          rawSettings.folderRoutingMode === 'per-category' ? 'per-category' : 'single',
        categoryDownloadDirs: normalizeCategoryDirs(rawSettings.categoryDownloadDirs),
        recentDirs: Array.isArray(rawSettings.recentDirs) && rawSettings.recentDirs.length > 0
          ? rawSettings.recentDirs.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).slice(0, 10)
          : defaults.recentDirs,
        filterTabOrder: normalizeFilterTabOrder(rawSettings.filterTabOrder),
        customThemes: normalizeCustomThemes(rawSettings.customThemes),
        activeCustomThemeId:
          typeof rawSettings.activeCustomThemeId === 'string'
            ? rawSettings.activeCustomThemeId
            : null,
        gamingModeEnabled: Boolean(rawSettings.gamingModeEnabled),
        gamingModeProfile: rawSettings.gamingModeProfile === 'gaming' ? 'gaming' : 'surfing',
        useCompactDownloadPopup:
          rawSettings.useCompactDownloadPopup !== undefined
            ? Boolean(rawSettings.useCompactDownloadPopup)
            : defaults.useCompactDownloadPopup,
        autoDownloadOnClick: Boolean(rawSettings.autoDownloadOnClick),
        queueMode:
          rawSettings.queueMode === 'sequential' || rawSettings.queueMode === 'parallel-equal'
            ? rawSettings.queueMode
            : 'parallel',
        detectMultiPartEnabled:
          rawSettings.detectMultiPartEnabled !== undefined
            ? Boolean(rawSettings.detectMultiPartEnabled)
            : defaults.detectMultiPartEnabled,
        multiPartDontAskAgain: Boolean(rawSettings.multiPartDontAskAgain),
        multiPartDefaultAction:
          rawSettings.multiPartDefaultAction === 'all' ? 'all' : 'single',
        startOnStartup:
          rawSettings.startOnStartup !== undefined
            ? Boolean(rawSettings.startOnStartup)
            : defaults.startOnStartup,
        autoCheckUpdates:
          rawSettings.autoCheckUpdates !== undefined
            ? Boolean(rawSettings.autoCheckUpdates)
            : defaults.autoCheckUpdates,
        language: isValidLanguage(rawSettings.language) ? rawSettings.language : 'en',
      };

      const rawDownloads = Array.isArray(parsed.downloads) ? parsed.downloads : [];
      const downloads = normalizeDownloadsOnLoad(
        rawDownloads,
        settings.autoResumeOnStart,
        settings.keepSeedingAfterComplete
      );

      return { downloads, settings };
    } catch {
      return { downloads: [], settings: defaults };
    }
  }

  save(downloads: DownloadItem[], settings: AppSettings): Promise<void> {

    const sanitizedDownloads = downloads.map((d) => ({ ...d, requestHeaders: undefined }));
    const payload: PersistedState = {
      version: 1,
      downloads: sanitizedDownloads,
      settings,
    };
    const json = JSON.stringify(payload, null, 2);

    this.writeChain = this.writeChain
      .then(async () => {
        const dir = path.dirname(this.filePath);
        await fs.promises.mkdir(dir, { recursive: true });
        const tempPath = `${this.filePath}.${process.pid}.tmp`;
        await fs.promises.writeFile(tempPath, json, 'utf-8');
        await fs.promises.rename(tempPath, this.filePath);
      })
      .catch(() => {

      });

    return this.writeChain;
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }
}

function normalizeCustomThemes(raw: unknown): CustomTheme[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomTheme[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<CustomTheme>;
    if (typeof obj.id !== 'string' || !obj.id.trim() || typeof obj.name !== 'string' || !obj.name.trim()) {
      continue;
    }
    const c = (obj.colors ?? {}) as Partial<CustomTheme['colors']>;
    out.push({
      id: obj.id,
      name: obj.name.trim().slice(0, 40),
      colors: {
        bgCanvas: normalizeHexColor(String(c.bgCanvas ?? ''), DEFAULT_DARK_CUSTOM_COLORS.bgCanvas),
        bgSurface: normalizeHexColor(String(c.bgSurface ?? ''), DEFAULT_DARK_CUSTOM_COLORS.bgSurface),
        bgElevated: normalizeHexColor(String(c.bgElevated ?? ''), DEFAULT_DARK_CUSTOM_COLORS.bgElevated),
        accent: normalizeHexColor(String(c.accent ?? ''), DEFAULT_DARK_CUSTOM_COLORS.accent),
        textPrimary: normalizeHexColor(String(c.textPrimary ?? ''), DEFAULT_DARK_CUSTOM_COLORS.textPrimary),
        textSecondary: normalizeHexColor(String(c.textSecondary ?? ''), DEFAULT_DARK_CUSTOM_COLORS.textSecondary),
        borderSubtle: normalizeHexColor(String(c.borderSubtle ?? ''), DEFAULT_DARK_CUSTOM_COLORS.borderSubtle),
      },
    });
  }
  return out.slice(0, 24);
}

function normalizeCategoryDirs(raw: unknown): CategoryDownloadDirs {
  const result = createDefaultCategoryDirs();
  if (!raw || typeof raw !== 'object') return result;
  const obj = raw as Partial<Record<string, unknown>>;
  for (const cat of FILE_CATEGORIES) {
    const val = obj[cat];
    if (typeof val === 'string') {
      result[cat] = val.trim();
    }
  }
  return result;
}

function isValidLanguage(lang: unknown): lang is AppSettings['language'] {
  return (
    typeof lang === 'string' &&
    ['en', 'fa', 'es', 'fr', 'de', 'ru', 'zh', 'ar', 'tr'].includes(lang)
  );
}

