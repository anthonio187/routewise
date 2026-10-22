import type {
  ApiMeta,
  DataSourceSummary,
  FareInfo,
  Journey,
  JourneyPreference,
  Place,
  PlaceRef,
  PlanCoverage,
  PlanNotice,
  PlanRequest,
  PlanResponse,
  ProviderRuntimeStatus,
} from '@routewise/shared';
import { isCurrencyCode } from '@routewise/shared';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { dbEnabled } from '../db/pool.js';
import { findNearestCity } from '../db/repos/cities.js';
import { coverageNear } from '../db/repos/stops.js';
import { faresForRoutes } from '../db/repos/fares.js';
import { listSourcesWithCoverage } from '../db/repos/sources.js';
import { geocodingService } from '../providers/geocoding/index.js';
import { transitProvider } from '../providers/transit/index.js';
import { streetRouter } from '../providers/street/index.js';
import { fxService } from '../providers/fx/index.js';
import { normalizeItinerary } from './normalize.js';
import { dedupeJourneys, rankJourneys } from './rank.js';
import { walkingJourneys } from './walk.js';
import { planWithLocalTransit } from './localTransit.js';
import type { TransitItinerary } from '../providers/transit/types.js';

export interface PlanContext {
  request: PlanRequest;
  /** City lookup is best-effort; planning works without a database. */
  locale?: string;
}

export async function planJourney(request: PlanRequest): Promise<PlanResponse> {
  const notices: PlanNotice[] = [];
  const now = new Date();
  const departureTime = request.departureTime ? new Date(request.departureTime) : now;
  if (Number.isNaN(departureTime.getTime())) {
    departureTime.setTime(now.getTime());
    notices.push({
      code: 'invalid_departure_time',
      severity: 'warning',
      message: 'The requested departure time was invalid; planning for now instead.',
    });
  }

  const originPlace = toPlace(request.origin, 'origin');
  const destinationPlace = toPlace(request.destination, 'destination');

  // --- Location context (optional, database-backed) ---
  let city: Awaited<ReturnType<typeof findNearestCity>> = null;
  let coverageFailed = false;
  let coverage: PlanCoverage = {
    transitDataAvailable: false,
    nearbyStops: 0,
    cityId: null,
    cityName: null,
    countryCode: null,
    dataSources: [],
  };

  if (dbEnabled) {
    try {
      city = await findNearestCity(originPlace.location.lat, originPlace.location.lng, 80);
      const near = await coverageNear(originPlace.location, config.MAX_ACCESS_WALK_METERS);
      coverage = {
        transitDataAvailable: near.stops > 0,
        nearbyStops: near.stops,
        cityId: city?.id ?? null,
        cityName: city?.name ?? originPlace.cityName ?? null,
        countryCode: city?.countryCode ?? originPlace.countryCode ?? null,
        dataSources: [],
      };
      const sources = await listSourcesWithCoverage();
      coverage.dataSources = sources.filter((source) => source.stopCount > 0) as DataSourceSummary[];
    } catch (err) {
      coverageFailed = true;
      console.error('[planner] coverage lookup failed:', err);
      notices.push(dbNotice());
    }
  }

  // The place itself often knows its own city and country (geocoders return
  // them). Use that when the database could not answer, so currency and time
  // zone are still correct.
  if (!coverage.countryCode) {
    coverage.countryCode = originPlace.countryCode ?? destinationPlace.countryCode ?? null;
  }
  if (!coverage.cityName) {
    coverage.cityName = originPlace.cityName ?? destinationPlace.cityName ?? null;
  }

  if (!dbEnabled) {
    notices.push({
      code: 'no_database',
      severity: 'info',
      message:
        'This deployment has no database configured. Journey planning via live providers is available, but saved journeys, community reports and GTFS data are disabled.',
    });
  }

  // --- Display currency (never assumed) ---
  const currenciesInPlay = new Set<string>();
  if (isCurrencyCode(request.currency)) currenciesInPlay.add(request.currency.toUpperCase());
  if (city?.defaultCurrency) currenciesInPlay.add(city.defaultCurrency);
  const displayCurrency =
    [...currenciesInPlay][0] ??
    (await currencyForCountry(coverage.countryCode)) ??
    (await firstLocalFareCurrency(city?.id ?? null)) ??
    'XXX';
  if (displayCurrency === 'XXX') {
    notices.push({
      code: 'currency_unknown',
      severity: 'info',
      message:
        'No currency could be determined for this area. Any available fares are shown in their original currency.',
    });
  }

  // --- Transit planning ---
  // Data sources are merged, never mutually exclusive: community or operator
  // GTFS imported into this deployment is authoritative for its own stops and
  // should be usable at the same time as the global live provider.
  const transitItineraries: TransitItinerary[] = [];
  let transitError: string | null = null;
  let localItineraryCount = 0;

  const wantsGlobal = config.TRANSIT_PROVIDER === 'transitous';
  // Skip the local search when nothing is mapped nearby: with no stop in walking
  // range it cannot produce an itinerary and would only add latency.
  const wantsLocal =
    dbEnabled &&
    (config.TRANSIT_PROVIDER === 'local_gtfs' ||
      (config.TRANSIT_PROVIDER === 'transitous' && coverage.transitDataAvailable));

  if (wantsGlobal) {
    try {
      const itineraries = await transitProvider.plan({
        from: originPlace.location,
        to: destinationPlace.location,
        departureTime,
        arriveBy: request.arriveBy,
        maxTransfers: request.maxTransfers ?? config.MAX_TRANSFERS,
        numItineraries: 6,
        locale: request.locale ?? 'en',
      });
      transitItineraries.push(...itineraries);
    } catch (err) {
      transitError = err instanceof Error ? err.message : String(err);
    }
  }

  if (wantsLocal) {
    try {
      const itineraries = await planWithLocalTransit({
        origin: originPlace.location,
        destination: destinationPlace.location,
        departureTime,
        maxTransfers: request.maxTransfers ?? config.MAX_TRANSFERS,
        cityTimezone: city?.timezone ?? 'UTC',
      });
      localItineraryCount = itineraries.length;
      transitItineraries.push(...itineraries);
      if (request.arriveBy) {
        notices.push({
          code: 'arrive_by_unsupported_local',
          severity: 'info',
          message:
            'Arrive-by search is not supported by the local GTFS engine yet; locally imported results use the requested departure time.',
        });
      }
    } catch (err) {
      if (!transitError) transitError = err instanceof Error ? err.message : String(err);
    }
  } else if (config.TRANSIT_PROVIDER === 'local_gtfs' && !dbEnabled) {
    notices.push({
      code: 'local_gtfs_without_database',
      severity: 'warning',
      message:
        'Scheduled transit is configured to use local GTFS data, but no database is connected. Only walking and cycling information is available.',
    });
  }

  if (transitError) {
    notices.push({
      code: 'transit_provider_error',
      severity: 'warning',
      message: `A transit provider could not be reached (${transitError}). Other available options are still shown.`,
    });
  }

  // --- Provenance: name the source that actually produced the transit legs ---
  if (transitItineraries.length > 0) {
    const sources: DataSourceSummary[] = coverage.dataSources.filter(
      (source) => source.kind === 'gtfs',
    );
    if (wantsGlobal && transitItineraries.length > localItineraryCount) {
      sources.push({
        code: 'transitous',
        name: 'Transitous (MOTIS)',
        kind: 'api',
        attribution: 'Transitous / MOTIS — aggregated public transport feeds, OpenStreetMap data',
        licenseName: 'Mixed open licences (see transitous.org/sources)',
        isOfficial: false,
        lastImportedAt: null,
        freshness: 'fresh',
      });
    }
    if (sources.length === 0) {
      sources.push({
        code: 'local_gtfs',
        name: 'Local GTFS import',
        kind: 'gtfs',
        attribution: null,
        licenseName: null,
        isOfficial: false,
        lastImportedAt: null,
        freshness: 'unknown',
      });
    }
    coverage.dataSources = sources;
  }

  // --- Fares (only from stored observations; never invented) ---
  const routeIds = [
    ...new Set(
      transitItineraries
        .flatMap((itinerary) => itinerary.legs)
        .map((leg) => leg.routeId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  let fareByRoute = new Map<string, FareInfo>();
  if (dbEnabled && routeIds.length > 0) {
    try {
      const observations = await faresForRoutes(routeIds);
      fareByRoute = new Map(
        observations
          .filter((observation) => observation.routeId)
          .map((observation) => [
            observation.routeId!,
            {
              amount: observation.amount,
              currency: observation.currency,
              source: observation.source as FareInfo['source'],
              verification: observation.verification as FareInfo['verification'],
              observedAt: observation.observedAt,
              pricedAs: observation.pricedAs,
              note: observation.note,
            },
          ]),
      );
    } catch {
      // Fare lookup is optional; a miss means "fare unknown".
    }
  }

  // --- Normalize to public journeys ---
  const journeys: Journey[] = [];
  for (const itinerary of transitItineraries) {
    try {
      const journey = await normalizeItinerary(itinerary, {
        displayCurrency,
        locale: request.locale ?? 'en',
        requireStepFree: request.requireStepFree,
        originName: originPlace.name,
        destinationName: destinationPlace.name,
        fareLookup: async (leg) => (leg.routeId ? fareByRoute.get(leg.routeId) ?? null : null),
      });
      journeys.push(journey);
    } catch (err) {
      console.warn('[planner] failed to normalize itinerary', err);
    }
  }

  const hasTransit = journeys.length > 0;

  if (!hasTransit) {
    const fallback = await walkingJourneys(request.origin, request.destination);
    journeys.push(...fallback);

    notices.push(
      coverageFailed
        ? {
            code: 'transit_coverage_unknown',
            severity: 'warning',
            message:
              'Transit coverage for this area could not be checked because a data store is unavailable. Walking and cycling options are shown; transit may exist here.',
          }
        : {
            code: 'no_transit_itineraries',
            severity: 'warning',
            message:
              'No public transport journey was found between these points. RouteWise only shows transit where a real data source covers the area — it does not generate invented routes. Walking and cycling options are shown instead.',
          },
    );
  }

  // --- Rank using only available data ---
  const preference: JourneyPreference = request.preference ?? 'fastest';
  const ranked = rankJourneys(dedupeJourneys(journeys), preference);
  for (const note of ranked.notes) {
    notices.push({ code: 'ranking_note', severity: 'info', message: note });
  }
  if (preference === 'cheapest' && ranked.notes.length === 0) {
    const priced = ranked.journeys.filter((journey) => journey.fare.total);
    if (priced.length === 0) {
      notices.push({
        code: 'fares_unavailable',
        severity: 'info',
        message:
          'A cheapest journey cannot be determined because no fares are available for these routes. Journeys are ordered by duration instead.',
      });
    }
  }

  if (request.requireStepFree) {
    const verified = ranked.journeys.some((journey) =>
      journey.legs.every(
        (leg) => leg.mode === 'walk' || leg.accessibility?.wheelchairAccessible === 'yes',
      ),
    );
    if (!verified) {
      notices.push({
        code: 'step_free_unverified',
        severity: 'warning',
        message:
          'No journey could be verified as fully step-free with the available data. Contact the operator before travelling if step-free access is essential.',
      });
    }
  }

  if (hasTransit && coverage.nearbyStops === 0) {
    notices.push({
      code: 'paths_only_transit_source',
      severity: 'info',
      message:
        'Transit results come from a global provider. This deployment has no locally ingested GTFS feed for the area, so stop-level details and operator fares may be incomplete.',
    });
  }

  if (
    journeyUsesTransit(ranked.journeys) &&
    !coverage.transitDataAvailable
  ) {
    // Global providers can serve an area even without a locally ingested feed.
    coverage.transitDataAvailable = true;
  }

  const providers = buildProviderStatuses();

  return {
    requestId: randomUUID(),
    origin: originPlace,
    destination: destinationPlace,
    departureTime: departureTime.toISOString(),
    currency: displayCurrency,
    journeys: ranked.journeys,
    coverage,
    providers,
    notices,
    generatedAt: now.toISOString(),
  };
}

function journeyUsesTransit(journeys: Journey[]): boolean {
  return journeys.some((journey) =>
    journey.legs.some((leg) => leg.mode !== 'walk' && leg.mode !== 'cycle'),
  );
}

function toPlace(ref: PlaceRef, role: 'origin' | 'destination'): Place {
  return {
    id: ref.id ?? `${role}:${ref.name}`,
    name: ref.name,
    displayName: ref.displayName ?? ref.name,
    location: ref.location,
    kind: ref.kind ?? 'other',
    provider: ref.id?.startsWith('osm:') ? 'nominatim' : 'user',
    countryCode: (ref as { countryCode?: string | null }).countryCode ?? null,
    cityName: (ref as { cityName?: string | null }).cityName ?? null,
  };
}

async function currencyForCountry(iso2: string | null | undefined): Promise<string | null> {
  if (!dbEnabled || !iso2) return null;
  try {
    const { query } = await import('../db/pool.js');
    const res = await query<{ default_currency: string | null }>(
      'SELECT default_currency FROM countries WHERE iso2 = $1',
      [iso2.toUpperCase()],
    );
    return res.rows[0]?.default_currency ?? null;
  } catch {
    return null;
  }
}

async function firstLocalFareCurrency(cityId: string | null): Promise<string | null> {
  if (!dbEnabled || !cityId) return null;
  try {
    const { query } = await import('../db/pool.js');
    const res = await query<{ currency: string }>(
      `SELECT currency FROM fare_observations WHERE city_id = $1 ORDER BY observed_at DESC LIMIT 1`,
      [cityId],
    );
    return res.rows[0]?.currency ?? null;
  } catch {
    return null;
  }
}

/**
 * User-facing notice for a database outage. Internal error text is logged where
 * the failure happens instead of being shown to travellers.
 */
function dbNotice(): PlanNotice {
  return {
    code: 'database_unavailable',
    severity: 'warning',
    message:
      'Coverage details and saved journeys are temporarily unavailable. Walking and cycling options still work; transit results may be incomplete.',
  };
}

export function buildProviderStatuses(): Record<string, ProviderRuntimeStatus> {
  return {
    database: {
      provider: 'postgresql',
      configured: dbEnabled,
      healthy: null,
      note: dbEnabled
        ? 'PostgreSQL with PostGIS stores GTFS, fares, reports and saved journeys.'
        : 'No DATABASE_URL configured. Stored features are disabled.',
    },
    transit: {
      provider: transitProvider.name,
      configured: transitProvider.configured,
      healthy: null,
      note: transitProvider.note ?? null,
      attribution: transitProvider.attribution,
    },
    geocoding: {
      provider: geocodingService.name,
      configured: geocodingService.configured,
      healthy: null,
      attribution: geocodingService.attribution,
    },
    street: {
      provider: streetRouter.name,
      configured: streetRouter.configured,
      healthy: null,
      attribution: streetRouter.attribution,
    },
    fx: {
      provider: fxService.name,
      configured: fxService.configured,
      healthy: null,
      attribution: fxService.attribution,
    },
  };
}

export function buildMeta(): ApiMeta {
  return {
    name: 'RouteWise API',
    version: '0.1.0',
    apiVersion: 'v1',
    generatedAt: new Date().toISOString(),
    defaultLocale: 'en',
    defaultCurrency: null,
    supportedPreferences: ['fastest', 'cheapest', 'fewest_transfers', 'least_walking', 'accessible'],
    supportedModes: [
      'walk',
      'cycle',
      'bus',
      'metro',
      'subway',
      'train',
      'commuter_rail',
      'tram',
      'light_rail',
      'ferry',
      'cable_tram',
      'funicular',
      'trolleybus',
      'monorail',
      'taxi',
      'ride',
      'other',
    ],
    providers: buildProviderStatuses(),
    dataSources: [],
    notices: [],
  };
}
