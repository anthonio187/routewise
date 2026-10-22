import { useEffect, useMemo, useState } from 'react';
import type { SavedJourney } from '@routewise/shared';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { browserTimeZone, formatDateTime, formatDuration, formatTime } from '../lib/format';
import { localSavedStore, toLocalSaved, type LocalSaved } from '../lib/storage';
import { useSettings } from '../lib/theme';
import { Icon, MODE_ICONS } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';

const MODE_KEYS: Record<string, string> = {
  walk: 'mode.walk',
  cycle: 'mode.cycle',
  bus: 'mode.bus',
  metro: 'mode.metro',
  subway: 'mode.subway',
  train: 'mode.train',
  commuter_rail: 'mode.commuterRail',
  tram: 'mode.tram',
  light_rail: 'mode.lightRail',
  ferry: 'mode.ferry',
  cable_tram: 'mode.cableTram',
  funicular: 'mode.funicular',
  trolleybus: 'mode.trolleybus',
  monorail: 'mode.monorail',
  taxi: 'mode.taxi',
  ride: 'mode.ride',
  other: 'mode.other',
};
import { useToast } from '../components/Toast';

export function SavedPage() {
  const { t, locale } = useI18n();
  const settings = useSettings();
  const { toast } = useToast();
  const timezone = settings.timezone ?? browserTimeZone();
  const [local, setLocal] = useState<LocalSaved[]>(() => localSavedStore.all());
  const [server, setServer] = useState<SavedJourney[]>([]);
  const [serverState, setServerState] = useState<'idle' | 'synced' | 'unavailable'>('idle');
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSaved()
      .then((response) => {
        setServer(response.saved);
        setServerState('synced');
        for (const saved of response.saved) localSavedStore.add(toLocalSaved(saved));
        setLocal(localSavedStore.all());
      })
      .catch(() => setServerState('unavailable'));
  }, []);

  const remove = async (entry: LocalSaved) => {
    setLocal(localSavedStore.remove(entry.id));
    setServer((current) => current.filter((item) => item.id !== entry.id));
    setConfirmDelete(null);
    toast({ title: t('saved.removed'), tone: 'success' });
    try {
      await api.deleteSaved(entry.id);
    } catch {
      toast({ title: t('saved.removeLocalOnly'), tone: 'info' });
    }
  };

  const merged = useMemo(() => {
    const bySlug = new Map<string, LocalSaved>();
    for (const entry of local) bySlug.set(entry.shareSlug ?? entry.id, entry);
    for (const entry of server) {
      const converted = toLocalSaved(entry);
      if (!bySlug.has(entry.shareSlug ?? entry.id)) {
        bySlug.set(entry.shareSlug ?? entry.id, { ...converted, id: entry.id });
      }
    }
    return [...bySlug.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [local, server]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((entry) => entry.title.toLowerCase().includes(q));
  }, [merged, query]);

  const copyLink = async (entry: LocalSaved) => {
    const url = entry.shareSlug
      ? `${window.location.origin}/share/${entry.shareSlug}`
      : `${window.location.origin}/share/local/${entry.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t('results.shareCopied'), description: url, tone: 'success' });
    } catch {
      window.prompt(t('results.share'), url);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">{t('saved.heading')}</h1>
          <p className="mt-0.5 text-sm text-ink-600">{t('saved.subtitle')}</p>
        </div>
        <span className="chip">
          <Icon name="bookmark" size={12} />
          {t('saved.count', { count: merged.length })}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('saved.searchPlaceholder')}
            aria-label={t('saved.searchPlaceholder')}
          />
        </div>
        <span className={`chip ${serverState === 'unavailable' ? 'chip-warn' : 'chip-ok'}`}>
          <Icon name={serverState === 'unavailable' ? 'wifi-off' : 'check'} size={12} />
          {serverState === 'unavailable' ? t('saved.localOnly') : t('saved.synced')}
        </span>
      </div>

      {merged.length === 0 ? (
        <EmptyState
          variant="saved"
          title={t('saved.empty')}
          hint={t('saved.emptyHint')}
          action={
            <Link to="/" className="btn-primary btn-sm">
              <Icon name="route" size={14} />
              {t('nav.plan')}
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="card p-6 text-center text-sm text-ink-500">{t('search.noResults')}</p>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((entry) => {
            const journey = entry.plan.journeys.find((item) => item.id === entry.journeyId) ?? entry.plan.journeys[0];
            const modes = Array.from(new Set((journey?.legs ?? []).filter((leg) => leg.mode !== 'walk').map((leg) => leg.mode)));
            return (
              <li key={entry.id} className="card p-4 transition hover:border-ink-300 hover:shadow-lift">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-bold text-ink-900">
                      <span className="truncate">{entry.plan.origin.name}</span>
                      <Icon name="arrow-right" size={14} className="text-ink-300" />
                      <span className="truncate">{entry.plan.destination.name}</span>
                    </h2>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-500">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="calendar" size={11} />
                        {formatDateTime(entry.createdAt, timezone, locale)}
                      </span>
                      {journey ? (
                        <>
                          <span>·</span>
                          <span>
                            {journey.departureTime ? formatTime(journey.departureTime, timezone, locale) : '—'} ·{' '}
                            {formatDuration(journey.durationSeconds, locale)}
                          </span>
                          <span>·</span>
                          <span>{journey.transfers} {t('results.transfers')}</span>
                        </>
                      ) : null}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {modes.map((mode) => (
                        <span key={mode} className="chip chip-outline">
                          <Icon name={MODE_ICONS[mode] ?? 'route'} size={11} />
                          {t((MODE_KEYS[mode] ?? 'mode.other') as never)}
                        </span>
                      ))}
                      {entry.shareSlug ? (
                        <span className="chip chip-ok">
                          <Icon name="share" size={11} />
                          {t('saved.linkReady')}
                        </span>
                      ) : (
                        <span className="chip">
                          <Icon name="wifi-off" size={11} />
                          {t('saved.localOnly')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link className="btn-secondary btn-sm" to={entry.shareSlug ? `/share/${entry.shareSlug}` : `/share/local/${entry.id}`}>
                      {t('saved.open')}
                      <Icon name="arrow-right" size={13} />
                    </Link>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => void copyLink(entry)} title={t('results.share')}>
                      <Icon name="copy" size={14} />
                      <span className="hidden sm:inline">{t('saved.copyLink')}</span>
                    </button>
                    {confirmDelete === entry.id ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[rgb(var(--danger-bg))] px-1.5 py-1">
                        <button type="button" className="rounded px-1.5 py-0.5 text-[11px] font-bold text-[rgb(var(--danger-fg))]" onClick={() => void remove(entry)}>
                          {t('saved.confirmRemove')}
                        </button>
                        <button type="button" className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-ink-500" onClick={() => setConfirmDelete(null)}>
                          {t('common.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="icon-btn !h-8 !w-8"
                        onClick={() => setConfirmDelete(entry.id)}
                        aria-label={t('saved.remove')}
                        title={t('saved.remove')}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="rounded-xl bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
        <Icon name="info" size={12} className="mr-1 inline" />
        {t('saved.offlineNote')}
      </p>
    </div>
  );
}
