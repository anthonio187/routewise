import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiMeta,
  CitySummary,
  DistanceUnits,
  Journey,
  JourneyPreference,
  Place,
  PlanRequest,
  PlanResponse,
} from '@routewise/shared';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n, noticeText } from '../i18n';
import { browserTimeZone, formatDateTime, formatDuration, toDateTimeLocalValue } from '../lib/format';
import {
  encodePlanFragment,
  lastPlanStore,
  localSavedStore,
  recentPlacesStore,
  type LocalSaved,
  type RecentPlace,
} from '../lib/storage';
import { useSettings } from '../lib/theme';
import { takePendingPlace } from '../lib/handoff';
import { PlaceSearch } from '../components/PlaceSearch';
import { JourneyCard } from '../components/JourneyCard';
import { MapView } from '../components/MapView';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { InstallBanner } from '../components/InstallBanner';

const PREFERENCES: JourneyPreference[] = [
  'fastest',
  'cheapest',
  'fewest_transfers',
  'least_walking',
  'accessible',
];

const PREF_LABEL: Record<JourneyPreference, string> = {
  fastest: 'pref.fastest',
  cheapest: 'pref.cheapest',
  fewest_transfers: 'pref.fewest_transfers',
  least_walking: 'pref.least_walking',
  accessible: 'pref.accessible',
};

function compactCount(value: number, locale: string): string {
  try {
    const digits = value >= 100_000 ? 0 : 1;
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: digits })
      .format(value)
      .replace(/\s/g, '')
      .toLowerCase();
  } catch {
    return String(value);
  }
}

function autoUnits(locale: string): DistanceUnits {
  try {
    const region = new Intl.Locale(locale).region;
    return region && ['US', 'LR', 'MM'].includes(region) ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

function placeRef(place: Place) {
  return {
    id: place.id,
    name: place.name,
    displayName: place.displayName,
    location: place.location,
    kind: place.kind,
    countryCode: place.countryCode ?? null,
    cityName: place.cityName ?? null,
  };
}

function cityAsPlace(city: CitySummary): Place {
  return {
    id: `city:${city.id}`,
    name: city.name,
    displayName: `${city.name}, ${city.countryCode}`,
    location: city.center,
    kind: 'city',
    provider: 'database',
    countryCode: city.countryCode,
    cityName: city.name,
  };
}

export function PlanPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const settings = useSettings();
  const { toast } = useToast();
  const units: DistanceUnits = settings.units ?? autoUnits(locale);
  const timezone = settings.timezone ?? browserTimeZone();

  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [whenMode, setWhenMode] = useState<'now' | 'depart' | 'arrive'>('now');
  const [whenValue, setWhenValue] = useState(() => toDateTimeLocalValue(new Date(Date.now() + 20 * 60_000)));
  const [preference, setPreference] = useState<JourneyPreference>('fastest');
  const [maxTransfers, setMaxTransfers] = useState(3);
  const [stepFree, setStepFree] = useState(settings.stepFreeByDefault);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(() => lastPlanStore.get());
  const [selectedId, setSelectedId] = useState<string | null>(
    () => lastPlanStore.get()?.journeys[0]?.id ?? null,
  );
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [geoState, setGeoState] = useState<'idle' | 'origin' | 'destination' | 'denied' | 'error'>('idle');
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [cities, setCities] = useState<CitySummary[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [recents, setRecents] = useState<RecentPlace[]>(() => recentPlacesStore.all());
  const [now, setNow] = useState(() => Date.now());

  const resultsRef = useRef<HTMLDivElement | null>(null);
  const destinationInputRef = useRef<HTMLDivElement | null>(null);

  const selectedJourney = useMemo(
    () => plan?.journeys.find((journey) => journey.id === selectedId) ?? plan?.journeys[0] ?? null,
    [plan, selectedId],
  );

  // "Departs in 4 min" for journeys that are close enough for it to matter.
  const countdown = useMemo(() => {
    const iso = selectedJourney?.departureTime;
    if (!iso) return null;
    const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
    if (!Number.isFinite(minutes) || Math.abs(minutes) > 12 * 60) return null;
    if (minutes >= 1) return { past: false, label: t('plan.departsIn', { minutes }) };
    if (minutes >= 0) return { past: false, label: t('plan.departingNow') };
    return { past: true, label: t('plan.departedAgo', { minutes: Math.abs(minutes) }) };
  }, [selectedJourney, now, t]);

  useEffect(() => {
    if (!plan) return;
    setSelectedId((current) =>
      plan.journeys.some((job) => job.id === current) ? current : plan.journeys[0]?.id ?? null,
    );
  }, [plan]);

  // Pick up a place chosen in the command palette or on the Explore page.
  useEffect(() => {
    const pending = takePendingPlace();
    if (!pending) return;
    if (pending.role === 'origin') setOrigin(pending.place);
    else setDestination(pending.place);
    setRecents(recentPlacesStore.all());
  }, []);

  // Real cities from the database, used as quick starting points.
  useEffect(() => {
    let cancelled = false;
    api
      .cities({ limit: 8 })
      .then((response) => {
        if (!cancelled) setCities(response.cities);
      })
      .catch(() => {
        if (!cancelled) setCities([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Real counters for the hero claims: they must match the deployment's data.
  useEffect(() => {
    let cancelled = false;
    api
      .meta()
      .then((response) => {
        if (!cancelled) setMeta(response);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const requestLocation = useCallback(
    (target: 'origin' | 'destination') => {
      if (!('geolocation' in navigator)) {
        setGeoState('error');
        return;
      }
      setGeoState(target);
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          let place: Place = {
            id: 'device-location',
            name: t('form.useMyLocation'),
            displayName: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
            location: { lat: latitude, lng: longitude },
            kind: 'coordinate',
            provider: 'device',
          };
          try {
            const reversed = await api.reverse(latitude, longitude, locale);
            if (reversed.place) place = reversed.place;
          } catch {
            // Reverse geocoding is optional; coordinates still work.
          }
          if (target === 'origin') setOrigin(place);
          else setDestination(place);
          setGeoState('idle');
        },
        (err) => {
          setGeoState(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
      );
    },
    [locale, t],
  );

  const runPlan = useCallback(
    async (from: Place, to: Place) => {
      setError(null);
      setLoading(true);
      setMobileView('list');
      try {
        const departureTime = whenMode === 'now' ? undefined : new Date(whenValue).toISOString();
        const body: PlanRequest = {
          origin: placeRef(from),
          destination: placeRef(to),
          departureTime,
          arriveBy: whenMode === 'arrive',
          preference,
          maxTransfers,
          requireStepFree: stepFree || preference === 'accessible',
          locale,
          ...(settings.currency ? { currency: settings.currency } : {}),
        };
        const response = await api.plan(body);
        setPlan(response);
        setSelectedId(response.journeys[0]?.id ?? null);
        setDismissed(new Set());
        lastPlanStore.set(response);
        if (window.innerWidth < 1024) {
          window.setTimeout(() => {
            resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 120);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t('common.error');
        setError(message);
        toast({ title: t('results.failed'), description: message, tone: 'error' });
      } finally {
        setLoading(false);
      }
    },
    [whenMode, whenValue, preference, maxTransfers, stepFree, locale, settings.currency, t, toast],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!origin || !destination) {
      toast({ title: t('form.missingEndpoints'), tone: 'info' });
      return;
    }
    await runPlan(origin, destination);
  };

  const handleSave = async () => {
    if (!plan || !selectedJourney) return;
    const title = `${plan.origin.name} → ${plan.destination.name}`;
    const local: LocalSaved = {
      id: crypto.randomUUID(),
      title,
      plan,
      journeyId: selectedJourney.id,
      createdAt: new Date().toISOString(),
    };
    localSavedStore.add(local);
    setSavedIds((current) => new Set(current).add(selectedJourney.id));
    toast({
      title: t('results.saveToast'),
      action: { label: t('results.viewSaved'), onClick: () => navigate('/saved') },
    });
    try {
      const response = await api.saveJourney({ title, journeyId: selectedJourney.id, plan });
      // Replace the optimistic local copy with the stored one so the saved list
      // holds a single entry and keeps the public share slug.
      localSavedStore.remove(local.id);
      localSavedStore.add({
        ...local,
        id: response.saved.id,
        createdAt: response.saved.createdAt,
        shareSlug: response.saved.shareSlug ?? null,
      });
    } catch {
      // The local copy is enough when storage is unavailable.
    }
  };

  const handleShare = async () => {
    if (!plan || !selectedJourney) return;
    const title = `${plan.origin.name} → ${plan.destination.name}`;
    let url = `${window.location.origin}/share#p=${encodePlanFragment({
      ...plan,
      journeys: [selectedJourney, ...plan.journeys.filter((job) => job.id !== selectedJourney.id)],
    })}`;
    const stored = localSavedStore
      .all()
      .find((entry) => entry.journeyId === selectedJourney.id && entry.plan.generatedAt === plan.generatedAt);
    if (stored?.shareSlug) {
      url = `${window.location.origin}/share/${stored.shareSlug}`;
    } else {
      try {
        const response = await api.saveJourney({ title, journeyId: selectedJourney.id, plan });
        if (response.saved.shareSlug) {
          url = `${window.location.origin}/share/${response.saved.shareSlug}`;
          localSavedStore.add({
            id: response.saved.id,
            title,
            plan,
            journeyId: selectedJourney.id,
            createdAt: response.saved.createdAt,
            shareSlug: response.saved.shareSlug,
          });
        }
      } catch {
        // Fall back to the self-contained link.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t('results.shareCopied'), description: url, tone: 'success' });
    } catch {
      window.prompt(t('results.share'), url);
    }
  };

  // Counts are only claimed when the API can back them. A deployment without a
  // database reports no stats, so it shows the mode count alone instead of a
  // gazetteer figure it cannot substantiate.
  const stats = meta?.stats ?? null;
  const showCounts = meta === null || Boolean(stats);
  const heroStats = [
    ...(showCounts
      ? [
          {
            icon: 'globe' as const,
            label: t('home.stat.countries', { count: compactCount(stats?.countries ?? 250, locale) }),
          },
          {
            icon: 'pin' as const,
            label: t('home.stat.cities', { count: compactCount(stats?.cities ?? 236353, locale) }),
          },
        ]
      : []),
    {
      icon: 'route' as const,
      label: t('home.stat.modes', { count: String(meta?.supportedModes?.length ?? 17) }),
    },
  ];

  const transitJourneys = plan?.journeys.filter((job) => job.legs.some((leg) => leg.mode !== 'walk' && leg.mode !== 'cycle')) ?? [];
  const fastest = [...transitJourneys].sort((a, b) => a.durationSeconds - b.durationSeconds)[0];

  return (
    <div className="space-y-5 sm:space-y-7">
      {/* ---------------- Hero + search ---------------- */}
      <section className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-surface via-surface to-[rgb(var(--signal-100))] px-4 pb-5 pt-6 shadow-card sm:px-8 sm:pb-7 sm:pt-9">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-signal-200/40 blur-3xl" aria-hidden="true" />
        <HeroArt />
        <div className="relative max-w-2xl">
          <span className="chip chip-ok">
            <Icon name="sparkles" size={13} />
            {t('home.badge')}
          </span>
          <h1 className="mt-3 text-[26px] font-extrabold leading-[1.12] tracking-tight text-ink-900 sm:text-4xl">
            {t('home.title')}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-600 sm:text-[15px]">{t('home.subtitle')}</p>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-medium text-ink-500">
            {heroStats.map((stat) => (
              <span key={stat.label} className="inline-flex items-center gap-1.5">
                <Icon name={stat.icon} size={14} className="text-signal-600" />
                {stat.label}
              </span>
            ))}
          </div>
        </div>

        <form className="relative mt-5 rounded-2xl border border-line bg-surface p-3 shadow-lift sm:mt-6 sm:p-4" onSubmit={submit}>
          <div className="flex gap-2">
            <div className="relative flex w-6 shrink-0 flex-col items-center pt-9" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-ink-900 bg-surface" />
              <span className="my-1 w-px flex-1 bg-gradient-to-b from-ink-300 to-ink-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-signal-500 ring-2 ring-signal-100" />
            </div>
            <div className="min-w-0 flex-1 space-y-2.5">
              <PlaceSearch
                label={t('form.origin')}
                placeholder={t('form.originPlaceholder')}
                value={origin}
                onChange={setOrigin}
                near={destination?.location ?? null}
              />
              <div ref={destinationInputRef}>
                <PlaceSearch
                  label={t('form.destination')}
                  placeholder={t('form.destinationPlaceholder')}
                  value={destination}
                  onChange={setDestination}
                  near={origin?.location ?? null}
                />
              </div>
            </div>
            <div className="flex flex-col justify-center gap-1 pt-6">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-ink-600 transition hover:bg-ink-50 hover:text-ink-900 active:scale-95"
                onClick={() => {
                  setOrigin(destination);
                  setDestination(origin);
                }}
                aria-label={t('form.swap')}
                title={t('form.swap')}
              >
                <Icon name="swap" size={17} />
              </button>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-ink-600 transition hover:bg-ink-50 hover:text-ink-900 active:scale-95"
                onClick={() => requestLocation(origin ? 'destination' : 'origin')}
                aria-label={t('form.useMyLocation')}
                title={t('form.useMyLocation')}
                disabled={geoState === 'origin' || geoState === 'destination'}
              >
                {geoState === 'origin' || geoState === 'destination' ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-300 border-t-transparent" />
                ) : (
                  <Icon name="locate" size={17} />
                )}
              </button>
            </div>
          </div>

          {geoState === 'denied' ? (
            <p className="note-warn mt-2 text-xs">{t('form.locationDenied')}</p>
          ) : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
            <div>
              <span className="label">{t('form.when')}</span>
              <div className="inline-flex rounded-xl bg-ink-100 p-1" role="tablist" aria-label={t('form.when')}>
                {(['now', 'depart', 'arrive'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={whenMode === mode}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      whenMode === mode ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-800'
                    }`}
                    onClick={() => setWhenMode(mode)}
                  >
                    {mode === 'now' ? t('form.departNow') : mode === 'depart' ? t('form.departAt') : t('form.arriveBy')}
                  </button>
                ))}
              </div>
            </div>

            <div className={whenMode === 'now' ? 'opacity-40' : ''}>
              <label className="sr-only" htmlFor="when-input">
                {t('form.when')}
              </label>
              <input
                id="when-input"
                className="input"
                type="datetime-local"
                value={whenValue}
                disabled={whenMode === 'now'}
                onChange={(event) => setWhenValue(event.target.value)}
              />
            </div>

            <button type="submit" className="btn-primary h-[42px] px-6" disabled={loading}>
              {loading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-canvas/40 border-t-canvas" />
                  {t('form.searching')}
                </>
              ) : (
                <>
                  <Icon name="search" size={17} />
                  {t('form.search')}
                </>
              )}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-500 hover:text-ink-800"
              onClick={() => setShowAdvanced((value) => !value)}
              aria-expanded={showAdvanced}
            >
              <Icon name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={13} />
              {t('form.options')}
            </button>
            <span className="hidden text-ink-200 sm:inline">·</span>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-600">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-ink-300"
                checked={stepFree}
                onChange={(event) => setStepFree(event.target.checked)}
              />
              {t('form.stepFree')}
            </label>
            <span className="ml-auto hidden text-[11px] text-ink-400 sm:block">
              {t('form.prefHint', { preference: t(PREF_LABEL[preference] as never) })}
            </span>
          </div>

          {showAdvanced ? (
            <div className="mt-3 grid gap-3 rounded-xl bg-raised p-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="preference">
                  {t('form.preference')}
                </label>
                <select
                  id="preference"
                  className="input"
                  value={preference}
                  onChange={(event) => setPreference(event.target.value as JourneyPreference)}
                >
                  {PREFERENCES.map((value) => (
                    <option key={value} value={value}>
                      {t(PREF_LABEL[value] as never)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="max-transfers">
                  {t('form.maxTransfers')}
                </label>
                <select
                  id="max-transfers"
                  className="input"
                  value={maxTransfers}
                  onChange={(event) => setMaxTransfers(Number(event.target.value))}
                >
                  {[0, 1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? t('form.transfersNone') : value}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-500 sm:col-span-2">{t('form.stepFreeHint')}</p>
            </div>
          ) : null}
        </form>
      </section>

      {error ? (
        <div className="note-danger flex items-start gap-2" role="alert">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <InstallBanner />

      {/* ---------------- Recent places (no plan yet) ---------------- */}
      {!plan && !loading && recents.length > 0 ? (
        <section className="animate-fade-up">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-500">
              <Icon name="clock" size={13} />
              {t('plan.recent')}
            </h2>
            <button
              type="button"
              className="text-[11px] font-semibold text-ink-400 hover:text-ink-700"
              aria-label={t('plan.clearRecent')}
              title={t('plan.clearRecent')}
              onClick={() => {
                recentPlacesStore.clear();
                setRecents([]);
              }}
            >
              {t('common.clear')}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recents.slice(0, 6).map((place) => (
              <button
                key={`${place.name}-${place.location.lat}`}
                type="button"
                className="chip chip-outline max-w-full transition hover:border-signal-300 hover:text-signal-700"
                onClick={() => {
                  const next: Place = {
                    id: `recent:${place.name}`,
                    name: place.name,
                    displayName: place.displayName,
                    location: place.location,
                    kind: 'other',
                    provider: 'recent',
                  };
                  if (!origin) setOrigin(next);
                  else setDestination(next);
                }}
              >
                <Icon name="pin" size={11} />
                <span className="max-w-[13rem] truncate">{place.name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------------- Quick starts (no plan yet) ---------------- */}
      {!plan && !loading && cities.length > 0 ? (
        <section className="animate-fade-up space-y-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-ink-900">{t('home.quickStart')}</h2>
              <p className="text-xs text-ink-500">{t('home.quickStartHint')}</p>
            </div>
            <Link to="/explore" className="text-xs font-semibold text-signal-700 hover:underline">
              {t('home.browseAll')} →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cities.slice(0, 8).map((city) => (
              <button
                key={city.id}
                type="button"
                onClick={() => {
                  const place = cityAsPlace(city);
                  if (!origin) {
                    setOrigin(place);
                    destinationInputRef.current?.querySelector('input')?.focus();
                  } else {
                    setDestination(place);
                  }
                }}
                className="card-flat group flex items-center gap-2 px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-signal-300 hover:shadow-card"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-700 group-hover:bg-signal-100 group-hover:text-signal-700">
                  <Icon name="pin" size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink-900">{city.name}</span>
                  <span className="flex items-center gap-1 text-[10px] text-ink-500">
                    {city.countryCode}
                    {city.hasTransitData ? (
                      <span className="inline-flex items-center gap-0.5 text-signal-700">
                        <span className="h-1 w-1 rounded-full bg-signal-500" />
                        {t('explore.hasTransit')}
                      </span>
                    ) : (
                      <span className="text-ink-400">· {t('explore.noTransitShort')}</span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------------- Loading skeleton ---------------- */}
      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="flex items-center gap-2">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton h-5 w-24" />
          </div>
          {[0, 1, 2].map((index) => (
            <div key={index} className="card p-4">
              <div className="flex justify-between">
                <div className="space-y-2">
                  <div className="skeleton h-5 w-32" />
                  <div className="skeleton h-3 w-48" />
                </div>
                <div className="skeleton h-7 w-20" />
              </div>
              <div className="mt-4 flex gap-1.5">
                <div className="skeleton h-1.5 flex-1" />
                <div className="skeleton h-1.5 flex-1" />
                <div className="skeleton h-1.5 flex-1" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ---------------- Results ---------------- */}
      {plan && !loading ? (
        <div ref={resultsRef} className="scroll-mt-20 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-extrabold tracking-tight text-ink-900 sm:text-xl">
                {plan.origin.name} <span className="text-ink-300">→</span> {plan.destination.name}
              </h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                <span className="inline-flex items-center gap-1">
                  <Icon name="calendar" size={13} />
                  {formatDateTime(plan.departureTime, timezone, locale)}
                </span>
                {countdown ? (
                  <>
                    <span className="text-ink-200">·</span>
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        countdown.past ? 'text-ink-500' : 'text-signal-700'
                      }`}
                      aria-live="polite"
                    >
                      <Icon name="clock" size={13} />
                      {countdown.label}
                    </span>
                  </>
                ) : null}
                <span className="text-ink-200">·</span>
                <span>
                  {t('results.count', { count: plan.journeys.length })}
                  {fastest ? ` · ${t('results.fastest')} ${formatDuration(fastest.durationSeconds, locale)}` : ''}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`chip ${plan.coverage.transitDataAvailable ? 'chip-ok' : 'chip-warn'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${plan.coverage.transitDataAvailable ? 'bg-current' : 'bg-current'}`} />
                {plan.coverage.transitDataAvailable
                  ? t('coverage.transitAvailable')
                  : t('coverage.transitUnavailable')}
              </span>
              {plan.coverage.nearbyStops > 0 ? (
                <span className="chip">
                  {t('coverage.nearbyStops', { count: plan.coverage.nearbyStops })}
                </span>
              ) : null}
              {plan.coverage.cityName ? (
                <span className="chip chip-outline">
                  {plan.coverage.cityName}
                  {plan.coverage.countryCode ? ` · ${plan.coverage.countryCode}` : ''}
                </span>
              ) : null}
              {plan.journeys.some((journey) => journey.fare.total || journey.fare.convertedTotal) ? (
                <span className="chip chip-outline" title={t('results.currencyChipHint')}>
                  {plan.currency === 'XXX' ? t('results.currencyUnknown') : plan.currency}
                </span>
              ) : null}
            </div>
          </div>

          {plan.notices.filter((_, index) => !dismissed.has(index)).length > 0 ? (
            <div className="space-y-2">
              {plan.notices.map((notice, index) =>
                dismissed.has(index) ? null : (
                  <div
                    key={`${notice.code}-${index}`}
                    className={`note flex items-start justify-between gap-3 ${
                      notice.severity === 'error'
                        ? 'note-danger'
                        : notice.severity === 'warning'
                          ? 'note-warn'
                          : 'note-info'
                    }`}
                    role="status"
                  >
                    <span className="flex items-start gap-2">
                      <Icon name={notice.severity === 'info' ? 'info' : 'alert'} size={16} className="mt-0.5 shrink-0" />
                      <span>{noticeText(notice.code, notice.message, t)}</span>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg p-1 text-xs font-semibold opacity-70 hover:opacity-100"
                      onClick={() => setDismissed((current) => new Set(current).add(index))}
                      aria-label={t('form.dismiss')}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ),
              )}
            </div>
          ) : null}

          {/* Mobile view switch */}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1 lg:hidden">
            {(['list', 'map'] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setMobileView(view)}
                aria-pressed={mobileView === view}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                  mobileView === view ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-600'
                }`}
              >
                <Icon name={view === 'list' ? 'list' : 'map'} size={15} />
                {view === 'list' ? t('results.list') : t('results.mapView')}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className={`space-y-3 lg:col-span-7 ${mobileView === 'map' ? 'hidden lg:block' : ''}`}>
              {plan.journeys.length === 0 ? (
                <div className="card flex flex-col items-center gap-2 p-8 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">
                    <Icon name="route" size={22} />
                  </span>
                  <p className="text-sm font-semibold text-ink-900">{t('notice.noTransit')}</p>
                  <p className="max-w-sm text-xs text-ink-500">{t('results.emptyHint')}</p>
                  <Link to="/reports" className="btn-secondary btn-sm mt-1">
                    <Icon name="flag" size={14} />
                    {t('reports.new')}
                  </Link>
                </div>
              ) : (
                plan.journeys.map((journey: Journey, index) => (
                  <JourneyCard
                    key={journey.id}
                    journey={journey}
                    plan={plan}
                    recommended={index === 0}
                    selected={journey.id === selectedId}
                    onSelect={() => setSelectedId(journey.id)}
                    onSave={handleSave}
                    onShare={handleShare}
                    saved={savedIds.has(journey.id)}
                    units={units}
                    timezone={timezone}
                  />
                ))
              )}
            </div>
            <div className={`lg:col-span-5 ${mobileView === 'list' ? 'hidden lg:block' : ''}`}>
              <div className="space-y-3 lg:sticky lg:top-20">
                <MapView plan={plan} journey={selectedJourney} units={units} />
                <ProviderAttribution plan={plan} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* First-run empty state */}
      {!plan && !loading ? (
        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: 'zap' as const, title: t('home.feature.live.title'), body: t('home.feature.live.body') },
            { icon: 'shield' as const, title: t('home.feature.honest.title'), body: t('home.feature.honest.body') },
            { icon: 'users' as const, title: t('home.feature.community.title'), body: t('home.feature.community.body') },
          ].map((feature) => (
            <div key={feature.title} className="card-flat p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-signal-100 text-signal-700">
                <Icon name={feature.icon} size={17} />
              </span>
              <h3 className="mt-2.5 text-sm font-bold text-ink-900">{feature.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">{feature.body}</p>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ProviderAttribution({ plan }: { plan: PlanResponse }) {
  const { t } = useI18n();
  const entries = Object.entries(plan.providers).filter(([key]) => key !== 'database');
  return (
    <details className="group rounded-xl border border-line bg-surface px-3 py-2 text-[11px] text-ink-500">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold text-ink-600">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="layers" size={13} />
          {t('settings.providers')}
        </span>
        <Icon name="chevron-down" size={13} className="transition group-open:rotate-180" />
      </summary>
      <div className="mt-2 space-y-1.5 leading-relaxed">
        {entries.map(([key, status]) => (
          <p key={key}>
            <span className="font-semibold text-ink-700">{key}</span>: {status.provider}
            {status.attribution ? ` — ${status.attribution}` : ''}
          </p>
        ))}
        {plan.coverage.dataSources.map((source) => (
          <p key={source.code}>
            <span className="font-semibold text-ink-700">{source.name}</span>
            {source.attribution ? ` — ${source.attribution}` : ''}
            {source.freshness ? ` (${source.freshness})` : ''}
          </p>
        ))}
      </div>
    </details>
  );
}

/**
 * Decorative hero artwork: an abstract route over a map grid. Purely
 * presentational (aria-hidden), hidden on small screens to keep the form first.
 */
function HeroArt() {
  return (
    <svg
      viewBox="0 0 320 200"
      className="pointer-events-none absolute -right-4 top-1/2 hidden h-[210px] w-[330px] -translate-y-1/2 opacity-90 lg:block"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="hero-route" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--signal-400))" />
          <stop offset="100%" stopColor="rgb(var(--signal-600))" />
        </linearGradient>
        <pattern id="hero-grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0v26" fill="none" stroke="rgb(var(--line))" strokeWidth="1" opacity="0.7" />
        </pattern>
      </defs>
      <rect x="14" y="10" width="292" height="180" rx="22" fill="rgb(var(--surface))" stroke="rgb(var(--line))" />
      <rect x="14" y="10" width="292" height="180" rx="22" fill="url(#hero-grid)" opacity="0.55" />
      <path
        d="M52 152c26-4 22-38 48-44s30 26 52 18 20-44 46-50 28 22 44 26"
        fill="none"
        stroke="url(#hero-route)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="0.5 11"
      />
      <circle cx="52" cy="152" r="8" fill="rgb(var(--surface))" stroke="rgb(var(--signal-500))" strokeWidth="4" />
      <circle cx="242" cy="102" r="8" fill="rgb(var(--surface))" stroke="rgb(var(--signal-500))" strokeWidth="4" />
      <g transform="translate(232 26)">
        <rect x="0" y="0" width="58" height="24" rx="12" fill="rgb(var(--ink-900))" />
        <circle cx="13" cy="12" r="4" fill="rgb(var(--signal-400))" />
        <rect x="22" y="9" width="26" height="6" rx="3" fill="rgb(var(--surface))" opacity="0.85" />
      </g>
      <g transform="translate(46 96)">
        <rect x="0" y="0" width="46" height="24" rx="12" fill="rgb(var(--signal-100))" stroke="rgb(var(--signal-300))" />
        <rect x="9" y="9" width="28" height="6" rx="3" fill="rgb(var(--signal-600))" />
      </g>
    </svg>
  );
}
