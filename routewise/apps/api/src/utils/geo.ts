import type { LatLng, LngLat } from '@routewise/shared';
import { haversineMeters } from '@routewise/shared';

export { haversineMeters };

/** Deterministic bbox around a point (degrees). */
export function boundingBox(center: LatLng, radiusMeters: number) {
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/** Straight, two-point line (used when no road geometry is available). */
export function straightLine(a: LatLng, b: LatLng): LngLat[] {
  return [
    [a.lng, a.lat],
    [b.lng, b.lat],
  ];
}

/**
 * Estimated walking metrics when a pedestrian routing engine is unavailable.
 * Uses a detour factor of 1.3 over great-circle distance and 4.8 km/h. Callers
 * MUST label this as an estimate, never as a real-time or turn-by-turn result.
 */
export function estimateWalking(a: LatLng, b: LatLng) {
  const straight = haversineMeters(a, b);
  const distanceMeters = Math.round(straight * 1.3);
  const durationSeconds = Math.max(30, Math.round((distanceMeters / 1000 / 4.8) * 3600));
  return { distanceMeters, durationSeconds, estimated: true as const };
}

/** Number of whole days between two YYYY-MM-DD dates (UTC interpretation). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** ISO date (YYYY-MM-DD) for an instant in a given IANA time zone. */
export function isoDateInZone(instant: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(instant);
}

/** Local seconds-since-midnight for an instant in a given IANA time zone. */
export function localSecondsInZone(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return Number(parts.hour ?? 0) * 3600 + Number(parts.minute ?? 0) * 60 + Number(parts.second ?? 0);
}

/**
 * Convert a local wall-clock date + seconds-since-midnight in a time zone to a
 * UTC instant. Handles the common cases; around DST transitions the result is
 * accurate to the transition offset (documented limitation for GTFS).
 */
export function zonedDateTimeToInstant(dateIso: string, seconds: number, timeZone: string): Date {
  const [y = 1970, m = 1, d = 1] = dateIso.split('-').map(Number);
  const daySeconds = ((seconds % 86_400) + 86_400) % 86_400;
  const dayOffset = Math.floor(seconds / 86_400);
  const hour = Math.floor(daySeconds / 3600);
  const minute = Math.floor((daySeconds % 3600) / 60);
  const second = daySeconds % 60;

  // First guess: treat the wall clock as UTC, then correct by the zone offset at
  // that instant (iterated once for DST boundaries).
  let guess = Date.UTC(y, m - 1, d + dayOffset, hour, minute, second);
  for (let i = 0; i < 2; i += 1) {
    const offset = zoneOffsetMs(new Date(guess), timeZone);
    const next = Date.UTC(y, m - 1, d + dayOffset, hour, minute, second) - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** Offset of a time zone at an instant, in milliseconds (east positive). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
