import { useEffect, useId, useRef, useState } from 'react';
import type { Place } from '@routewise/shared';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { recentPlacesStore, type RecentPlace } from '../lib/storage';
import { Icon } from './Icon';

interface Props {
  label: string;
  placeholder: string;
  value: Place | RecentPlace | null;
  onChange: (place: Place | null) => void;
  near?: { lat: number; lng: number } | null;
  autoFocus?: boolean;
}

function isPlace(value: Place | RecentPlace | null): value is Place {
  return Boolean(value && 'displayName' in value && 'provider' in value);
}

function kindIcon(kind: string | undefined) {
  switch (kind) {
    case 'stop':
    case 'station':
      return 'train' as const;
    case 'city':
      return 'pin' as const;
    case 'address':
      return 'home' as const;
    case 'coordinate':
      return 'locate' as const;
    default:
      return 'pin' as const;
  }
}

export function PlaceSearch({ label, placeholder, value, onChange, near, autoFocus }: Props) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await api.geocode(query.trim(), {
          lang: locale,
          near: near ?? undefined,
          limit: 8,
        });
        if (!controller.signal.aborted) {
          setResults(response.places);
          setActiveIndex(-1);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : t('common.error'));
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, locale, near, t]);

  const displayValue = value?.displayName ?? '';
  const recents = recentPlacesStore.all();

  const selectPlace = (place: Place) => {
    onChange(place);
    recentPlacesStore.add({
      name: place.name,
      displayName: place.displayName,
      location: place.location,
      kind: place.kind,
    });
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  };

  const chooseRecent = (place: RecentPlace) =>
    selectPlace({
      id: `recent:${place.name}`,
      name: place.name,
      displayName: place.displayName,
      location: place.location,
      kind: 'other',
      provider: 'recent',
    });

  return (
    <div className="relative">
      <label className="label" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <div className="relative">
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          className="input pl-9 pr-16"
          placeholder={placeholder}
          value={open ? query : displayValue}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (event.target.value === '') onChange(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Home') {
              setActiveIndex(0);
            } else if (event.key === 'End') {
              setActiveIndex(results.length - 1);
            } else if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
              event.preventDefault();
              selectPlace(results[activeIndex]!);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          onBlur={() => {
            // Delay so a click on a result lands before the list closes.
            window.setTimeout(() => setOpen(false), 160);
          }}
        />
        {loading ? (
          <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-ink-300 border-t-transparent" />
        ) : value ? (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[11px] font-semibold text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
            onClick={() => {
              onChange(null);
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label={t('form.clear')}
          >
            {t('form.clear')}
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-lift animate-fade-up"
        >
          {!loading && query.trim().length < 2 && recents.length > 0 ? (
            <>
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">{t('search.recent')}</span>
              </div>
              {recents.map((place, index) => (
                <button
                  key={`${place.name}-${place.location.lat}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-ink-50"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseRecent(place)}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
                    <Icon name="clock" size={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink-900">{place.name}</span>
                    <span className="block truncate text-[11px] text-ink-500">{place.displayName}</span>
                  </span>
                </button>
              ))}
            </>
          ) : null}

          {results.map((place, index) => (
            <button
              key={place.id}
              type="button"
              id={`${listId}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                index === activeIndex ? 'bg-ink-100' : 'hover:bg-ink-50'
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectPlace(place)}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-signal-100 text-signal-700">
                <Icon name={kindIcon(place.kind)} size={13} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-ink-900">{place.name}</span>
                <span className="block truncate text-[11px] text-ink-500">{place.displayName}</span>
              </span>
            </button>
          ))}

          {!loading && query.trim().length >= 2 && results.length === 0 && !error ? (
            <div className="px-3 py-5 text-center text-sm text-ink-500">{t('search.noResults')}</div>
          ) : null}
          {error ? <div className="note-danger m-2 text-xs">{error}</div> : null}
          <div className="flex items-center justify-between border-t border-line bg-raised px-3 py-1.5 text-[10px] text-ink-400">
            <span>OpenStreetMap · Nominatim</span>
            <span className="hidden sm:inline">↑↓ · ↵</span>
          </div>
        </div>
      ) : null}

      {isPlace(value) && value.cityName && value.cityName !== value.name ? (
        <p className="mt-1 truncate text-[11px] text-ink-400">{value.cityName}</p>
      ) : null}
    </div>
  );
}
