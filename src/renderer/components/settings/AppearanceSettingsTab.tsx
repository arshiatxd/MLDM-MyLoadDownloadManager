import { Palette, Save, Trash2 } from 'lucide-react';
import {
  DEFAULT_DARK_CUSTOM_COLORS,
  DEFAULT_LIGHT_CUSTOM_COLORS,
} from '../../../shared/constants';
import type {
  AppSettings,
  CustomTheme,
  CustomThemeColors,
  FontScale,
  ThemeMode,
} from '../../../shared/types';
import { RgbColorWheel } from '../RgbColorWheel';

export type ThemeSectionKey = keyof CustomThemeColors;

const THEME_SECTIONS: Array<{ key: ThemeSectionKey; label: string }> = [
  { key: 'bgCanvas', label: 'Background' },
  { key: 'bgSurface', label: 'Panels & Cards' },
  { key: 'bgElevated', label: 'Controls & Inputs' },
  { key: 'accent', label: 'Buttons & Accent' },
  { key: 'textPrimary', label: 'Primary Text' },
  { key: 'textSecondary', label: 'Secondary Text' },
  { key: 'borderSubtle', label: 'Borders' },
];

interface AppearanceSettingsTabProps {
  settings: AppSettings;
  selectedSection: ThemeSectionKey;
  editingThemeId: string | null;
  themeNameDraft: string;
  draftColors: CustomThemeColors;
  onSelectSection: (key: ThemeSectionKey) => void;
  onThemeNameDraftChange: (name: string) => void;
  onDraftColorChange: (hex: string) => void;
  onReplaceDraftColors: (colors: CustomThemeColors) => void;
  onSaveCustomTheme: () => void;
  onStartNewCustomTheme: () => void;
  onApplySavedTheme: (theme: CustomTheme) => void;
  onDeleteSavedTheme: (id: string) => void;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onPreviewCustomColors: (colors: CustomThemeColors | null) => void;
}

export function AppearanceSettingsTab({
  settings,
  selectedSection,
  editingThemeId,
  themeNameDraft,
  draftColors,
  onSelectSection,
  onThemeNameDraftChange,
  onDraftColorChange,
  onReplaceDraftColors,
  onSaveCustomTheme,
  onStartNewCustomTheme,
  onApplySavedTheme,
  onDeleteSavedTheme,
  onUpdate,
  onPreviewCustomColors,
}: AppearanceSettingsTabProps) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Theme Mode</h3>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {(
            [
              { id: 'dark', label: 'Dark mode', desc: 'Low-glare dark workspace' },
              { id: 'light', label: 'Light mode', desc: 'Clean bright workspace' },
              { id: 'system', label: 'System', desc: 'Follows Windows theme' },
              {
                id: 'high-contrast',
                label: 'High Contrast',
                desc: 'Maximum contrast & focus rings',
              },
              {
                id: 'custom',
                label: 'Custom',
                desc: 'Build & save RGB themes',
              },
            ] as Array<{ id: ThemeMode; label: string; desc: string }>
          ).map((opt) => {
            const active = settings.theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  if (opt.id !== 'custom') {
                    onPreviewCustomColors(null);
                    onUpdate({ theme: opt.id });
                  } else {
                    onUpdate({ theme: 'custom' });
                    onPreviewCustomColors(draftColors);
                  }
                }}
                className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 hover:bg-[var(--bg-hover)]'
                }`}
              >
                <div className="font-semibold text-[var(--text-primary)]">{opt.label}</div>
                <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
            <Palette className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
            <span>Custom RGB Theme Builder</span>
          </h3>
          <div className="flex items-center gap-1.5 text-[12px]">
            <button
              type="button"
              onClick={() => onReplaceDraftColors({ ...DEFAULT_DARK_CUSTOM_COLORS })}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              Start from Dark mode
            </button>
            <button
              type="button"
              onClick={() => onReplaceDraftColors({ ...DEFAULT_LIGHT_CUSTOM_COLORS })}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              Start from Light mode
            </button>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3.5">
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">
              1. Select app section to customize
            </div>
            <div className="flex flex-wrap gap-1.5">
              {THEME_SECTIONS.map((sec) => {
                const selected = selectedSection === sec.key;
                return (
                  <button
                    key={sec.key}
                    type="button"
                    onClick={() => onSelectSection(sec.key)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-[var(--border-strong)]"
                      style={{ backgroundColor: draftColors[sec.key] }}
                      aria-hidden="true"
                    />
                    <span>{sec.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[12px] font-medium text-[var(--text-secondary)]">
              2. Pick color on RGB wheel for{' '}
              <strong className="text-[var(--text-primary)]">
                {THEME_SECTIONS.find((s) => s.key === selectedSection)?.label}
              </strong>
            </div>
            <RgbColorWheel color={draftColors[selectedSection]} onChange={onDraftColorChange} />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
            <input
              type="text"
              value={themeNameDraft}
              onChange={(e) => onThemeNameDraftChange(e.target.value)}
              placeholder="Theme name..."
              aria-label="Custom theme name"
              className="ml-input h-9 min-w-[160px] flex-1 bg-[var(--bg-surface)]"
            />
            <button
              type="button"
              onClick={onSaveCustomTheme}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              <span>{editingThemeId ? 'Update & Apply' : 'Save & Apply'}</span>
            </button>
            {editingThemeId && (
              <button
                type="button"
                onClick={onStartNewCustomTheme}
                className="h-9 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                Save as New
              </button>
            )}
          </div>

          {settings.customThemes.length > 0 && (
            <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
              <div className="text-[12px] font-medium text-[var(--text-secondary)]">
                Saved Custom Themes
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {settings.customThemes.map((theme) => {
                  const isActive =
                    settings.theme === 'custom' && settings.activeCustomThemeId === theme.id;
                  return (
                    <div
                      key={theme.id}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 ${
                        isActive
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onApplySavedTheme(theme)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                      >
                        <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
                          {[theme.colors.bgCanvas, theme.colors.bgSurface, theme.colors.accent].map(
                            (swatch, idx) => (
                              <span
                                key={idx}
                                className="h-3.5 w-3.5 rounded-full border border-[var(--border-strong)]"
                                style={{ backgroundColor: swatch }}
                              />
                            )
                          )}
                        </span>
                        <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                          {theme.name}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSavedTheme(theme.id)}
                        title={`Delete ${theme.name}`}
                        aria-label={`Delete ${theme.name}`}
                        className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Accessibility</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[var(--text-secondary)]">UI Text Size</label>
            <div className="inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
              {(['compact', 'default', 'large'] as FontScale[]).map((scale) => (
                <button
                  key={scale}
                  type="button"
                  onClick={() => onUpdate({ fontScale: scale })}
                  className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium capitalize cursor-pointer ${
                    settings.fontScale === scale
                      ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {scale}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={(e) => onUpdate({ reducedMotion: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Reduce UI motion and transitions</span>
          </label>
        </div>
      </section>
    </div>
  );
}

