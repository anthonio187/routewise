import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommunityReport, ReportCategory } from '@routewise/shared';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../i18n';
import { browserTimeZone, formatDateTime, formatRelative, toDateTimeLocalValue } from '../lib/format';
import { lastPlanStore } from '../lib/storage';
import { useSettings } from '../lib/theme';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';

const CATEGORIES: ReportCategory[] = [
  'disruption',
  'fare_change',
  'route_correction',
  'service_availability',
  'accessibility',
  'safety',
  'other',
];

const CATEGORY_LABEL: Record<ReportCategory, string> = {
  disruption: 'reports.cat.disruption',
  fare_change: 'reports.cat.fare_change',
  route_correction: 'reports.cat.route_correction',
  service_availability: 'reports.cat.service_availability',
  accessibility: 'reports.cat.accessibility',
  safety: 'reports.cat.safety',
  other: 'reports.cat.other',
};

const CATEGORY_ICON: Record<ReportCategory, 'alert' | 'zap' | 'route' | 'bus' | 'accessibility' | 'shield' | 'flag'> = {
  disruption: 'alert',
  fare_change: 'zap',
  route_correction: 'route',
  service_availability: 'bus',
  accessibility: 'accessibility',
  safety: 'shield',
  other: 'flag',
};

export function ReportsPage() {
  const { t, locale } = useI18n();
  const settings = useSettings();
  const { toast } = useToast();
  const timezone = settings.timezone ?? browserTimeZone();
  const plan = useMemo(() => lastPlanStore.get(), []);
  const cityId = plan?.coverage.cityId ?? undefined;

  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [filter, setFilter] = useState<ReportCategory | ''>('');
  const [sort, setSort] = useState<'recent' | 'confirmed'>('recent');
  const [nearMe, setNearMe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [voted, setVoted] = useState<Set<string>>(new Set());

  const [category, setCategory] = useState<ReportCategory>('disruption');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [observedAt, setObservedAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [attachLocation, setAttachLocation] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const bbox = useMemo(() => {
    if (!nearMe || !plan) return undefined;
    const { lat, lng } = plan.origin.location;
    const d = 0.12;
    return `${lng - d},${lat - d},${lng + d},${lat + d}`;
  }, [nearMe, plan]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.reports({
        cityId: nearMe ? undefined : cityId,
        bbox,
        category: filter || undefined,
        limit: 50,
      });
      setReports(response.reports);
      if (response.notice) setNotice(response.notice);
      else setNotice(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('reports.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [cityId, filter, bbox, nearMe, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.createReport({
        category,
        title: title.trim(),
        body: body.trim(),
        observedAt: new Date(observedAt).toISOString(),
        ...(cityId ? { cityId } : {}),
        ...(attachLocation && plan
          ? { location: plan.origin.location, currency: plan.currency !== 'XXX' ? plan.currency : undefined }
          : {}),
      });
      setReports((current) => [response.report, ...current]);
      setTitle('');
      setBody('');
      setShowForm(false);
      toast({ title: t('reports.submitted'), description: t('reports.submittedHint'), tone: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.error');
      setError(message);
      toast({ title: t('common.error'), description: message, tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const vote = async (id: string, value: 'confirm' | 'dispute') => {
    if (voted.has(id)) return;
    try {
      const response = await api.voteReport(id, value);
      setReports((current) => current.map((report) => (report.id === id ? response.report : report)));
      setVoted((current) => new Set(current).add(id));
      if (response.alreadyVoted) toast({ title: t('reports.alreadyVoted'), tone: 'info' });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.error');
      toast({ title: t('common.error'), description: message, tone: 'error' });
    }
  };

  const counts = useMemo(() => {
    const map = new Map<ReportCategory, number>();
    for (const report of reports) map.set(report.category, (map.get(report.category) ?? 0) + 1);
    return map;
  }, [reports]);

  const sorted = useMemo(() => {
    const copy = [...reports];
    if (sort === 'confirmed') copy.sort((a, b) => b.confirmCount - a.confirmCount || b.createdAt.localeCompare(a.createdAt));
    else copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return copy;
  }, [reports, sort]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">{t('reports.heading')}</h1>
          <p className="mt-0.5 max-w-xl text-sm text-ink-600">{t('reports.subtitle')}</p>
          {plan?.coverage.cityName ? (
            <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-ink-500">
              <Icon name="pin" size={12} />
              {plan.coverage.cityName}
              {plan.coverage.countryCode ? ` · ${plan.coverage.countryCode}` : ''}
            </p>
          ) : null}
        </div>
        <button type="button" className={showForm ? 'btn-secondary' : 'btn-primary'} onClick={() => setShowForm((value) => !value)}>
          <Icon name={showForm ? 'close' : 'plus'} size={16} />
          {showForm ? t('common.cancel') : t('reports.new')}
        </button>
      </header>

      {error ? (
        <div className="note-danger flex items-start gap-2" role="alert">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      ) : null}
      {notice && !error ? <div className="note-info text-xs">{notice}</div> : null}

      {showForm ? (
        <form className="card animate-fade-up space-y-4 p-4 sm:p-5" onSubmit={submit}>
          <div>
            <span className="label">{t('reports.category')}</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    category === value
                      ? 'border-ink-900 bg-ink-900 text-canvas'
                      : 'border-line bg-surface text-ink-600 hover:border-ink-300'
                  }`}
                >
                  <Icon name={CATEGORY_ICON[value]} size={13} />
                  {t(CATEGORY_LABEL[value] as never)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="report-title">
                {t('reports.title')}
              </label>
              <input
                id="report-title"
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('reports.titlePlaceholder')}
                minLength={4}
                maxLength={160}
                required
              />
              <p className="mt-1 text-right text-[10px] tabular-nums text-ink-400">{title.length}/160</p>
            </div>
            <div>
              <label className="label" htmlFor="report-observed">
                {t('reports.observedAt')}
              </label>
              <input
                id="report-observed"
                type="datetime-local"
                className="input"
                value={observedAt}
                onChange={(event) => setObservedAt(event.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="report-body">
              {t('reports.details')}
            </label>
            <textarea
              id="report-body"
              className="input min-h-[110px] resize-y"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t('reports.detailsPlaceholder')}
              minLength={10}
              maxLength={4000}
              required
            />
            <p className="mt-1 text-right text-[10px] tabular-nums text-ink-400">{body.length}/4000</p>
          </div>

          {plan ? (
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-raised p-3 text-sm text-ink-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-ink-300"
                checked={attachLocation}
                onChange={(event) => setAttachLocation(event.target.checked)}
              />
              <span>
                <span className="font-semibold">
                  <Icon name="pin" size={13} className="mr-1 inline" />
                  {t('reports.location')}
                </span>
                <span className="block text-xs text-ink-500">
                  {plan.origin.name} ({plan.origin.location.lat.toFixed(4)}, {plan.origin.location.lng.toFixed(4)}) —{' '}
                  {t('reports.locationHint')}
                </span>
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? t('reports.submitting') : t('reports.submit')}
            </button>
            <span className="flex items-start gap-1 text-[11px] text-ink-500">
              <Icon name="info" size={12} className="mt-0.5 shrink-0" />
              {t('reports.disclaimer')}
            </span>
          </div>
        </form>
      ) : null}

      {/* Filters */}
      <div className="space-y-2">
        <div className="hide-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          <button
            type="button"
            aria-pressed={filter === ''}
            onClick={() => setFilter('')}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              filter === '' ? 'border-ink-900 bg-ink-900 text-canvas' : 'border-line bg-surface text-ink-600'
            }`}
          >
            {t('reports.allCategories')} · {reports.length}
          </button>
          {CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter((current) => (current === value ? '' : value))}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                filter === value ? 'border-ink-900 bg-ink-900 text-canvas' : 'border-line bg-surface text-ink-600'
              }`}
            >
              <Icon name={CATEGORY_ICON[value]} size={12} />
              {t(CATEGORY_LABEL[value] as never)}
              {counts.get(value) ? <span className="opacity-60">{counts.get(value)}</span> : null}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1.5 font-medium text-ink-600">
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-ink-300" checked={nearMe} onChange={(e) => setNearMe(e.target.checked)} />
            {t('reports.nearMe')}
          </label>
          <span className="text-ink-200">|</span>
          <label className="inline-flex items-center gap-1.5 font-medium text-ink-600">
            {t('reports.sort')}
            <select
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink-700"
              value={sort}
              onChange={(event) => setSort(event.target.value as 'recent' | 'confirmed')}
            >
              <option value="recent">{t('reports.sortRecent')}</option>
              <option value="confirmed">{t('reports.sortConfirmed')}</option>
            </select>
          </label>
          <button type="button" className="ml-auto inline-flex items-center gap-1 font-semibold text-ink-600 hover:text-ink-900" onClick={() => void load()}>
            <Icon name="refresh" size={13} />
            {t('common.retry')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((index) => (
            <div key={index} className="card p-4">
              <div className="skeleton h-4 w-24" />
              <div className="skeleton mt-2 h-5 w-2/3" />
              <div className="skeleton mt-2 h-3 w-full" />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          variant="reports"
          title={t('reports.none')}
          hint={t('reports.noneHint')}
          action={
            <button type="button" className="btn-primary btn-sm" onClick={() => setShowForm(true)}>
              <Icon name="plus" size={14} />
              {t('reports.new')}
            </button>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {sorted.map((report) => {
            const hasVoted = voted.has(report.id);
            return (
              <li key={report.id} className="card print-block p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-700">
                    <Icon name={CATEGORY_ICON[report.category]} size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="chip chip-info">{t(CATEGORY_LABEL[report.category] as never)}</span>
                      {report.verification !== 'unverified' ? (
                        <span className="chip chip-ok">
                          <Icon name="shield" size={11} />
                          {t(`reports.verification.${report.verification}` as never)}
                        </span>
                      ) : null}
                      {report.status !== 'open' ? <span className="chip">{t(`reports.status.${report.status}` as never)}</span> : null}
                    </div>
                    <h2 className="mt-1.5 text-[15px] font-bold leading-snug text-ink-900">{report.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-ink-600">{report.body}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-400">
                      {report.cityName || report.stopName || report.routeName ? (
                        <>
                          <span className="inline-flex items-center gap-1">
                            <Icon name="pin" size={11} />
                            {report.cityName ?? report.stopName ?? report.routeName}
                          </span>
                          <span>·</span>
                        </>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <Icon name="clock" size={11} />
                        {formatDateTime(report.observedAt, timezone, locale)}
                      </span>
                      <span>·</span>
                      <span>{formatRelative(report.observedAt, locale)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => void vote(report.id, 'confirm')}
                      disabled={hasVoted}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition ${
                        hasVoted ? 'border-transparent bg-[rgb(var(--ok-bg))] text-[rgb(var(--ok-fg))]' : 'border-line text-ink-600 hover:border-signal-400 hover:text-signal-700'
                      }`}
                      aria-label={t('reports.confirm')}
                    >
                      <Icon name="check" size={13} />
                      {report.confirmCount}
                    </button>
                    <button
                      type="button"
                      onClick={() => void vote(report.id, 'dispute')}
                      disabled={hasVoted}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-bold text-ink-600 transition hover:border-ink-400 disabled:opacity-50"
                      aria-label={t('reports.dispute')}
                    >
                      <Icon name="close" size={13} />
                      {report.disputeCount}
                    </button>
                  </div>
                </div>
                <p className="mt-2 border-t border-line pt-2 text-[10px] leading-relaxed text-ink-400">
                  {report.disclaimer}
                  {report.expiresAt ? ` · ${t('reports.expires')} ${formatDateTime(report.expiresAt, timezone, locale)}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
