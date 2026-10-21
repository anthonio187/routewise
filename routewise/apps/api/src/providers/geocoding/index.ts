import type { LatLng, Place } from '@routewise/shared';
import { config } from '../../config.js';
import type { GeocodeOptions, GeocodingProvider } from './types.js';
import { NominatimProvider } from './nominatim.js';

class DisabledGeocoder implements GeocodingProvider {
  readonly name = 'disabled';
  readonly configured = false;
  readonly attribution = 'Geocoding provider disabled';
  async search(): Promise<Place[]> {
    return [];
  }
  async reverse(): Promise<Place | null> {
    return null;
  }
}

/**
 * Place search facade.
 *
 * When a database is configured, results from the local stops/places tables are
 * merged in first (so ingested GTFS stops are findable even if the external
 * geocoder is slow or unavailable). The external provider remains replaceable.
 */
class GeocodingService implements GeocodingProvider {
  constructor(private readonly delegate: GeocodingProvider) {}

  get name() {
    return this.delegate.name;
  }
  get configured() {
    return this.delegate.configured;
  }
  get attribution() {
    return this.delegate.attribution;
  }

  async search(query: string, options: GeocodeOptions = {}): Promise<Place[]> {
    const external = await this.delegate.search(query, options).catch((err) => {
      console.warn(`[geocoding:${this.delegate.name}] ${String(err)}`);
      return [] as Place[];
    });

    let local: Place[] = [];
    try {
      const { searchStops } = await import('../../db/repos/stops.js');
      const stops = await searchStops(query, options.limit ?? 8);
      local = stops.map((stop) => ({
        id: stop.id,
        name: stop.name,
        displayName: stop.code ? `${stop.name} (${stop.code})` : stop.name,
        location: stop.location,
        kind: 'stop' as const,
        provider: 'routewise-local',
      }));
    } catch {
      // Database unavailable — external results are still returned.
    }

    const merged: Place[] = [];
    const seen = new Set<string>();
    for (const place of [...local, ...external]) {
      const key = `${place.name.toLowerCase()}|${place.location.lat.toFixed(4)}|${place.location.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(place);
    }
    return merged.slice(0, options.limit ?? 8);
  }

  async reverse(location: LatLng, language?: string): Promise<Place | null> {
    return this.delegate.reverse(location, language);
  }
}

function createProvider(): GeocodingProvider {
  switch (config.GEOCODING_PROVIDER) {
    case 'nominatim':
      return new NominatimProvider();
    case 'maptiler':
      // Placeholder hook: implement MapTilerProvider following the same interface.
      console.warn('[geocoding] GEOCODING_PROVIDER=maptiler is not implemented yet; using disabled geocoder.');
      return new DisabledGeocoder();
    case 'disabled':
    default:
      return new DisabledGeocoder();
  }
}

export const geocodingService: GeocodingProvider = new GeocodingService(createProvider());

export const geocodingStatus = {
  provider: geocodingService.name,
  configured: geocodingService.configured,
  attribution: geocodingService.attribution,
};
