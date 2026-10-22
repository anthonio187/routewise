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
    // The local city table (250 countries / 236k cities) answers in
    // milliseconds and needs no rate limit, so it is queried in parallel with
    // the external geocoder instead of after it. Cities are listed first: when
    // someone types "Lagos", the real city is the expected answer.
    const [external, local] = await Promise.all([
      this.delegate.search(query, options).catch((err) => {
        console.warn(`[geocoding:${this.delegate.name}] ${String(err)}`);
        return [] as Place[];
      }),
      this.localPlaces(query, options).catch((err) => {
        // A failure here must not hide external results, but it must be
        // visible: silently losing local cities made place search look broken.
        console.warn(`[geocoding:local] ${String(err)}`);
        return [] as Place[];
      }),
    ]);

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

  /**
   * Cities and transit stops already in the local database. Both are real
   * records (GeoNames / ingested GTFS), never placeholders, and they are what
   * make the search box feel instant.
   */
  private async localPlaces(query: string, options: GeocodeOptions): Promise<Place[]> {
    const limit = options.limit ?? 8;
    const [cities, stops] = await Promise.all([
      import('../../db/repos/cities.js').then(({ findCitiesForSearch }) =>
        findCitiesForSearch(query, Math.min(limit, 5), options.near),
      ),
      import('../../db/repos/stops.js').then(({ searchStops }) => searchStops(query, limit)),
    ]);

    return [
      ...cities.map((city) => ({
        id: `city:${city.id}`,
        name: city.name,
        displayName: `${city.name}, ${city.countryCode}`,
        location: city.location,
        kind: 'city' as const,
        provider: 'routewise-local',
        countryCode: city.countryCode,
        cityName: city.name,
      })),
      ...stops.map((stop) => ({
        id: stop.id,
        name: stop.name,
        displayName: stop.code ? `${stop.name} (${stop.code})` : stop.name,
        location: stop.location,
        kind: 'stop' as const,
        provider: 'routewise-local',
      })),
    ];
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
