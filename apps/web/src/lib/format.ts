import type { DistanceUnits } from '@routewise/shared';

const LOCALE_FALLBACK = 'en';

export function resolveLocale(locale: string | undefined, fallback = LOCALE_FALLBACK): string {
  if (!locale) return fallback;
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length > 0 ? locale : fallback;
  } catch {
    return fallback;
  }
}

/** Format a money amount in its own ISO 4217 currency. Never assumes a currency. */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  const code = currency?.toUpperCase();
  if (!code || code === 'XXX') {
    return new Intl.NumberFormat(resolveLocale(locale), { maximumFractionDigits: 2 }).format(amount);
  }
  try {
    return new Intl.NumberFormat(resolveLocale(locale), {
      style: 'currency',
      currency: code,
      maximumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2,
      currencyDisplay: 'narrowSymbol',
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

export function formatNumber(value: number, locale?: string, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(resolveLocale(locale), { maximumFractionDigits }).format(value);
}

/** "1 h 05 min" style duration, locale-aware through Intl unit formatting. */
export function formatDuration(seconds: number, locale?: string): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const fmt = new Intl.NumberFormat(resolveLocale(locale), {
    style: 'unit',
    unit: hours > 0 ? 'hour' : 'minute',
    unitDisplay: 'short',
    maximumFractionDigits: 0,
  });
  const fmtMin = new Intl.NumberFormat(resolveLocale(locale), {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
    maximumFractionDigits: 0,
  });
  if (hours === 0) return fmt.format(totalMinutes);
  return minutes === 0 ? fmt.format(hours) : `${fmt.format(hours)} ${fmtMin.format(minutes)}`;
}

/** Distances respect the user's unit preference (metric by default, never assumed). */
export function formatDistance(meters: number, units: DistanceUnits = 'metric', locale?: string): string {
  const loc = resolveLocale(locale);
  if (units === 'imperial') {
    const feet = meters * 3.28084;
    if (feet < 1000) {
      return new Intl.NumberFormat(loc, {
        style: 'unit',
        unit: 'foot',
        unitDisplay: 'short',
        maximumFractionDigits: 0,
      }).format(Math.round(feet));
    }
    return new Intl.NumberFormat(loc, {
      style: 'unit',
      unit: 'mile',
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(meters / 1609.344);
  }
  if (meters < 1000) {
    return new Intl.NumberFormat(loc, {
      style: 'unit',
      unit: 'meter',
      unitDisplay: 'short',
      maximumFractionDigits: 0,
    }).format(Math.round(meters));
  }
  return new Intl.NumberFormat(loc, {
    style: 'unit',
    unit: 'kilometer',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(meters / 1000);
}

export function formatTime(iso: string | null | undefined, timeZone?: string, locale?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(resolveLocale(locale), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string, locale?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(resolveLocale(locale), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

export function formatRelative(iso: string, locale?: string): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(resolveLocale(locale), { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSeconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  return rtf.format(Math.round(diffSeconds / 86_400), 'day');
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
