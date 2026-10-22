import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Place } from '@routewise/shared';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { recentPlacesStore, type RecentPlace } from '../lib/storage';
import { setPendingPlace } from '../lib/handoff';
import { Icon, type IconName } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  onShowShortcuts?: () => void;
}

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

export function CommandPalette({ open, onClose, onShowShortcuts }: Props) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recent] = useState<RecentPlace[]>(() => recentPlacesStore.all());

  const actions = useMemo<Action[]>(
    () => [
      { id: 'plan', label: t('nav.plan'), hint: t('app.tagline'), icon: 'route', run: () => navigate('/') },
      { id: 'explore', label: t('nav.explore'), hint: t('explore.subtitle'), icon: 'globe', run: () => navigate('/explore') },
      { id: 'reports', label: t('nav.reports'), hint: t('reports.subtitle'), icon: 'flag', run: () => navigate('/reports') },
      { id: 'saved', label: t('nav.saved'), hint: t('saved.subtitle'), icon: 'bookmark', run: () => navigate('/saved') },
      { id: 'settings', label: t('nav.settings'), hint: t('settings.heading'), icon: 'sliders', run: () => navigate('/settings') },
    ],
    [navigate, t],
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.geocode(query.trim(), { lang: locale, limit: 6 });
        setResults(response.places);
        setActive(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query, open, locale]);

  if (!open) return null;

  const choosePlace = (place: Place) => {
    setPendingPlace(place, 'destination');
    onClose();
    navigate('/');
  };

  const rows: Array<{ kind: 'place'; place: Place } | { kind: 'action'; action: Action } | { kind: 'recent'; place: RecentPlace }> =
    query.trim().length >= 2
      ? results.map((place) => ({ kind: 'place' as const, place }))
      : [
          ...recent.slice(0, 4).map((place) => ({ kind: 'recent' as const, place })),
          ...actions.map((action) => ({ kind: 'action' as const, action })),
        ];

  const run = (row: (typeof rows)[number]) => {
    if (row.kind === 'place') choosePlace(row.place);
    else if (row.kind === 'action') {
      row.action.run();
      onClose();
    } else {
      choosePlace({
        id: `recent:${row.place.name}`,
        name: row.place.name,
        displayName: row.place.displayName,
        location: row.place.location,
        kind: 'other',
        provider: 'recent',
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center px-3 pt-[12vh] sm:pt-[16vh]" role="dialog" aria-modal="true" aria-label={t('cmd.open')}>
      <button type="button" className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" aria-label={t('common.close')} onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-lift animate-fade-up">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="search" size={18} className="text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, rows.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter' && rows[active]) {
                event.preventDefault();
                run(rows[active]!);
              }
            }}
            placeholder={t('cmd.placeholder')}
            className="w-full bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-results"
            aria-activedescendant={`cmd-row-${active}`}
          />
          <kbd className="rounded border border-line bg-ink-50 px-1.5 py-0.5 text-[10px] font-semibold text-ink-400">Esc</kbd>
        </div>

        <ul id="cmd-results" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {query.trim().length < 2 && recent.length > 0 ? (
            <li className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">{t('search.recent')}</li>
          ) : null}
          {rows.map((row, index) => {
            const selected = index === active;
            const id = `cmd-row-${index}`;
            if (row.kind === 'action') {
              return (
                <li key={`a-${row.action.id}`} role="option" aria-selected={selected} id={id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(row)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${selected ? 'bg-ink-100' : ''}`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-canvas">
                      <Icon name={row.action.icon} size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink-900">{row.action.label}</span>
                      {row.action.hint ? <span className="block truncate text-xs text-ink-500">{row.action.hint}</span> : null}
                    </span>
                  </button>
                </li>
              );
            }
            const place = row.place;
            return (
              <li key={`${row.kind}-${place.name}-${place.location.lat}`} role="option" aria-selected={selected} id={id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(row)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${selected ? 'bg-ink-100' : ''}`}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-100 text-signal-700">
                    <Icon name={row.kind === 'recent' ? 'clock' : 'pin'} size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink-900">{place.name}</span>
                    <span className="block truncate text-xs text-ink-500">{place.displayName}</span>
                  </span>
                  <Icon name="arrow-right" size={16} className="ml-auto shrink-0 text-ink-300" />
                </button>
              </li>
            );
          })}
          {query.trim().length >= 2 && !loading && results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-ink-500">{t('search.noResults')}</li>
          ) : null}
          {loading ? (
            <li className="flex items-center gap-2 px-3 py-6 text-sm text-ink-500">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-300 border-t-transparent" />
              {t('common.loading')}
            </li>
          ) : null}
        </ul>

        <div className="flex items-center justify-between border-t border-line bg-raised px-4 py-2 text-[11px] text-ink-400">
          <button
            type="button"
            className="hover:text-ink-700"
            onClick={() => {
              onShowShortcuts?.();
            }}
          >
            {t('cmd.hint')}
          </button>
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-line px-1.5 py-0.5">↑</kbd>
            <kbd className="rounded border border-line px-1.5 py-0.5">↓</kbd>
            <kbd className="rounded border border-line px-1.5 py-0.5">↵</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
