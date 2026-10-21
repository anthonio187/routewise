import type { LngLat } from '@routewise/shared';
import { haversineMeters } from '@routewise/shared';
import { config } from '../../config.js';
import type { StreetRoute, StreetRoutingProvider } from './types.js';

/** Straight-line estimate used when no pedestrian routing engine is configured. */
export class HaversineStreetProvider implements StreetRoutingProvider {
  readonly name = 'haversine';
  readonly configured = true;
  readonly attribution = 'Distance estimated from coordinates; no street-network routing used.';

  async route(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: 'foot' | 'bike',
  ): Promise<StreetRoute> {
    const straight = haversineMeters(from, to);
    const distanceMeters = Math.round(straight * 1.3);
    const speedKmh = profile === 'bike' ? 14 : 4.8;
    const durationSeconds = Math.max(
      profile === 'bike' ? 60 : 30,
      Math.round((distanceMeters / 1000 / speedKmh) * 3600),
    );
    return {
      geometry: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ] as LngLat[],
      distanceMeters,
      durationSeconds,
      provider: 'haversine',
      estimated: true,
      note: `Estimated at ${speedKmh} km/h including a 1.3× detour factor. Not a turn-by-turn route.`,
    };
  }
}

interface OsrmRouteResponse {
  code?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry?: { coordinates?: Array<[number, number]> };
  }>;
}

/**
 * OSRM-compatible street routing. Works with self-hosted OSRM (recommended for
 * walking/cycling profiles) or other services exposing the same API shape.
 *
 * IMPORTANT: the public demo server (router.project-osrm.org) only guarantees a
 * car profile and ignores `foot`/`walking`; this provider therefore labels its
 * output as an estimate and the deployment docs recommend a configured instance.
 */
export class OsrmStreetProvider implements StreetRoutingProvider {
  readonly name = 'osrm';
  readonly configured = true;
  readonly attribution = 'Street routing via an OSRM-compatible service. Map data © OpenStreetMap contributors.';

  constructor(
    private readonly baseUrl: string,
    private readonly profile: string,
    private readonly timeoutMs: number,
    private readonly fallback: StreetRoutingProvider,
  ) {}

  async route(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: 'foot' | 'bike',
  ): Promise<StreetRoute> {
    const path = [from.lng, from.lat, to.lng, to.lat].join(';');
    const url = `${this.baseUrl.replace(/\/$/, '')}/route/v1/${encodeURIComponent(
      this.profile,
    )}/${path}?overview=full&geometries=geojson&steps=false`;

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'RouteWise/0.1' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const data = (await res.json()) as OsrmRouteResponse;
      const route = data.routes?.[0];
      if (data.code !== 'Ok' || !route?.geometry?.coordinates?.length) {
        throw new Error(`OSRM code ${data.code ?? 'unknown'}`);
      }
      return {
        geometry: route.geometry.coordinates as LngLat[],
        distanceMeters: Math.round(route.distance),
        durationSeconds: Math.round(route.duration),
        provider: this.name,
        estimated: false,
        note: `Street network route (OSRM profile "${this.profile}").`,
      };
    } catch (err) {
      console.warn(`[street:osrm] falling back to estimate: ${String(err)}`);
      const fallback = await this.fallback.route(from, to, profile);
      return {
        ...fallback,
        note: `${fallback.note ?? ''} (Street-routing service unavailable; estimate shown.)`.trim(),
      };
    }
  }
}

function create(): StreetRoutingProvider {
  const fallback = new HaversineStreetProvider();
  switch (config.STREET_ROUTING_PROVIDER) {
    case 'osrm':
      return new OsrmStreetProvider(
        config.OSRM_BASE_URL,
        config.OSRM_PROFILE,
        config.PROVIDER_TIMEOUT_MS,
        fallback,
      );
    case 'disabled':
    case 'haversine':
    default:
      return fallback;
  }
}

export const streetRouter: StreetRoutingProvider = create();
export { HaversineStreetProvider as EstimateStreetProvider };
