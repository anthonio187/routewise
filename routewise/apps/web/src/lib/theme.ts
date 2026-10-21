import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { settingsStore, type AppSettings, type ThemePreference } from './storage';

/** Reactive settings: any component that calls this re-renders on change. */
export function useSettings(): AppSettings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);
}

export function useTheme() {
  const settings = useSettings();
  const preference = settings.theme ?? 'system';
  const setPreference = useCallback((theme: ThemePreference) => {
    settingsStore.set({ theme });
  }, []);
  return { preference, setPreference, resolved: resolveTheme(preference) };
}

export function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return prefersDark() ? 'dark' : 'light';
}

/** Apply the theme to <html>. Called before React mounts to avoid a flash. */
export function applyTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#090d14' : '#f7f8fa');
}

export function applyInitialTheme(): 'light' | 'dark' {
  const stored = settingsStore.get().theme ?? 'system';
  const resolved = resolveTheme(stored);
  applyTheme(resolved);
  return resolved;
}

/** React to OS theme changes while the preference is "system". */
export function useThemeSync(): void {
  const { preference } = useTheme();
  useEffect(() => {
    applyTheme(resolveTheme(preference));
    if (preference !== 'system') return;
    let media: MediaQueryList;
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = () => applyTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);
}

/** Larger base text for low-vision users (respects the design scale). */
export function applyTextScale(larger: boolean): void {
  document.documentElement.style.fontSize = larger ? '17px' : '';
}
