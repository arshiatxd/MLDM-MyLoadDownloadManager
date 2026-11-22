import { useEffect, useState } from 'react';
import {
  Accessibility,
  Gauge,
  Power,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  X,
} from 'lucide-react';
import { DEFAULT_DARK_CUSTOM_COLORS } from '../../shared/constants';
import { t } from '../../shared/i18n';
import type {
  AppSettings,
  BridgeStatus,
  CustomTheme,
  CustomThemeColors,
  ThemeMode,
  UpdateStatus,
} from '../../shared/types';
import { AppearanceSettingsTab, type ThemeSectionKey } from './settings/AppearanceSettingsTab';
import { GeneralSettingsTab } from './settings/GeneralSettingsTab';
import { PowerSettingsTab } from './settings/PowerSettingsTab';
import { SpeedSettingsTab } from './settings/SpeedSettingsTab';

interface SettingsModalProps {
  open: boolean;
  appVersion: string;
  updateStatus: UpdateStatus;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onReset: () => void;
  onPreviewCustomColors: (colors: CustomThemeColors | null) => void;
  onOpenPrivacy: () => void;
  onUpdateNow: () => void;
}

type SettingsTab = 'general' | 'speed' | 'power' | 'appearance';

export function SettingsModal({
  open,
  appVersion,
  updateStatus,
  settings,
  onClose,
  onUpdate,
  onReset,
  onPreviewCustomColors,
  onOpenPrivacy,
  onUpdateNow,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);

  const [selectedSection, setSelectedSection] = useState<ThemeSectionKey>('accent');
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [themeNameDraft, setThemeNameDraft] = useState('My Theme');
  const [draftColors, setDraftColors] = useState<CustomThemeColors>(DEFAULT_DARK_CUSTOM_COLORS);

  useEffect(() => {
    if (!open) {
      onPreviewCustomColors(null);
      return;
    }
    const activeSaved = settings.customThemes.find(
      (th) => th.id === settings.activeCustomThemeId
    );
    if (activeSaved) {
      setEditingThemeId(activeSaved.id);
      setThemeNameDraft(activeSaved.name);
      setDraftColors({ ...activeSaved.colors });
    } else {
      setEditingThemeId(null);
      setThemeNameDraft('My Theme');
      setDraftColors({ ...DEFAULT_DARK_CUSTOM_COLORS });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const refreshBridge = () => {
      void window.myload.getBridgeStatus().then((st) => {
        if (active) setBridgeStatus(st);
      });
    };
    refreshBridge();
    const timer = setInterval(refreshBridge, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, settings.browserBridgeEnabled, settings.browserBridgePort]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onPreviewCustomColors(null);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onPreviewCustomColors]);

  if (!open) return null;

  const handleDraftColorChange = (hex: string) => {
    const updated: CustomThemeColors = {
      ...draftColors,
      [selectedSection]: hex,
    };
    setDraftColors(updated);
    onPreviewCustomColors(updated);
  };

  const handleSaveCustomTheme = () => {
    const cleanName = themeNameDraft.trim() || `Custom ${settings.customThemes.length + 1}`;
    const existing = editingThemeId
      ? settings.customThemes.find((th) => th.id === editingThemeId)
      : undefined;

    if (existing) {
      const nextList = settings.customThemes.map((th) =>
        th.id === existing.id ? { ...th, name: cleanName, colors: { ...draftColors } } : th
      );
      onUpdate({
        theme: 'custom',
        customThemes: nextList,
        activeCustomThemeId: existing.id,
      });
    } else {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `theme-${Date.now()}`;
      const newTheme: CustomTheme = {
        id,
        name: cleanName,
        colors: { ...draftColors },
      };
      setEditingThemeId(id);
      onUpdate({
        theme: 'custom',
        customThemes: [...settings.customThemes, newTheme],
        activeCustomThemeId: id,
      });
    }
    onPreviewCustomColors(null);
  };

  const handleApplySavedTheme = (theme: CustomTheme) => {
    setEditingThemeId(theme.id);
    setThemeNameDraft(theme.name);
    setDraftColors({ ...theme.colors });
    onPreviewCustomColors(null);
    onUpdate({
      theme: 'custom',
      activeCustomThemeId: theme.id,
    });
  };

  const handleDeleteSavedTheme = (id: string) => {
    const nextList = settings.customThemes.filter((th) => th.id !== id);
    const nextActiveId =
      settings.activeCustomThemeId === id
        ? nextList[0]?.id ?? null
        : settings.activeCustomThemeId;
    const nextMode: ThemeMode =
      settings.theme === 'custom' && !nextActiveId ? 'dark' : settings.theme;
    if (editingThemeId === id) {
      setEditingThemeId(nextActiveId);
      setThemeNameDraft('My Theme');
    }
    onPreviewCustomColors(null);
    onUpdate({
      customThemes: nextList,
      activeCustomThemeId: nextActiveId,
      theme: nextMode,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="animate-modal-in flex h-[640px] max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <h2 id="settings-modal-title" className="text-base font-semibold text-[var(--text-primary)]">
            {t(settings.language, 'preferences')}
          </h2>
          <button
            type="button"
            onClick={() => {
              onPreviewCustomColors(null);
              onClose();
            }}
            aria-label="Close preferences"
            className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Preference sections"
            className="flex w-52 shrink-0 flex-col gap-1 border-r border-[var(--border-subtle)] bg-[var(--bg-canvas)]/75 p-2.5 text-[13px]"
          >
            {[
              { id: 'general' as const, label: t(settings.language, 'generalTab'), icon: SettingsIcon },
              { id: 'speed' as const, label: t(settings.language, 'speedTab'), icon: Gauge },
              { id: 'power' as const, label: t(settings.language, 'powerTab'), icon: Power },
              { id: 'appearance' as const, label: t(settings.language, 'appearanceTab'), icon: Accessibility },
            ].map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <div className="mt-auto px-3 pt-2">
              <div className="font-mono text-[11.5px] text-[var(--text-muted)]/65 select-none">
                v{appVersion}
              </div>
              {updateStatus.state === 'available' && updateStatus.latestVersion && (
                <button
                  type="button"
                  onClick={onUpdateNow}
                  className="mt-0.5 text-left font-mono text-[11px] font-medium text-[var(--accent-text)] hover:underline cursor-pointer"
                >
                  v{updateStatus.latestVersion} available
                </button>
              )}
            </div>
          </nav>

          <div
            key={tab}
            className="animate-settings-tab min-h-0 flex-1 overflow-y-auto p-5 text-[13px]"
          >
            {tab === 'general' && (
              <GeneralSettingsTab
                settings={settings}
                bridgeStatus={bridgeStatus}
                onUpdate={onUpdate}
              />
            )}
            {tab === 'speed' && <SpeedSettingsTab settings={settings} onUpdate={onUpdate} />}
            {tab === 'power' && <PowerSettingsTab settings={settings} onUpdate={onUpdate} />}
            {tab === 'appearance' && (
              <AppearanceSettingsTab
                settings={settings}
                selectedSection={selectedSection}
                editingThemeId={editingThemeId}
                themeNameDraft={themeNameDraft}
                draftColors={draftColors}
                onSelectSection={setSelectedSection}
                onThemeNameDraftChange={setThemeNameDraft}
                onDraftColorChange={handleDraftColorChange}
                onReplaceDraftColors={(colors) => {
                  setDraftColors(colors);
                  onPreviewCustomColors(colors);
                }}
                onSaveCustomTheme={handleSaveCustomTheme}
                onStartNewCustomTheme={() => {
                  setEditingThemeId(null);
                  setThemeNameDraft(`Custom ${settings.customThemes.length + 1}`);
                }}
                onApplySavedTheme={handleApplySavedTheme}
                onDeleteSavedTheme={handleDeleteSavedTheme}
                onUpdate={onUpdate}
                onPreviewCustomColors={onPreviewCustomColors}
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-5 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>{t(settings.language, 'resetDefaults')}</span>
            </button>
            <button
              type="button"
              onClick={onOpenPrivacy}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <ShieldCheck className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
              <span>{t(settings.language, 'privacyPolicy')}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              onPreviewCustomColors(null);
              onClose();
            }}
            className="h-9 rounded-xl bg-[var(--accent)] px-5 text-[13px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
          >
            {t(settings.language, 'done')}
          </button>
        </div>
      </div>
    </div>
  );
}

