import { DEFAULT_DARK_CUSTOM_COLORS, deriveAccentTokens } from '../../shared/constants';
import { getLanguageDir } from '../../shared/i18n';
import type { AppSettings, CustomThemeColors } from '../../shared/types';

const CUSTOM_VAR_KEYS = [
  '--bg-canvas',
  '--bg-surface',
  '--bg-elevated',
  '--bg-hover',
  '--bg-selected',
  '--border-subtle',
  '--border-strong',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--accent',
  '--accent-hover',
  '--accent-active',
  '--accent-soft',
  '--accent-text',
  '--accent-contrast',
  '--focus-ring',
];

function clearInlineTheme(root: HTMLElement): void {
  for (const key of CUSTOM_VAR_KEYS) {
    root.style.removeProperty(key);
  }
}

function applyCustomColors(root: HTMLElement, colors: CustomThemeColors): void {
  const derived = deriveAccentTokens(colors.accent, colors.bgSurface);
  root.style.setProperty('--bg-canvas', colors.bgCanvas);
  root.style.setProperty('--bg-surface', colors.bgSurface);
  root.style.setProperty('--bg-elevated', colors.bgElevated);
  root.style.setProperty('--bg-hover', derived.hoverBg);
  root.style.setProperty('--bg-selected', derived.soft);
  root.style.setProperty('--border-subtle', colors.borderSubtle);
  root.style.setProperty('--border-strong', colors.borderSubtle);
  root.style.setProperty('--text-primary', colors.textPrimary);
  root.style.setProperty('--text-secondary', colors.textSecondary);
  root.style.setProperty('--text-muted', colors.textSecondary);
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--accent-hover', derived.hover);
  root.style.setProperty('--accent-active', derived.active);
  root.style.setProperty('--accent-soft', derived.soft);
  root.style.setProperty('--accent-text', derived.text);
  root.style.setProperty('--accent-contrast', derived.contrast);
  root.style.setProperty('--focus-ring', derived.text);
}

export function applyDocumentAppearance(
  settings: AppSettings,
  previewCustomColors: CustomThemeColors | null = null
): () => void {
  const root = document.documentElement;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  const applyTheme = () => {
    if (previewCustomColors) {
      root.setAttribute('data-theme', 'dark');
      applyCustomColors(root, previewCustomColors);
      return;
    }

    if (settings.theme === 'custom') {
      const activeCustom =
        settings.customThemes.find((item) => item.id === settings.activeCustomThemeId) ??
        settings.customThemes[0];
      root.setAttribute('data-theme', 'dark');
      applyCustomColors(root, activeCustom ? activeCustom.colors : DEFAULT_DARK_CUSTOM_COLORS);
      return;
    }

    clearInlineTheme(root);
    const resolved =
      settings.theme === 'system' ? (mq.matches ? 'dark' : 'light') : settings.theme;
    root.setAttribute('data-theme', resolved);
  };

  applyTheme();
  root.setAttribute('data-font-scale', settings.fontScale);
  root.setAttribute('data-reduced-motion', String(settings.reducedMotion));
  root.setAttribute('dir', getLanguageDir(settings.language));
  root.setAttribute('lang', settings.language);

  if (settings.theme === 'system' && !previewCustomColors) {
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }

  return () => undefined;
}

