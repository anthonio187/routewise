import type { Place, PlaceKind } from '@routewise/shared';
import { config } from '../../config.js';
import { SpacingLimiter, fetchWithTimeout } from '../../utils/limiter.js';
import { TtlCache } from '../../utils/cache.js';
import type { GeocodeOptions, GeocodingProvider } from './types.js';

interface NominatimPlace {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
  boundingbox?: [string, string, string, string];
}

/**
 * OpenStreetMap Nominatim geocoder.
 *
 * Usage policy: https://operations.osmfoundation.org/policies/nominatim/
 *  - absolute maximum 1 request/second, no bulk use
 *  - identifying User-Agent required
 * Public Nominatim is suitable for development/small deployments only. For
 * production traffic use a commercial provider (MapTiler, Geocode Earth, …) or
 * self-host Nominatim; only this file needs to change.
 */
export class NominatimProvider implements GeocodingProvider {
  readonly name = 'nominatim';
  readonly configured = true;
  readonly attribution = 'Geocoding © OpenStreetMap contributors (ODbL), via Nominatim';
  private readonly limiter = new SpacingLimiter(Math.max(1000, config.NOMINATIM_MIN_INTERVAL_MS));
  private readonly cache = new TtlCache<Place[]>(10 * 60_000, 400);

  private async request(
    query: string,
    options: GeocodeOptions,
    bounds: { bounded: boolean; degrees: number } | null,
  ): Promise<Place[]> {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(Math.min(options.limit ?? 8, 20)),
      'accept-language': options.language ?? 'en',
      dedupe: '1',
    });
    if (bounds && options.near) {
      const d = bounds.degrees;
      params.set(
        'viewbox',
        [options.near.lng - d, options.near.lat + d, options.near.lng + d, options.near.lat - d].join(','),
      );
      // Nominatim only *ranks* by viewbox unless bounded=1. Restricting the
      // first pass is what makes "post office" mean the one down the road
      // rather than one in another country.
      if (bounds.bounded) params.set('bounded', '1');
    }
    if (options.countryCode) params.set('countrycodes', options.countryCode.toLowerCase());

    const res = await this.limiter.run(() =>
      fetchWithTimeout(
        `${config.NOMINATIM_BASE_URL}/search?${params.toString()}`,
        { headers: { 'User-Agent': config.NOMINATIM_USER_AGENT, 'Accept-Language': options.language ?? 'en' } },
        config.PROVIDER_TIMEOUT_MS,
      ),
    );
    if (!res.ok) {
      throw new Error(`Nominatim search failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as NominatimPlace[];
    return data.map((item) => mapPlace(item));
  }

  async search(query: string, options: GeocodeOptions = {}): Promise<Place[]> {
    const key = JSON.stringify([query.trim().toLowerCase(), options.language, options.near, options.countryCode, options.limit]);
    const cached = this.cache.get(key);
    if (cached) return cached;

    if (!options.near) {
      const places = await this.request(query, options, null);
      this.cache.set(key, places);
      return places;
    }

    // Proximity search. Nominatim's viewbox only nudges the ranking of a
    // free-form query, which is why "post office" used to return one on the
    // other side of the planet. Two requests are issued: the plain term, and
    // the term qualified with the nearest city name ("market Maiduguri"),
    // which is what actually surfaces local POIs. Both are subject to the
    // same 1 request/second limit.
    const locality = await nearestLocality(options.near);
    const [plain, localised] = await Promise.all([
      this.request(query, options, { bounded: false, degrees: 0.3 }),
      locality
        ? this.request(`${query} ${locality.name} ${locality.countryName}`, options, null).catch(() => [])
        : Promise.resolve([]),
    ]);

    const places = rankByDistance(dedupe([...localised, ...plain]), options.near);
    this.cache.set(key, places);
    return places;
  }

  async reverse(location: { lat: number; lng: number }, language = 'en'): Promise<Place | null> {
    const key = `rev:${location.lat.toFixed(5)},${location.lng.toFixed(5)},${language}`;
    const cached = this.cache.get(key);
    if (cached?.[0]) return cached[0];

    const params = new URLSearchParams({
      lat: String(location.lat),
      lon: String(location.lng),
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '16',
      'accept-language': language,
    });
    const res = await this.limiter.run(() =>
      fetchWithTimeout(
        `${config.NOMINATIM_BASE_URL}/reverse?${params.toString()}`,
        { headers: { 'User-Agent': config.NOMINATIM_USER_AGENT } },
        config.PROVIDER_TIMEOUT_MS,
      ),
    );
    if (!res.ok) return null;
    const item = (await res.json()) as NominatimPlace & { error?: string };
    if (item.error) return null;
    const place = mapPlace(item);
    this.cache.set(key, [place]);
    return place;
  }
}

const KIND_MAP: Record<string, PlaceKind> = {
  'railway:station': 'station',
  'railway:halt': 'station',
  'railway:subway_entrance': 'station',
  'public_transport:station': 'station',
  'public_transport:stop_position': 'stop',
  'highway:bus_stop': 'stop',
  'amenity:bus_station': 'station',
  'amenity:ferry_terminal': 'station',
  'railway:platform': 'stop',
  'place:city': 'city',
  'place:town': 'city',
  'place:village': 'locality',
  'place:suburb': 'locality',
  'place:neighbourhood': 'locality',
  'amenity:airport': 'poi',
  'tourism:attraction': 'landmark',
  'tourism:museum': 'landmark',
  'historic:monument': 'landmark',
  'boundary:administrative': 'locality',
  'highway:residential': 'address',
  'building:yes': 'address',
};

function mapPlace(item: NominatimPlace): Place {
  const kind: PlaceKind =
    (item.class && item.type && KIND_MAP[`${item.class}:${item.type}`]) ||
    (item.class === 'place' ? 'locality' : item.type === 'house' || item.type === 'yes' ? 'address' : 'other');

  const address = item.address ?? {};
  return {
    id: item.osm_type && item.osm_id ? `osm:${item.osm_type}:${item.osm_id}` : `nominatim:${item.place_id}`,
    name: item.name || item.display_name.split(',')[0] || item.display_name,
    displayName: item.display_name,
    location: { lat: Number(item.lat), lng: Number(item.lon) },
    kind,
    provider: 'nominatim',
    countryCode: address.country_code ? address.country_code.toUpperCase() : null,
    cityName: address.city || address.town || address.village || address.municipality || null,
    properties: {
      osmType: item.osm_type,
      osmId: item.osm_id,
      class: item.class,
      type: item.type,
      address,
      boundingbox: item.boundingbox,
    },
  };
}

/** Straight-line distance in metres; enough for ranking suggestions. */
function metresBetween(a: GeocodeOptions['near'], b: { lat: number; lng: number }): number {
  if (!a) return Number.POSITIVE_INFINITY;
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function dedupe(places: Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const place of places) {
    const key = `${place.name.toLowerCase()}|${place.location.lat.toFixed(4)}|${place.location.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

/**
 * Order results so that anything within 50 km of the traveller comes first,
 * nearest first; everything else keeps the provider's own ranking. Results are
 * never dropped — a global app must still find a place when nothing local
 * matches, and the UI shows the country for each suggestion.
 */
function rankByDistance(places: Place[], near: GeocodeOptions['near']): Place[] {
  const local = places
    .map((place) => ({ place, metres: metresBetween(near, place.location) }))
    .filter((entry) => entry.metres <= 50_000)
    .sort((a, b) => a.metres - b.metres)
    .map((entry) => entry.place);
  const rest = places.filter((place) => !local.includes(place));
  return [...local, ...rest];
}

/**
 * Nearest seeded city for the point, used to qualify POI queries by locality.
 * The country name is included because bare city names are ambiguous: "post
 * office Berlin" alone matches a street in Massachusetts.
 */
async function nearestLocality(
  near: { lat: number; lng: number },
): Promise<{ name: string; countryName: string } | null> {
  try {
    const { findNearestCityWithCountry } = await import('../../db/repos/cities.js');
    const city = await findNearestCityWithCountry(near.lat, near.lng, 60);
    return city ? { name: city.name, countryName: city.countryName } : null;
  } catch {
    return null;
  }
}
