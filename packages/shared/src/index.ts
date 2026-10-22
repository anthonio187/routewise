/**
 * @routewise/shared — domain contracts shared by the API and the web app.
 *
 * IMPORTANT: Nothing in this package may assume a country, currency, language
 * or transport system. Modes, currencies and locales are all open sets with a
 * small set of well-known hints.
 */

// ---------------------------------------------------------------------------
// Geography & places
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

/** [lng, lat] — GeoJSON order. */
export type LngLat = [number, number];

export type PlaceKind =
  | 'address'
  | 'landmark'
  | 'station'
  | 'stop'
  | 'city'
  | 'poi'
  | 'coordinate'
  | 'locality'
  | 'other';

export interface Place {
  /** Stable ID. `osm:<type>:<id>` for OSM-derived places, or a UUID for stored places. */
  id: string;
  name: string;
  displayName: string;
  location: LatLng;
  kind: PlaceKind;
  provider: string;
  countryCode?: string | null;
  cityName?: string | null;
  /** Free-form provider extras (osm_type, osm_id, house_number, …). */
  properties?: Record<string, unknown>;
}

export interface PlaceRef {
  /** A stored place id, or omit and provide name + location. */
  id?: string;
  name: string;
  location: LatLng;
  kind?: PlaceKind;
  displayName?: string;
  /** Optional context from the geocoder, used for coverage and currency hints. */
  countryCode?: string | null;
  cityName?: string | null;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Transport modes RouteWise understands. Providers may also return a custom
 * string; the UI should degrade to a generic label rather than crash.
 */
export type TransportMode =
  | 'walk'
  | 'cycle'
  | 'bus'
  | 'metro'
  | 'subway'
  | 'train'
  | 'commuter_rail'
  | 'tram'
  | 'light_rail'
  | 'ferry'
  | 'cable_tram'
  | 'funicular'
  | 'trolleybus'
  | 'monorail'
  | 'taxi'
  | 'ride'
  | 'other';

export type DataQuality =
  | 'live' // real-time feed data
  | 'scheduled' // published timetable / GTFS
  | 'estimated' // derived from geometry/heuristics, explicitly not real-time
  | 'community' // reported by users, not official
  | 'unknown';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ---------------------------------------------------------------------------
// Money & fares
// ---------------------------------------------------------------------------

export interface Money {
  /** Decimal amount. Never assumed to be in any particular currency. */
  amount: number;
  /** ISO 4217 code, e.g. "NGN", "GBP", "JPY", "EUR". */
  currency: string;
}

export type FareSource = 'official' | 'community' | 'estimated';
export type VerificationStatus =
  | 'unverified'
  | 'community_confirmed'
  | 'moderator_confirmed'
  | 'official';

export interface FareInfo extends Money {
  source: FareSource;
  verification: VerificationStatus;
  /** When the fare was observed, ISO-8601 UTC. */
  observedAt?: string | null;
  /** e.g. "flat", "zone", "distance", "day_pass". */
  pricedAs?: string | null;
  note?: string | null;
}

export interface ConvertedFare {
  amount: number;
  currency: string;
  /** Rate applied: 1 source currency = rate target currency. */
  rate: number;
  /** ISO-8601 timestamp of the rate. */
  asOf: string;
  provider: string;
}

export type FareStatus = 'known' | 'partial' | 'unknown';

// ---------------------------------------------------------------------------
// Journey plan
// ---------------------------------------------------------------------------

export interface JourneyRouteInfo {
  id: string;
  shortName: string | null;
  longName: string | null;
  mode: TransportMode;
  agencyName: string | null;
  color?: string | null;
  textColor?: string | null;
  headsign?: string | null;
}

export interface StopRef {
  id: string;
  name: string;
  location: LatLng;
  platformCode?: string | null;
}

export interface JourneyLeg {
  mode: TransportMode;
  /** Human-oriented instruction, already localised where possible. */
  instruction: string;
  from: StopRef;
  to: StopRef;
  /** ISO-8601 UTC. Absent for pure walking estimates that are not time-anchored. */
  startTime?: string | null;
  endTime?: string | null;
  durationSeconds: number;
  distanceMeters: number;
  geometry: LngLat[];
  route?: JourneyRouteInfo;
  intermediateStops?: StopRef[];
  fare?: FareInfo | null;
  dataQuality: DataQuality;
  /** Populated when a display currency conversion was requested and possible. */
  convertedFare?: ConvertedFare | null;
  accessibility?: {
    wheelchairAccessible?: 'yes' | 'no' | 'unknown';
    note?: string | null;
  };
}

export interface JourneyFareSummary {
  status: FareStatus;
  /** Only set when every priced leg shares one currency (or conversion succeeded). */
  total?: Money | null;
  convertedTotal?: ConvertedFare | null;
  note?: string | null;
}

export interface Journey {
  id: string;
  legs: JourneyLeg[];
  departureTime?: string | null;
  arrivalTime?: string | null;
  durationSeconds: number;
  transfers: number;
  walkingMeters: number;
  fare: JourneyFareSummary;
  dataQuality: DataQuality;
  /** Non-fatal caveats: missing fares, estimated walking, stale data, etc. */
  warnings: string[];
  /** Explanation of why this journey was ranked where it was. */
  rankingNote?: string | null;
}

export type JourneyPreference =
  | 'fastest'
  | 'cheapest'
  | 'fewest_transfers'
  | 'least_walking'
  | 'accessible';

export interface PlanRequest {
  origin: PlaceRef;
  destination: PlaceRef;
  /** ISO-8601. Defaults to "now". */
  departureTime?: string;
  /** When true, `departureTime` is treated as an arrival deadline. */
  arriveBy?: boolean;
  preference?: JourneyPreference;
  maxTransfers?: number;
  /** Preferred display currency (ISO 4217). Fares are not invented if FX is unavailable. */
  currency?: string;
  requireStepFree?: boolean;
  locale?: string;
}

export interface ProviderRuntimeStatus {
  provider: string;
  configured: boolean;
  healthy: boolean | null;
  /** Human-readable caveat shown in the UI (licensing, sample data, …). */
  note?: string | null;
  attribution?: string | null;
}

export interface PlanNotice {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface PlanCoverage {
  transitDataAvailable: boolean;
  nearbyStops: number;
  cityId?: string | null;
  cityName?: string | null;
  countryCode?: string | null;
  dataSources: DataSourceSummary[];
}

export interface DataSourceSummary {
  code: string;
  name: string;
  kind: string;
  attribution?: string | null;
  licenseName?: string | null;
  isOfficial: boolean;
  lastImportedAt?: string | null;
  freshness?: 'fresh' | 'stale' | 'unknown';
}

export interface PlanResponse {
  requestId: string;
  origin: Place;
  destination: Place;
  departureTime: string;
  currency: string;
  journeys: Journey[];
  coverage: PlanCoverage;
  providers: Record<string, ProviderRuntimeStatus>;
  notices: PlanNotice[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Community reports
// ---------------------------------------------------------------------------

export const REPORT_CATEGORIES = [
  'disruption',
  'fare_change',
  'route_correction',
  'service_availability',
  'accessibility',
  'safety',
  'other',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type ReportStatus = 'open' | 'verified' | 'rejected' | 'expired';

export interface CommunityReport {
  id: string;
  category: ReportCategory;
  title: string;
  body: string;
  cityId?: string | null;
  cityName?: string | null;
  countryCode?: string | null;
  routeId?: string | null;
  routeName?: string | null;
  stopId?: string | null;
  stopName?: string | null;
  agencyId?: string | null;
  location?: LatLng | null;
  currency?: string | null;
  /** ISO-8601 UTC, as submitted by the reporter. */
  observedAt: string;
  createdAt: string;
  expiresAt?: string | null;
  status: ReportStatus;
  verification: VerificationStatus;
  confirmCount: number;
  disputeCount: number;
  /** Community content is never official. */
  disclaimer: string;
}

export interface CreateReportRequest {
  category: ReportCategory;
  title: string;
  body: string;
  observedAt: string;
  cityId?: string;
  routeId?: string;
  stopId?: string;
  location?: LatLng;
  currency?: string;
}

export interface VoteReportRequest {
  vote: 'confirm' | 'dispute';
}

// ---------------------------------------------------------------------------
// User preferences & saved journeys (anonymous, token-scoped)
// ---------------------------------------------------------------------------

export type DistanceUnits = 'metric' | 'imperial';

export interface UserPreferences {
  preferredLanguage: string;
  preferredCurrency: string | null;
  units: DistanceUnits;
  timezone: string | null;
  homeCityId: string | null;
  updatedAt?: string;
}

export interface SavedJourney {
  id: string;
  title: string;
  /** Complete plan snapshot so saved journeys work offline. */
  plan: PlanResponse;
  journeyId: string;
  createdAt: string;
  shareSlug?: string | null;
}

// ---------------------------------------------------------------------------
// Meta / health
// ---------------------------------------------------------------------------

export interface CountrySummary {
  iso2: string;
  iso3: string;
  name: string;
  defaultCurrency: string;
}

export interface CitySummary {
  id: string;
  name: string;
  countryCode: string;
  timezone: string;
  defaultCurrency: string;
  center: LatLng;
  /** Number of transit stops ingested in this city, if any. */
  stopCount?: number;
  hasTransitData?: boolean;
  /** GeoNames population estimate, when the city came from the global import. */
  population?: number | null;
}

export interface ApiMeta {
  name: string;
  version: string;
  apiVersion: string;
  generatedAt: string;
  defaultLocale: string;
  defaultCurrency: string | null;
  supportedPreferences: JourneyPreference[];
  supportedModes: TransportMode[];
  providers: Record<string, ProviderRuntimeStatus>;
  dataSources: DataSourceSummary[];
  notices: PlanNotice[];
  /** Reference-geography and network counters (database deployments only). */
  stats?: {
    countries: number;
    cities: number;
    stops: number;
    routes: number;
    citiesWithTransit: number;
  } | null;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  uptimeSeconds: number;
  version: string;
  checks?: Record<string, { ok: boolean; detail?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers (runtime-safe, dependency-free)
// ---------------------------------------------------------------------------

const ISO_4217 = /^[A-Z]{3}$/;
const EARTH_RADIUS_M = 6_371_008.8;

/** True when the value looks like an ISO 4217 code (format only, not a registry check). */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && ISO_4217.test(value);
}

export function isValidLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== 'object') return false;
  const { lat, lng } = value as LatLng;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type { Place as PlaceResult };
