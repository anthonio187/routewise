import { useEffect, useMemo, useState } from 'react';
import type { ApiMeta } from '@routewise/shared';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n, supportedLanguages } from '../i18n';
import { browserTimeZone, formatMoney } from '../lib/format';
import { localSavedStore, recentPlacesStore, settingsStore, lastPlanStore } from '../lib/storage';
import { useSettings, useTheme } from '../lib/theme';
import { Icon, type IconName } from '../components/Icon';
import { useToast } from '../components/Toast';

const CURRENCIES = [
  'NGN', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'KES', 'GHS', 'ZAR', 'EGP', 'MAD',
  'BRL', 'MXN', 'ARS', 'CAD', 'AUD', 'NZD', 'SGD', 'MYR', 'IDR', 'THB', 'VND', 'PHP',
  'AED', 'SAR', 'QAR', 'TRY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RUB',
  'UAH', 'ILS', 'KRW', 'HKD', 'TWD', 'PKR', 'BDT', 'LKR', 'ETB', 'TZS', 'UGX', 'XOF',
];

function timeZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

export function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const settings = useSettings();
  const { resolved } = useTheme();
  const { toast } = useToast();

  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [rate, setRate] = useState<{ value: number; asOf: string } | null>(null);
  const [tzError, setTzError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(), []);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    if (!settings.currency) {
      setRate(null);
      return;
    }
    let cancelled = false;
    api
      .fx('EUR', [settings.currency])
      .then((response) => {
        const entry = response.rates[settings.currency!];
        if (!cancelled) setRate(entry ? { value: entry.rate, asOf: entry.asOf } : null);
      })
      .catch(() => {
        if (!cancelled) setRate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.currency]);

  const update = (patch: Parameters<typeof settingsStore.set>[0]) => {
    const next = settingsStore.set(patch);
    // Persist the merged result: sending the pre-patch snapshot would silently
    // write the old value back over the change the person just made.
    void api
      .savePreferences({
        preferredLanguage: next.language ?? locale,
        preferredCurrency: next.currency,
        units: next.units ?? 'metric',
        timezone: next.timezone,
      })
      .catch(() => undefined);
  };

  const setTimezone = (value: string) => {
    if (!value) {
      setTzError(null);
      update({ timezone: null });
      return;
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      setTzError(null);
      update({ timezone: value });
    } catch {
      setTzError(t('settings.unknownTimezone'));
    }
  };

  const currencyLabel = (code: string) => {
    try {
      const name = new Intl.DisplayNames([locale], { type: 'currency' }).of(code);
      return name ? `${code} — ${name}` : code;
    } catch {
      return code;
    }
  };

  const clearLocalData = () => {
    localSavedStore.all().forEach((entry) => localSavedStore.remove(entry.id));
    lastPlanStore.set(null);
    try {
      localStorage.removeItem('routewise.recent-places.v1');
      localStorage.removeItem('routewise.last-plan.v1');
    } catch {
      // ignore
    }
    recentPlacesStore.all();
    toast({ title: t('settings.dataCleared'), tone: 'success' });
    window.setTimeout(() => window.location.reload(), 600);
  };

  const themes: Array<{ value: 'light' | 'dark' | 'system'; icon: IconName; label: string }> = [
    { value: 'light', icon: 'sun', label: t('settings.themeLight') },
    { value: 'dark', icon: 'moon', label: t('settings.themeDark') },
    { value: 'system', icon: 'monitor', label: t('settings.themeSystem') },
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">{t('settings.heading')}</h1>
        <p className="mt-0.5 text-sm text-ink-600">{t('settings.subtitle')}</p>
      </header>

      {/* Appearance */}
      <section className="card p-4 sm:p-5">
        <SectionTitle icon="sun" title={t('settings.appearance')} hint={t('settings.appearanceHint')} />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {themes.map((theme) => (
            <button
              key={theme.value}
              type="button"
              onClick={() => update({ theme: theme.value })}
              aria-pressed={(settings.theme ?? 'system') === theme.value}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                (settings.theme ?? 'system') === theme.value
                  ? 'border-signal-500 bg-signal-50 shadow-sm'
                  : 'border-line bg-surface hover:border-ink-300'
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-700">
                <Icon name={theme.icon} size={17} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink-900">{theme.label}</span>
                {theme.value === 'system' ? (
                  <span className="block text-[11px] text-ink-500">
                    {resolved === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}
                  </span>
                ) : null}
              </span>
              {(settings.theme ?? 'system') === theme.value ? (
                <Icon name="check" size={16} className="ml-auto text-signal-600" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          <Toggle
            checked={settings.largerText}
            onChange={(value) => update({ largerText: value })}
            label={t('settings.largerText')}
            hint={t('settings.largerTextHint')}
          />
        </div>
      </section>

      {/* Language & region */}
      <section className="card p-4 sm:p-5">
        <SectionTitle icon="globe" title={t('settings.region')} hint={t('settings.regionHint')} />
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="language">{t('settings.language')}</label>
            <select
              id="language"
              className="input"
              value={locale}
              onChange={(event) => {
                setLocale(event.target.value);
                update({ language: event.target.value });
              }}
            >
              {supportedLanguages.map((language) => (
                <option key={language.code} value={language.code}>{language.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-500">{t('settings.languageHint')}</p>
          </div>

          <div>
            <label className="label" htmlFor="units">{t('settings.units')}</label>
            <select
              id="units"
              className="input"
              value={settings.units ?? ''}
              onChange={(event) => update({ units: (event.target.value as 'metric' | 'imperial' | '') || null })}
            >
              <option value="">{t('settings.unitsAuto')}</option>
              <option value="metric">{t('settings.unitsMetric')}</option>
              <option value="imperial">{t('settings.unitsImperial')}</option>
            </select>
            <p className="mt-1 text-[11px] text-ink-500">
              {t('settings.currentUnits', { units: settings.units ?? t('settings.unitsAuto') })}
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="timezone">{t('settings.timezone')}</label>
            {zones.length > 0 ? (
              <select
                id="timezone"
                className="input"
                value={settings.timezone ?? ''}
                onChange={(event) => setTimezone(event.target.value)}
              >
                <option value="">{t('settings.timezoneAuto', { zone: browserTimeZone() })}</option>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            ) : (
              <input
                id="timezone"
                className="input"
                value={settings.timezone ?? ''}
                onChange={(event) => setTimezone(event.target.value.trim())}
                placeholder={browserTimeZone()}
              />
            )}
            {tzError ? <p className="mt-1 text-[11px] text-[rgb(var(--danger-fg))]">{tzError}</p> : null}
            <p className="mt-1 text-[11px] text-ink-500">{t('settings.timezoneHint')}</p>
          </div>
        </div>
      </section>

      {/* Money */}
      <section className="card p-4 sm:p-5">
        <SectionTitle icon="zap" title={t('settings.money')} hint={t('settings.moneyHint')} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-start">
          <div>
            <label className="label" htmlFor="currency">{t('settings.currency')}</label>
            <select
              id="currency"
              className="input"
              value={settings.currency ?? ''}
              onChange={(event) => update({ currency: event.target.value || null })}
            >
              <option value="">{t('settings.currencyAuto')}</option>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>{currencyLabel(code)}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-500">{t('settings.currencyHint')}</p>
          </div>
          <div className="rounded-xl border border-line bg-raised p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{t('settings.fxPreview')}</p>
            {settings.currency ? (
              rate ? (
                <>
                  <p className="mt-1 text-lg font-extrabold tabular-nums text-ink-900">
                    1 EUR = {formatMoney(rate.value, settings.currency, locale)}
                  </p>
                  <p className="text-[10px] text-ink-400">
                    open.er-api.com · {new Date(rate.asOf).toLocaleString(locale)}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-500">{t('settings.fxUnavailable')}</p>
              )
            ) : (
              <p className="mt-1 text-sm text-ink-500">{t('settings.fxAuto')}</p>
            )}
          </div>
        </div>
      </section>

      {/* Accessibility */}
      <section className="card p-4 sm:p-5">
        <SectionTitle icon="accessibility" title={t('settings.accessibility')} hint={t('settings.accessibilityHint')} />
        <div className="mt-3 space-y-3">
          <Toggle
            checked={settings.stepFreeByDefault}
            onChange={(value) => update({ stepFreeByDefault: value })}
            label={t('form.stepFree')}
            hint={t('form.stepFreeHint')}
          />
          <p className="rounded-xl bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
            <Icon name="info" size={12} className="mr-1 inline" />
            {t('settings.a11yNote')}
          </p>
        </div>
      </section>

      {/* Data & privacy */}
      <section className="card p-4 sm:p-5">
        <SectionTitle icon="shield" title={t('settings.privacy')} hint={t('settings.privacyHint')} />
        <ul className="mt-3 space-y-1.5 text-xs text-ink-600">
          <li className="flex items-start gap-2"><Icon name="check" size={14} className="mt-0.5 text-signal-600" />{t('settings.privacyLocal')}</li>
          <li className="flex items-start gap-2"><Icon name="check" size={14} className="mt-0.5 text-signal-600" />{t('settings.privacyToken')}</li>
          <li className="flex items-start gap-2"><Icon name="check" size={14} className="mt-0.5 text-signal-600" />{t('settings.privacyNoTracking')}</li>
        </ul>
        <button type="button" className="btn-danger btn-sm mt-3" onClick={clearLocalData}>
          <Icon name="trash" size={14} />
          {t('settings.clearData')}
        </button>
      </section>

      {/* Providers */}
      <section className="card p-4 sm:p-5">
        <SectionTitle icon="layers" title={t('settings.providers')} hint={t('settings.providersHint')} />
        {meta ? (
          <ul className="mt-3 space-y-2 text-xs text-ink-600">
            {Object.entries(meta.providers).map(([key, provider]) => (
              <li key={key} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold capitalize text-ink-800">{key}</span>
                <span className="chip chip-outline">{provider.provider}</span>
                <span className={`chip ${provider.configured ? 'chip-ok' : 'chip-warn'}`}>
                  {provider.configured ? t('settings.configured') : t('settings.notConfigured')}
                </span>
                {provider.attribution ? <span className="w-full text-[11px] text-ink-500">{provider.attribution}</span> : null}
                {provider.note ? <span className="w-full text-[11px] text-[rgb(var(--warn-fg))]">{provider.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-500">{t('common.loading')}</p>
        )}
      </section>

      <section className="card p-4 sm:p-5">
        <SectionTitle icon="bus" title={t('settings.dataSources')} hint={t('settings.dataSourcesHint')} />
        {meta && meta.dataSources.length > 0 ? (
          <ul className="mt-3 space-y-2 text-xs text-ink-600">
            {meta.dataSources.map((source) => (
              <li key={source.code}>
                <span className="font-semibold text-ink-800">{source.name}</span>
                {source.licenseName ? ` · ${source.licenseName}` : ''}
                <span className="ml-1 inline-flex gap-1">
                  <span className={`chip ${source.isOfficial ? 'chip-ok' : ''}`}>
                    {source.isOfficial ? t('settings.official') : t('settings.community')}
                  </span>
                  <span className="chip">{source.freshness ?? 'unknown'}</span>
                </span>
                {source.attribution ? <span className="mt-0.5 block text-ink-500">{source.attribution}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-500">{t('settings.noSources')}</p>
        )}
        <p className="mt-3 rounded-xl bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
          {t('settings.referenceData')}
        </p>
      </section>

      <section className="card p-4 sm:p-5">
        <SectionTitle icon="info" title={t('settings.about')} />
        <p className="mt-2 text-sm leading-relaxed text-ink-600">{t('settings.aboutText')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
          <span className="chip">{t('settings.version')} {meta?.version ?? '0.1.0'}</span>
          <Link to="/explore" className="chip chip-outline">{t('explore.title')}</Link>
          <a className="chip chip-outline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">
            OpenStreetMap <Icon name="external" size={11} />
          </a>
          <a className="chip chip-outline" href="https://transitous.org/sources/" target="_blank" rel="noreferrer noopener">
            Transitous <Icon name="external" size={11} />
          </a>
          <a className="chip chip-outline" href="https://www.geonames.org/" target="_blank" rel="noreferrer noopener">
            GeoNames <Icon name="external" size={11} />
          </a>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-700">
        <Icon name={icon} size={16} />
      </span>
      <div>
        <h2 className="text-[15px] font-bold text-ink-900">{title}</h2>
        {hint ? <p className="text-[11px] leading-relaxed text-ink-500">{hint}</p> : null}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-line bg-surface p-3">
      <span>
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-500">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-signal-500' : 'bg-ink-200'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  );
}
