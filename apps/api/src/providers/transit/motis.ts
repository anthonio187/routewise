import type { LngLat, TransportMode } from '@routewise/shared';
import type { TransitItinerary, TransitLeg, TransitPlanParams, TransitProvider } from './types.js';

interface MotisPlace {
  name?: string;
  stopId?: string;
  lat: number;
  lon: number;
  departure?: string;
  scheduledDeparture?: string;
  arrival?: string;
  scheduledArrival?: string;
  track?: string;
  cancelled?: boolean;
  wheelchair?: string;
}

interface MotisLeg {
  mode?: string;
  from?: MotisPlace;
  to?: MotisPlace;
  startTime?: string;
  endTime?: string;
  duration?: number;
  distance?: number;
  realTime?: boolean;
  routeShortName?: string;
  routeLongName?: string;
  agencyName?: string;
  headsign?: string;
  intermediateStops?: Array<{ name?: string; lat: number; lon: number }>;
  legGeometry?: { points: string; precision: number };
  cancelled?: boolean;
  wheelchair?: string;
}

interface MotisItinerary {
  duration?: number;
  startTime?: string;
  endTime?: string;
  transfers?: number;
  id?: string;
  legs?: MotisLeg[];
}

const MODE_MAP: Record<string, TransportMode> = {
  WALK: 'walk',
  BIKE: 'cycle',
  BUS: 'bus',
  COACH: 'bus',
  TROLLEYBUS: 'trolleybus',
  TRAM: 'tram',
  SUBWAY: 'subway',
  METRO: 'metro',
  RAIL: 'train',
  HIGHSPEED_RAIL: 'train',
  LONG_DISTANCE: 'train',
  NIGHT_RAIL: 'train',
  REGIONAL_FAST_RAIL: 'commuter_rail',
  REGIONAL_RAIL: 'commuter_rail',
  SUBURBAN: 'commuter_rail',
  FERRY: 'ferry',
  CABLE_CAR: 'cable_tram',
  FUNICULAR: 'funicular',
  GONDOLA: 'cable_tram',
  MONORAIL: 'monorail',
  AIRPLANE: 'other',
  ODRM: 'other',
  RIDE_SHARING: 'ride',
  OTHER: 'other',
};

/** Decode MOTIS' precision-scaled polyline (Google polyline delta encoding). */
export function decodePolyline(points: string, precision = 7): LngLat[] {
  const factor = 10 ** precision;
  const coords: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const readValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = points.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < points.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < points.length) {
    lat += readValue();
    lng += readValue();
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

function toIso(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isRealTime(leg: MotisLeg): boolean {
  if (leg.realTime) return true;
  const from = leg.from;
  if (!from?.departure || !from.scheduledDeparture) return false;
  return (
    Math.abs(new Date(from.departure).getTime() - new Date(from.scheduledDeparture).getTime()) > 30_000
  );
}

export interface MotisProviderOptions {
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
}

export class MotisProvider implements TransitProvider {
  readonly name = 'transitous';
  readonly configured = true;
  readonly attribution =
    'Transit data via Transitous (transitous.org), a community-run MOTIS instance. ' +
    'Source operators and licences: https://transitous.org/sources/. Map data © OpenStreetMap contributors.';
  readonly note =
    'Transitous is a volunteer-run, best-effort service for free/open-source and non-profit use. ' +
    'Do not use it for commercial traffic without permission.';

  constructor(private readonly options: MotisProviderOptions) {}

  async plan(params: TransitPlanParams): Promise<TransitItinerary[]> {
    const url = new URL('/api/v1/plan', this.options.baseUrl);
    url.searchParams.set('fromPlace', `${params.from.lat},${params.from.lng}`);
    url.searchParams.set('toPlace', `${params.to.lat},${params.to.lng}`);
    url.searchParams.set('time', params.departureTime.toISOString());
    url.searchParams.set('numItineraries', String(params.numItineraries ?? 5));
    url.searchParams.set('transitModes', 'TRANSIT');
    url.searchParams.set('detailedTransfers', 'true');
    if (params.arriveBy) url.searchParams.set('arriveBy', 'true');
    if (params.maxTransfers !== undefined) url.searchParams.set('maxTransfers', String(params.maxTransfers));
    if (params.locale) url.searchParams.set('language', params.locale.split('-')[0] ?? 'en');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Transit provider responded HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { itineraries?: MotisItinerary[] };
    return (data.itineraries ?? []).map((itinerary, index) => this.normalize(itinerary, index));
  }

  async searchStops(query: string, limit = 8) {
    const url = new URL('/api/v1/geocode', this.options.baseUrl);
    url.searchParams.set('text', query);
    url.searchParams.set('type', 'STOP');
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url, {
      headers: { 'User-Agent': this.options.userAgent },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!res.ok) throw new Error(`Transit stop search failed: HTTP ${res.status}`);
    const data = (await res.json()) as Array<{
      id: string;
      name: string;
      lat: number;
      lon: number;
      country?: string;
    }>;
    return data.map((stop) => ({
      id: `motis:${stop.id}`,
      name: stop.name,
      location: { lat: Number(stop.lat), lng: Number(stop.lon) },
      countryCode: stop.country ?? null,
    }));
  }

  private normalize(itinerary: MotisItinerary, index: number): TransitItinerary {
    const legs: TransitLeg[] = (itinerary.legs ?? []).map((leg) => {
      const from = leg.from;
      const to = leg.to;
      const precision = leg.legGeometry?.precision ?? 7;
      const geometry = leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points, precision) : [];
      const mode = MODE_MAP[(leg.mode ?? 'OTHER').toUpperCase()] ?? 'other';
      const realTime = isRealTime(leg);
      return {
        mode,
        rawMode: leg.mode ?? 'OTHER',
        routeId: null,
        routeShortName: leg.routeShortName ?? null,
        routeLongName: leg.routeLongName ?? null,
        agencyName: leg.agencyName ?? null,
        headsign: leg.headsign ?? null,
        from: {
          name: from?.name ?? '',
          location: { lat: Number(from?.lat ?? 0), lng: Number(from?.lon ?? 0) },
          stopId: from?.stopId ?? null,
          platform: from?.track ?? null,
          departure: toIso(from?.departure),
        },
        to: {
          name: to?.name ?? '',
          location: { lat: Number(to?.lat ?? 0), lng: Number(to?.lon ?? 0) },
          stopId: to?.stopId ?? null,
          platform: to?.track ?? null,
          arrival: toIso(to?.arrival),
        },
        startTime: toIso(leg.startTime ?? from?.departure),
        endTime: toIso(leg.endTime ?? to?.arrival),
        durationSeconds: Math.round(Number(leg.duration ?? 0)),
        distanceMeters: Math.round(Number(leg.distance ?? 0)),
        geometry:
          geometry.length > 1
            ? geometry
            : [
                [Number(from?.lon ?? 0), Number(from?.lat ?? 0)],
                [Number(to?.lon ?? 0), Number(to?.lat ?? 0)],
              ],
        intermediateStops: (leg.intermediateStops ?? []).map((stop) => ({
          name: stop.name ?? '',
          location: { lat: Number(stop.lat), lng: Number(stop.lon) },
        })),
        realTime,
        cancelled: Boolean(leg.cancelled || from?.cancelled || to?.cancelled),
        dataQuality:
          mode === 'walk' || mode === 'cycle' ? 'estimated' : realTime ? 'live' : 'scheduled',
        wheelchairAccessible:
          leg.wheelchair === 'YES' || from?.wheelchair === 'YES'
            ? 'yes'
            : leg.wheelchair === 'NO'
              ? 'no'
              : 'unknown',
      };
    });

    const transitLegs = legs.filter((leg) => leg.mode !== 'walk' && leg.mode !== 'cycle');
    return {
      id: itinerary.id ?? `transitous-${index}`,
      startTime: toIso(itinerary.startTime) ?? legs[0]?.startTime ?? new Date().toISOString(),
      endTime: toIso(itinerary.endTime) ?? legs.at(-1)?.endTime ?? new Date().toISOString(),
      durationSeconds: Math.round(
        Number(itinerary.duration ?? legs.reduce((sum, leg) => sum + leg.durationSeconds, 0)),
      ),
      transfers: Number(itinerary.transfers ?? Math.max(0, transitLegs.length - 1)),
      legs,
      dataQuality: legs.some((leg) => leg.dataQuality === 'live') ? 'live' : 'scheduled',
      provider: this.name,
    };
  }
}
