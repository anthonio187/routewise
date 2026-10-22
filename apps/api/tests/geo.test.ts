import { describe, expect, it } from 'vitest';
import {
  estimateWalking,
  isoDateInZone,
  zonedDateTimeToInstant,
  zoneOffsetMs,
} from '../src/utils/geo.js';

describe('time zone helpers', () => {
  it('converts a Berlin wall-clock time to UTC across DST', () => {
    // 19 Oct 2026 08:00 in Berlin is CEST (UTC+2) → 06:00Z.
    const instant = zonedDateTimeToInstant('2026-10-19', 8 * 3600, 'Europe/Berlin');
    expect(instant.toISOString()).toBe('2026-10-19T06:00:00.000Z');
  });

  it('handles zones east of UTC', () => {
    const instant = zonedDateTimeToInstant('2026-10-19', 8 * 3600, 'Asia/Tokyo');
    expect(instant.toISOString()).toBe('2026-10-18T23:00:00.000Z');
  });

  it('computes ISO dates in the requested zone', () => {
    const instant = new Date('2026-10-18T23:30:00.000Z');
    // Tokyo is UTC+9 → already the 19th; London is UTC+1 in October (BST) → also the 19th;
    // New York is UTC-4 in October (EDT) → still the 18th.
    expect(isoDateInZone(instant, 'Asia/Tokyo')).toBe('2026-10-19');
    expect(isoDateInZone(instant, 'Europe/London')).toBe('2026-10-19');
    expect(isoDateInZone(instant, 'America/New_York')).toBe('2026-10-18');
  });

  it('reports the zone offset in milliseconds', () => {
    expect(zoneOffsetMs(new Date('2026-10-19T06:00:00Z'), 'Europe/Berlin')).toBe(2 * 3600 * 1000);
    expect(zoneOffsetMs(new Date('2026-12-19T06:00:00Z'), 'Europe/Berlin')).toBe(1 * 3600 * 1000);
  });
});

describe('walking estimates', () => {
  it('applies a detour factor and walking speed instead of straight-line time', () => {
    const a = { lat: 52.52, lng: 13.405 };
    const b = { lat: 52.53, lng: 13.405 };
    const estimate = estimateWalking(a, b);
    // ~1.11 km straight → ~1.45 km walking → ~18 minutes.
    expect(estimate.distanceMeters).toBeGreaterThan(1300);
    expect(estimate.durationSeconds).toBeGreaterThan(900);
    expect(estimate.estimated).toBe(true);
  });
});
