import type { LngLat } from '@routewise/shared';

export interface StreetRoute {
  geometry: LngLat[];
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
  /** True when the result is a straight-line estimate rather than a road route. */
  estimated: boolean;
  /** Explain how the route was produced (e.g. which OSRM profile). */
  note?: string;
}

export interface StreetRoutingProvider {
  readonly name: string;
  readonly configured: boolean;
  readonly attribution: string;
  route(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    profile: 'foot' | 'bike',
  ): Promise<StreetRoute>;
}
