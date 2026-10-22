import { useEffect, useMemo, useState } from 'react';
import type { PlanResponse } from '@routewise/shared';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { browserTimeZone, formatDateTime } from '../lib/format';
import { decodePlanFragment, localSavedStore } from '../lib/storage';
import { useSettings } from '../lib/theme';
import { JourneyCard } from '../components/JourneyCard';
import { MapView } from '../components/MapView';
import { Icon } from '../components/Icon';

export function SharePage() {
  const { t, locale } = useI18n();
  const params = useParams<{ slug?: string; id?: string }>();
  const location = useLocation();
  const settings = useSettings();
  const timezone = settings.timezone ?? browserTimeZone();

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<'link' | 'device' | 'cloud' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (location.hash.startsWith('#p=')) {
        const decoded = decodePlanFragment(location.hash.slice(3));
        if (decoded) {
          if (!cancelled) {
            setPlan(decoded);
            setSelectedId(decoded.journeys[0]?.id ?? null);
            setSource('link');
            setLoading(false);
          }
          return;
        }
      }

      if (params.id) {
        const local = localSavedStore.get(params.id);
        if (local) {
          if (!cancelled) {
            setPlan(local.plan);
            setSelectedId(local.journeyId);
            setSource('device');
            setLoading(false);
          }
          return;
        }
      }

      if (params.slug) {
        try {
          const response = await api.getShared(params.slug);
          if (!cancelled) {
            setPlan(response.saved.plan);
            setSelectedId(response.saved.journeyId);
            setSource('cloud');
            setLoading(false);
          }
          return;
        } catch {
          // fall through to the not-found state
        }
      }

      if (!cancelled) {
        setError(t('share.notFound'));
        setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [params.id, params.slug, location.hash, t]);

  const selected = plan?.journeys.find((journey) => journey.id === selectedId) ?? plan?.journeys[0] ?? null;

  const sourceLabel = useMemo(() => {
    if (source === 'cloud') return t('share.fromCloud');
    if (source === 'device') return t('share.fromDevice');
    if (source === 'link') return t('share.fromLink');
    return null;
  }, [source, t]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            {[0, 1].map((index) => (
              <div key={index} className="card p-5">
                <div className="skeleton h-6 w-40" />
                <div className="skeleton mt-3 h-3 w-full" />
                <div className="skeleton mt-2 h-3 w-2/3" />
              </div>
            ))}
          </div>
          <div className="lg:col-span-5">
            <div className="skeleton h-[360px] w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">
          <Icon name="alert" size={22} />
        </span>
        <h1 className="mt-3 text-lg font-bold text-ink-900">{t('share.notFound')}</h1>
        <p className="mt-1 text-sm text-ink-600">{t('share.notFoundHint')}</p>
        <Link to="/" className="btn-primary mt-4 inline-flex">
          <Icon name="route" size={15} />
          {t('share.openInApp')}
        </Link>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-bold text-ink-900">{t('share.notFound')}</h1>
        <Link to="/" className="btn-primary mt-4 inline-flex">{t('share.openInApp')}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="card flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip chip-info no-print">
              <Icon name="share" size={11} />
              {t('share.heading')}
            </span>
            {sourceLabel ? <span className="chip no-print">{sourceLabel}</span> : null}
            <span className="chip no-print">{plan.currency}</span>
          </div>
          <h1 className="mt-2 flex flex-wrap items-center gap-x-2 text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">
            <span className="truncate">{plan.origin.name}</span>
            <Icon name="arrow-right" size={18} className="text-ink-300" />
            <span className="truncate">{plan.destination.name}</span>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1">
              <Icon name="calendar" size={12} />
              {formatDateTime(plan.departureTime, timezone, locale)}
            </span>
            <span>·</span>
            <span>
              {plan.coverage.cityName ?? plan.origin.cityName ?? t('share.unknownCity')}
              {plan.coverage.countryCode ? ` · ${plan.coverage.countryCode}` : ''}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 no-print">
          <button type="button" className="btn-secondary btn-sm" onClick={() => window.print()}>
            <Icon name="printer" size={14} />
            {t('share.print')}
          </button>
          <Link className="btn-primary btn-sm" to="/">
            <Icon name="route" size={14} />
            {t('share.openInApp')}
          </Link>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          {plan.journeys.map((journey, index) => (
            <JourneyCard
              key={journey.id}
              journey={journey}
              plan={plan}
              recommended={index === 0}
              selected={journey.id === selected.id}
              onSelect={() => setSelectedId(journey.id)}
              units={settings.units ?? 'metric'}
              timezone={timezone}
              readOnly
            />
          ))}
        </div>
        <div className="space-y-3 lg:col-span-5">
          <MapView plan={plan} journey={selected} units={settings.units ?? 'metric'} />
          <div className="rounded-xl border border-line bg-surface p-3 text-[11px] leading-relaxed text-ink-500">
            <p className="font-semibold text-ink-700">{t('share.footerTitle')}</p>
            <p className="mt-1">{t('footer.dataNote')}</p>
            <p className="mt-1">{t('share.footerHint')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
