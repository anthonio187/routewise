/** Locale-aware, currency-explicit formatting helpers (server-side notices). */
export function formatMoney(amount: number, currency: string, locale = 'en'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function isoSeconds(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function roundToMinute(epochMs: number): number {
  return Math.ceil(epochMs / 60_000) * 60_000;
}
