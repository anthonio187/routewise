import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useI18n, noticeText, supportedLanguages, type TranslationKey } from './i18n';
import { useSettings, useTheme, useThemeSync, applyTextScale } from './lib/theme';
import { PlanPage } from './pages/PlanPage';
import { ReportsPage } from './pages/ReportsPage';
import { SavedPage } from './pages/SavedPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharePage } from './pages/SharePage';
import { ExplorePage } from './pages/ExplorePage';
import { Icon, type IconName } from './components/Icon';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsDialog } from './components/ShortcutsDialog';

const NAV: Array<{ to: string; key: TranslationKey; icon: IconName; end: boolean }> = [
  { to: '/', key: 'nav.plan', icon: 'route', end: true },
  { to: '/explore', key: 'nav.explore', icon: 'globe', end: false },
  { to: '/reports', key: 'nav.reports', icon: 'flag', end: false },
  { to: '/saved', key: 'nav.saved', icon: 'bookmark', end: false },
  { to: '/settings', key: 'nav.settings', icon: 'sliders', end: false },
];

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const { resolved, preference, setPreference } = useTheme();
  const settings = useSettings();
  const location = useLocation();
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useThemeSync();

  useEffect(() => {
    applyTextScale(Boolean(settings.largerText));
  }, [settings.largerText]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === '?' && !typing) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const titles: Record<string, TranslationKey> = {
      '/': 'nav.plan',
      '/explore': 'nav.explore',
      '/reports': 'nav.reports',
      '/saved': 'nav.saved',
      '/settings': 'nav.settings',
    };
    const key = titles[location.pathname];
    document.title = key
      ? `${t(key)} · ${t('app.name')}`
      : `${t('app.name')} · ${t('app.tagline')}`;
  }, [location.pathname, t]);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }, [location.pathname]);

  const themeIcon = preference === 'system' ? 'monitor' : resolved === 'dark' ? 'moon' : 'sun';

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lift"
      >
        {t('common.skipToContent')}
      </a>

      <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:h-16 sm:px-6">
          <Link to="/" className="group flex items-center gap-2.5 rounded-xl py-1 pr-2" aria-label={t('app.name')}>
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-ink-900 text-white shadow-sm transition group-hover:scale-105">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="6" cy="18" r="2.4" />
                <circle cx="18" cy="6" r="2.4" />
                <path d="M8.4 18h5.1a3 3 0 0 0 0-6h-3a3 3 0 0 1 0-6h5.1" />
              </svg>
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-extrabold tracking-tight text-ink-900">{t('app.name')}</span>
              <span className="mt-0.5 hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400 sm:block">
                {t('app.beta')}
              </span>
            </span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label={t('nav.main')}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-[13px] font-semibold transition ${
                    isActive
                      ? 'bg-ink-900 text-canvas shadow-sm'
                      : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                  }`
                }
              >
                <Icon name={item.icon} size={16} />
                {t(item.key)}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink-500 transition hover:text-ink-800 sm:flex"
              aria-label={t('cmd.open')}
            >
              <Icon name="search" size={15} />
              <span className="hidden lg:inline">{t('cmd.searchPlaces')}</span>
              <kbd className="rounded border border-line bg-ink-50 px-1.5 py-0.5 text-[10px] font-semibold text-ink-400">
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              className="icon-btn"
              onClick={() => setPreference(preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system')}
              title={t('settings.themeCycle')}
              aria-label={t('settings.themeCycle')}
            >
              <Icon name={themeIcon} size={17} />
            </button>

            <label className="sr-only" htmlFor="header-language">
              {t('common.language')}
            </label>
            <div className="relative">
              <select
                id="header-language"
                className="h-9 appearance-none rounded-xl border border-line bg-surface pl-2.5 pr-7 text-xs font-semibold text-ink-700"
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
                aria-label={t('common.language')}
              >
                {supportedLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.code.toUpperCase()}
                  </option>
                ))}
              </select>
              <Icon
                name="chevron-down"
                size={13}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400"
              />
            </div>
          </div>
        </div>

        {!online ? (
          <div className="note-warn flex items-center justify-center gap-2 rounded-none border-x-0 border-t-0 px-4 py-1.5 text-xs">
            <Icon name="wifi-off" size={14} />
            {t('common.offline')}
          </div>
        ) : null}
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-3 pb-28 pt-4 sm:px-6 sm:pb-10 sm:pt-7">
        <div key={location.pathname} className="page-enter">
        <Routes>
          <Route path="/" element={<PlanPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/share" element={<SharePage />} />
          <Route path="/share/local/:id" element={<SharePage />} />
          <Route path="/share/:slug" element={<SharePage />} />
          <Route
            path="*"
            element={
              <div className="mx-auto max-w-md py-16 text-center">
                <p className="text-5xl font-black text-ink-200">404</p>
                <h1 className="mt-3 text-lg font-bold text-ink-900">{t('common.notFound')}</h1>
                <p className="mt-1 text-sm text-ink-600">{t('share.notFound')}</p>
                <Link to="/" className="btn-primary mt-5 inline-flex">
                  {t('share.openInApp')}
                </Link>
              </div>
            }
          />
        </Routes>
        </div>
      </main>

      <footer className="border-t border-line bg-surface pb-20 md:pb-0">
        <div className="mx-auto max-w-6xl space-y-3 px-4 py-7 text-xs text-ink-500 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="font-bold text-ink-800">{t('app.name')}</span>
            <Link to="/explore" className="hover:text-ink-800">{t('nav.explore')}</Link>
            <Link to="/settings" className="hover:text-ink-800">{t('nav.settings')}</Link>
            <button
              type="button"
              className="hover:text-ink-800"
              onClick={() => setShortcutsOpen(true)}
            >
              {t('keys.title')}
            </button>
            <a className="hover:text-ink-800" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">
              OpenStreetMap
            </a>
            <a className="hover:text-ink-800" href="https://transitous.org/sources/" target="_blank" rel="noreferrer noopener">
              Transitous
            </a>
            <a className="hover:text-ink-800" href="https://www.geonames.org/" target="_blank" rel="noreferrer noopener">
              GeoNames
            </a>
            <a className="hover:text-ink-800" href="https://openfreemap.org/" target="_blank" rel="noreferrer noopener">
              OpenFreeMap
            </a>
          </div>
          <p className="max-w-3xl leading-relaxed">{t('footer.dataNote')}</p>
          <p>{t('footer.rights')}</p>
        </div>
      </footer>

      {/* Mobile bottom navigation — the primary way to move around on a phone. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        aria-label={t('nav.main')}
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 px-1 pb-2 pt-2.5 text-[10px] font-semibold transition ${
                    isActive ? 'text-signal-700' : 'text-ink-400'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex h-7 w-12 items-center justify-center rounded-full transition ${
                        isActive ? 'bg-signal-100 text-signal-700' : ''
                      }`}
                    >
                      <Icon name={item.icon} size={19} strokeWidth={isActive ? 2.2 : 1.8} />
                    </span>
                    <span className="truncate">{t(item.key)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onShowShortcuts={() => {
          setPaletteOpen(false);
          setShortcutsOpen(true);
        }}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

export { noticeText };
