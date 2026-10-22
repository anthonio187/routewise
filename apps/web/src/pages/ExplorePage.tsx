import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiMeta, CitySummary } from '@routewise/shared';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { setPendingPlace } from '../lib/handoff';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';

const PAGE_SIZE = 24;

function formatPopulation(value: number | null | undefined, locale: string): string | null {
  if (!value || value <= 0) return null;
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function ExplorePage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [onlyTransit, setOnlyTransit] = useState(false);
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  const load = useCallback(
    async (nextOffset: number, replace: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const response = await api.cities({
          q: query.trim() || undefined,
          hasTransit: onlyTransit || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        if (id !== requestId.current) return;
        setCities((current) => (replace ? response.cities : [...current, ...response.cities]));
        setTotal(response.total ?? 0);
        setOffset(nextOffset);
      } catch (err) {
        if (id === requestId.current) setError(err instanceof Error ? err.message : t('common.error'));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [query, onlyTransit, t],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(0, true), query ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const stats = useMemo(
    () => [
      {
        label: t('explore.stats.countries'),
        value: meta?.stats?.countries ?? 250,
        icon: 'globe' as const,
      },
      {
        label: t('explore.stats.cities'),
        value: meta?.stats?.cities ?? 0,
        icon: 'pin' as const,
      },
      {
        label: t('explore.stats.stops'),
        value: meta?.stats?.stops ?? 0,
        icon: 'bus' as const,
      },
      {
        label: t('explore.stats.withTransit'),
        value: meta?.stats?.citiesWithTransit ?? 0,
        icon: 'route' as const,
      },
    ],
    [meta, t],
  );

  const openCity = (city: CitySummary) => {
    setPendingPlace(
      {
        id: `city:${city.id}`,
        name: city.name,
        displayName: `${city.name}, ${city.countryCode}`,
        location: city.center,
        kind: 'city',
        provider: 'database',
        countryCode: city.countryCode,
        cityName: city.name,
      },
      'origin',
    );
    navigate('/');
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-surface to-[rgb(var(--info-bg))] p-5 shadow-card sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full bg-signal-200/30 blur-3xl" aria-hidden="true" />
        <span className="chip chip-info">
          <Icon name="globe" size={12} />
          {t('explore.badge')}
        </span>
        <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">{t('explore.title')}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-600">{t('explore.subtitle')}</p>

        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-line bg-surface/80 px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                <Icon name={stat.icon} size={12} />
                {stat.label}
              </dt>
              <dd className="mt-0.5 text-lg font-extrabold tabular-nums text-ink-900">
                {stat.value.toLocaleString(locale)}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('explore.searchPlaceholder')}
            aria-label={t('explore.searchPlaceholder')}
          />
          {query ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100"
              onClick={() => setQuery('')}
              aria-label={t('form.clear')}
            >
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-ink-300"
            checked={onlyTransit}
            onChange={(event) => setOnlyTransit(event.target.checked)}
          />
          <Icon name="route" size={15} className="text-signal-600" />
          {t('explore.onlyTransit')}
        </label>
      </div>

      {error ? <div className="note-danger">{error}</div> : null}

      {meta && !meta.stats ? (
        <div className="note-warn flex items-start gap-2" role="status">
          <Icon name="wifi-off" size={15} className="mt-0.5 shrink-0" />
          <span>{t('explore.noDatabase')}</span>
        </div>
      ) : null}

      <div className="flex items-center justify-between text-xs text-ink-500">
        <span>{t('explore.resultCount', { count: total.toLocaleString(locale) })}</span>
        {onlyTransit ? <span className="chip chip-ok">{t('explore.onlyTransitOn')}</span> : null}
      </div>

      {loading && cities.length === 0 ? (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="card p-4">
              <div className="skeleton h-4 w-28" />
              <div className="skeleton mt-2 h-3 w-20" />
              <div className="skeleton mt-4 h-3 w-32" />
            </div>
          ))}
        </div>
      ) : cities.length === 0 ? (
        <EmptyState
          variant="search"
          title={t('explore.empty')}
          hint={t('explore.emptyHint')}
          action={
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setQuery('');
                setOnlyTransit(false);
              }}
            >
              <Icon name="close" size={13} />
              {t('explore.clearFilters')}
            </button>
          }
        />
      ) : (
        <>
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {cities.map((city) => {
              const population = formatPopulation(city.population, locale);
              return (
                <li key={city.id}>
                  <button
                    type="button"
                    onClick={() => openCity(city)}
                    className="card group flex h-full w-full flex-col gap-2 p-4 text-left transition hover:-translate-y-0.5 hover:border-signal-300 hover:shadow-lift"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold text-ink-900">{city.name}</p>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
                          {city.countryCode}
                          {population ? ` · ${population}` : ''}
                        </p>
                      </div>
                      {city.hasTransitData ? (
                        <span className="chip chip-ok shrink-0">
                          <Icon name="route" size={11} />
                          {t('explore.hasTransit')}
                        </span>
                      ) : (
                        <span className="chip shrink-0">{t('explore.noTransitShort')}</span>
                      )}
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-ink-500">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="bus" size={12} />
                        {t('explore.stopCount', { count: city.stopCount ?? 0 })}
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-signal-700 opacity-0 transition group-hover:opacity-100">
                        {t('explore.planHere')}
                        <Icon name="arrow-right" size={12} />
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {cities.length < total ? (
            <div className="flex justify-center">
              <button type="button" className="btn-secondary" disabled={loading} onClick={() => void load(offset + PAGE_SIZE, false)}>
                {loading ? t('common.loading') : t('explore.loadMore')}
              </button>
            </div>
          ) : null}
        </>
      )}

      <p className="rounded-xl bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
        <Icon name="info" size={12} className="mr-1 inline" />
        {t('explore.coverageNote')}
      </p>
    </div>
  );
}
