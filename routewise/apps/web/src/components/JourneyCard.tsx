import { useId, useState } from 'react';
import type { DistanceUnits, Journey, JourneyLeg, PlanResponse } from '@routewise/shared';
import { useI18n } from '../i18n';
import { formatDistance, formatDuration, formatMoney, formatTime } from '../lib/format';
import { QualityBadge } from './QualityBadge';
import { formatCo2, journeyImpact } from '../lib/impact';
import { Icon, MODE_ICONS } from './Icon';

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

const MODE_COLORS: Record<string, string> = {
  walk: '#557098',
  cycle: '#0ea5e9',
  bus: '#f59e0b',
  metro: '#2563eb',
  subway: '#1d4ed8',
  train: '#7c3aed',
  commuter_rail: '#6d28d9',
  tram: '#10b981',
  light_rail: '#059669',
  ferry: '#0891b2',
  cable_tram: '#db2777',
  funicular: '#be123c',
  trolleybus: '#d97706',
  monorail: '#9333ea',
  taxi: '#475569',
  ride: '#475569',
  other: '#64748b',
};

interface Props {
  journey: Journey;
  plan: PlanResponse;
  selected: boolean;
  onSelect: () => void;
  onSave?: () => void;
  onShare?: () => void;
  saved?: boolean;
  units: DistanceUnits;
  timezone: string;
  readOnly?: boolean;
  recommended?: boolean;
}

function modeLabel(t: (key: never) => string, mode: string): string {
  return t((MODE_KEYS[mode] ?? 'mode.other') as never);
}

export function JourneyCard({
  journey,
  plan,
  selected,
  onSelect,
  onSave,
  onShare,
  saved,
  units,
  timezone,
  readOnly,
  recommended,
}: Props) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [showAllStops, setShowAllStops] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const detailsId = useId();

  const converted = journey.fare.convertedTotal;
  const total = journey.fare.total;
  const displayFare = converted ?? total;
  const fareNote = journey.fare.note ?? null;

  const depart = journey.departureTime ? formatTime(journey.departureTime, timezone, locale) : null;
  const arrive = journey.arrivalTime ? formatTime(journey.arrivalTime, timezone, locale) : null;
  const transitLegs = journey.legs.filter((leg) => leg.mode !== 'walk' && leg.mode !== 'cycle');
  const impact = journeyImpact(journey.legs);
  const modes = Array.from(new Set(transitLegs.map((leg) => leg.mode)));

  const summary = [
    `${plan.origin.name} → ${plan.destination.name}`,
    depart && arrive ? `${depart} – ${arrive}` : '',
    formatDuration(journey.durationSeconds, locale),
    `${journey.transfers} ${t('results.transfers')}`,
    displayFare ? formatMoney(displayFare.amount, displayFare.currency, locale) : '',
    ...journey.legs.map(
      (leg) => `${leg.mode === 'walk' ? '🚶' : '→'} ${leg.instruction}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('results.copy'), summary);
    }
  };

  return (
    <article
      className={`print-block card overflow-hidden transition-all duration-200 ${
        selected ? 'ring-2 ring-signal-500 ring-offset-1 ring-offset-canvas' : 'hover:border-ink-300 hover:shadow-lift'
      }`}
      aria-label={`${depart ?? ''} ${plan.origin.name} ${t('form.destination')} ${plan.destination.name}, ${formatDuration(journey.durationSeconds, locale)}, ${journey.transfers} ${t('results.transfers')}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full p-4 text-left focus:outline-none focus-visible:bg-ink-50 sm:p-5"
        aria-pressed={selected}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[22px] font-extrabold leading-none tracking-tight text-ink-900 tabular-nums sm:text-2xl">
                {depart ?? '—'}
              </span>
              <Icon name="arrow-right" size={16} className="text-ink-300" />
              <span className="text-[22px] font-extrabold leading-none tracking-tight text-ink-900 tabular-nums sm:text-2xl">
                {arrive ?? '—'}
              </span>
              {recommended ? (
                <span className="chip chip-ok ml-1">
                  <Icon name="sparkles" size={11} />
                  {t('results.recommended')}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-600">
              <span className="font-semibold text-ink-900">{formatDuration(journey.durationSeconds, locale)}</span>
              <span className="text-ink-300">·</span>
              <span>
                {journey.transfers} {t('results.transfers')}
              </span>
              <span className="text-ink-300">·</span>
              <span className="inline-flex items-center gap-1">
                <Icon name="walk" size={13} className="text-ink-400" />
                {formatDistance(journey.walkingMeters, units, locale)}
              </span>
            </p>
            {impact.savedGrams > 0 ? (
              <p className="mt-1.5">
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--ok-bg))] px-2 py-0.5 text-[11px] font-semibold text-[rgb(var(--ok-fg))]"
                  title={t('impact.hint')}
                >
                  <Icon name="leaf" size={11} />
                  {t('impact.saved', { amount: formatCo2(impact.savedGrams, locale) })}
                </span>
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <QualityBadge quality={journey.dataQuality} />
            {displayFare ? (
              <div className="text-right">
                <p className="text-base font-bold text-ink-900">{formatMoney(displayFare.amount, displayFare.currency, locale)}</p>
                {converted && total && converted.currency !== total.currency ? (
                  <p className="text-[11px] text-ink-500">{formatMoney(total.amount, total.currency, locale)}</p>
                ) : null}
              </div>
            ) : (
              <span className="chip">{t('results.fareUnknown')}</span>
            )}
          </div>
        </div>

        {/* Journey shape: time-proportional legs with mode colours and icons. */}
        <div className="mt-3.5 flex items-center gap-1" aria-hidden="true">
          {journey.legs.map((leg, index) => (
            <div
              key={`${journey.id}-seg-${index}`}
              className="flex min-w-[14px] items-center justify-center rounded-full"
              style={{
                backgroundColor: MODE_COLORS[leg.mode] ?? MODE_COLORS.other,
                opacity: leg.mode === 'walk' ? 0.4 : 1,
                flexGrow: Math.max(1, leg.durationSeconds),
                height: 6,
              }}
            />
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {transitLegs.slice(0, 5).map((leg, index) => (
            <span key={`${journey.id}-chip-${index}`} className="chip chip-outline" title={leg.route?.longName ?? undefined}>
              <Icon name={MODE_ICONS[leg.mode] ?? 'route'} size={12} />
              <span className="max-w-[9rem] truncate">{leg.route?.shortName ?? modeLabel(t, leg.mode)}</span>
            </span>
          ))}
          {transitLegs.length === 0 ? (
            <span className="chip">
              <Icon name={modes[0] === 'cycle' ? 'bike' : 'walk'} size={12} />
              {t('results.activeOnly')}
            </span>
          ) : null}
        </div>
      </button>

      {journey.warnings.length > 0 ? (
        <ul className="mx-4 mb-1 space-y-1 border-t border-line pt-2.5 sm:mx-5">
          {journey.warnings.slice(0, 3).map((warning) => (
            <li key={warning} className="flex gap-1.5 text-[11px] leading-relaxed text-[rgb(var(--warn-fg))]">
              <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-4 pt-2 sm:px-5">
        <button
          type="button"
          className="btn-secondary btn-sm"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
          {expanded ? t('results.hide') : t('results.open')}
        </button>
        {!readOnly && onSave ? (
          <button type="button" className={`btn-sm ${saved ? 'btn-primary' : 'btn-secondary'}`} onClick={onSave} aria-pressed={Boolean(saved)}>
            <Icon name="bookmark" size={14} />
            {saved ? t('results.saved') : t('results.save')}
          </button>
        ) : null}
        {!readOnly && onShare ? (
          <button type="button" className="btn-secondary btn-sm" onClick={onShare}>
            <Icon name="share" size={14} />
            {t('results.share')}
          </button>
        ) : null}
        <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => void copySummary()} title={t('results.copy')}>
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          <span className="hidden sm:inline">{copied ? t('results.copied') : t('results.copy')}</span>
        </button>
      </div>

      {expanded ? (
        <div id={detailsId} className="border-t border-line bg-raised px-4 py-4 sm:px-5">
          <ol className="space-y-0">
            {journey.legs.map((leg, index) => (
              <LegRow
                key={`${journey.id}-leg-${index}`}
                leg={leg}
                index={index}
                total={journey.legs.length}
                timezone={timezone}
                units={units}
                showAllStops={showAllStops === `${journey.id}-${index}`}
                onToggleStops={() =>
                  setShowAllStops((current) => (current === `${journey.id}-${index}` ? null : `${journey.id}-${index}`))
                }
              />
            ))}
          </ol>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {transitLegs.map((leg, index) => (
              <div
                key={`${journey.id}-board-${index}`}
                className="rounded-xl border border-line bg-surface px-3 py-2 text-[11px] leading-relaxed"
              >
                <p className="flex items-center gap-1.5 font-semibold text-ink-900">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: MODE_COLORS[leg.mode] ?? MODE_COLORS.other }}
                    aria-hidden="true"
                  />
                  {leg.route?.shortName ?? modeLabel(t, leg.mode)}
                </p>
                <p className="text-ink-600">
                  {t('results.boardAt')} <span className="font-medium text-ink-800">{leg.from.name}</span>
                  {leg.from.platformCode ? ` · ${t('results.platform')} ${leg.from.platformCode}` : ''}
                </p>
                <p className="text-ink-600">
                  {t('results.alightAt')} <span className="font-medium text-ink-800">{leg.to.name}</span>
                </p>
                {leg.fare ? (
                  <p className="mt-0.5 text-ink-500">
                    {t('results.legFare')}: {formatMoney(leg.fare.amount, leg.fare.currency, locale)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          {impact.activeMinutes > 0 ? (
            <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-600">
              <Icon name="walk" size={12} className="shrink-0 text-signal-600" />
              {t('impact.active', {
                steps: new Intl.NumberFormat(locale).format(impact.steps),
                minutes: impact.activeMinutes,
              })}
            </p>
          ) : null}

          <div className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
            <Icon name="pin" size={15} className="mt-0.5 shrink-0 text-signal-600" />
            <div className="min-w-0 text-xs text-ink-600">
              <p className="font-semibold text-ink-900">{plan.destination.name}</p>
              {plan.destination.displayName && plan.destination.displayName !== plan.destination.name ? (
                <p className="truncate text-ink-500">{plan.destination.displayName}</p>
              ) : null}
            </div>
          </div>

          {fareNote ? (
            <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-500">
              <Icon name="info" size={12} className="mt-0.5 shrink-0" />
              {fareNote}
            </p>
          ) : null}
          {journey.rankingNote ? (
            <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-500">
              <Icon name="sparkles" size={12} className="mt-0.5 shrink-0" />
              {journey.rankingNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function LegRow({
  leg,
  index,
  total,
  timezone,
  units,
  showAllStops,
  onToggleStops,
}: {
  leg: JourneyLeg;
  index: number;
  total: number;
  timezone: string;
  units: DistanceUnits;
  showAllStops: boolean;
  onToggleStops: () => void;
}) {
  const { t, locale } = useI18n();
  const color = MODE_COLORS[leg.mode] ?? MODE_COLORS.other;
  const stops = leg.intermediateStops ?? [];

  return (
    <li className="flex gap-3">
      <div className="flex w-11 shrink-0 flex-col items-end pt-0.5 text-[11px] font-semibold tabular-nums text-ink-500">
        {leg.startTime ? formatTime(leg.startTime, timezone, locale) : '—'}
      </div>
      <div className="flex flex-col items-center">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        >
          <Icon name={MODE_ICONS[leg.mode] ?? 'route'} size={14} strokeWidth={2} />
        </span>
        {index < total - 1 ? <span className="my-1 w-px flex-1 bg-ink-200" aria-hidden="true" /> : null}
      </div>
      <div className={`min-w-0 flex-1 ${index < total - 1 ? 'pb-4' : ''}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          {leg.route?.shortName ? (
            <span
              className="rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {leg.route.shortName}
            </span>
          ) : null}
          <span className="text-[13px] font-semibold text-ink-900">{leg.instruction}</span>
          {leg.dataQuality === 'live' ? (
            <span className="chip chip-ok" title={t('quality.live')}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {t('quality.live')}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
          {leg.startTime && leg.endTime ? (
            <span>
              {formatTime(leg.startTime, timezone, locale)} – {formatTime(leg.endTime, timezone, locale)}
            </span>
          ) : null}
          {leg.durationSeconds > 0 ? <span>{formatDuration(leg.durationSeconds, locale)}</span> : null}
          {leg.distanceMeters > 0 ? <span>{formatDistance(leg.distanceMeters, units, locale)}</span> : null}
          {leg.from.platformCode ? <span>{t('results.platform')} {leg.from.platformCode}</span> : null}
          {leg.route?.agencyName ? <span>{leg.route.agencyName}</span> : null}
        </p>
        {leg.accessibility?.wheelchairAccessible === 'no' ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[rgb(var(--danger-fg))]">
            <Icon name="accessibility" size={12} />
            {t('results.notStepFree')}
          </p>
        ) : null}
        {stops.length > 0 ? (
          <div className="mt-1.5">
            <button type="button" className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-500 hover:text-ink-800" onClick={onToggleStops} aria-expanded={showAllStops}>
              <Icon name={showAllStops ? 'chevron-up' : 'chevron-down'} size={12} />
              {t('results.stopsCount', { count: stops.length })}
            </button>
            {showAllStops ? (
              <ol className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] text-ink-600">
                {stops.map((stop, stopIndex) => (
                  <li key={`${stop.name}-${stopIndex}`} className="flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-ink-300" aria-hidden="true" />
                    <span className="truncate">{stop.name}</span>
                  </li>
                ))}
                <li className="flex items-center gap-1.5 font-semibold text-ink-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal-500" aria-hidden="true" />
                  {leg.to.name}
                </li>
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
