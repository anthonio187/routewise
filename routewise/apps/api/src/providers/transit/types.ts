import type { DataQuality, LatLng, LngLat, TransportMode } from '@routewise/shared';

export interface TransitLeg {
  mode: TransportMode;
  rawMode: string;
  /** Route UUID when the leg comes from locally ingested GTFS. */
  routeId?: string | null;
  routeShortName: string | null;
  routeLongName: string | null;
  agencyName: string | null;
  headsign: string | null;
  from: {
    name: string;
    location: LatLng;
    stopId: string | null;
    platform: string | null;
    departure: string | null;
  };
  to: {
    name: string;
    location: LatLng;
    stopId: string | null;
    platform: string | null;
    arrival: string | null;
  };
  startTime: string | null;
  endTime: string | null;
  durationSeconds: number;
  distanceMeters: number;
  geometry: LngLat[];
  intermediateStops: Array<{ name: string; location: LatLng }>;
  realTime: boolean;
  cancelled: boolean;
  dataQuality: DataQuality;
  wheelchairAccessible: 'yes' | 'no' | 'unknown';
}

export interface TransitItinerary {
  id: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  transfers: number;
  legs: TransitLeg[];
  dataQuality: DataQuality;
  provider: string;
}

export interface TransitPlanParams {
  from: LatLng;
  to: LatLng;
  departureTime: Date;
  arriveBy?: boolean;
  maxTransfers?: number;
  numItineraries?: number;
  locale?: string;
}

export interface TransitProvider {
  readonly name: string;
  readonly configured: boolean;
  readonly attribution: string;
  readonly note?: string;
  plan(params: TransitPlanParams): Promise<TransitItinerary[]>;
  searchStops?(
    query: string,
    limit?: number,
  ): Promise<Array<{ id: string; name: string; location: LatLng; countryCode?: string | null }>>;
}
