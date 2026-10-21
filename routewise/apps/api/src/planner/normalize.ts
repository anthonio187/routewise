import type {
  ConvertedFare,
  FareInfo,
  Journey,
  JourneyFareSummary,
  JourneyLeg,
  Money,
  TransportMode,
} from '@routewise/shared';
import { randomUUID } from 'node:crypto';
import { fxService } from '../providers/fx/index.js';
import type { TransitItinerary, TransitLeg } from '../providers/transit/types.js';

export interface FareLookup {
  (leg: TransitLeg): Promise<FareInfo | null>;
}

export interface NormalizeOptions {
  displayCurrency: string;
  fareLookup?: FareLookup;
  locale?: string;
  requireStepFree?: boolean;
  /** Used to replace provider placeholders such as "START"/"END". */
  originName?: string;
  destinationName?: string;
}

const MODE_LABEL: Record<TransportMode, string> = {
  walk: 'Walk',
  cycle: 'Cycle',
  bus: 'Bus',
  metro: 'Metro',
  subway: 'Subway',
  train: 'Train',
  commuter_rail: 'Commuter rail',
  tram: 'Tram',
  light_rail: 'Light rail',
  ferry: 'Ferry',
  cable_tram: 'Cable car',
  funicular: 'Funicular',
  trolleybus: 'Trolleybus',
  monorail: 'Monorail',
  taxi: 'Taxi',
  ride: 'Ride service',
  other: 'Transit',
};

function minutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} min`;
}

function metres(distance: number): string {
  return distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
}

export function describeLeg(leg: TransitLeg): string {
  if (leg.mode === 'walk' || leg.mode === 'cycle') {
    const verb = leg.mode === 'walk' ? 'Walk' : 'Cycle';
    return `${verb} ${minutes(leg.durationSeconds)} (${metres(leg.distanceMeters)}) to ${leg.to.name || 'your destination'}`;
  }
  const line = leg.routeShortName || leg.routeLongName || MODE_LABEL[leg.mode];
  const towards = leg.headsign ? ` towards ${leg.headsign}` : '';
  const stops = leg.intermediateStops.length + 1;
  const platform = leg.from.platform ? ` from platform ${leg.from.platform}` : '';
  return `Take ${MODE_LABEL[leg.mode].toLowerCase()} ${line}${towards} from ${leg.from.name}${platform} to ${leg.to.name} (${stops} stop${stops === 1 ? '' : 's'}, ${minutes(leg.durationSeconds)})`;
}

export async function normalizeItinerary(
  itinerary: TransitItinerary,
  options: NormalizeOptions,
): Promise<Journey> {
  const warnings = new Set<string>();
  const legs: JourneyLeg[] = [];
  const fares: FareInfo[] = [];

  const resolveName = (raw: string): string => {
    if (!raw || raw === 'START') return options.originName ?? raw;
    if (raw === 'END') return options.destinationName ?? raw;
    return raw;
  };

  for (const leg of itinerary.legs) {
    let fare: FareInfo | null = null;
    if (leg.mode !== 'walk' && leg.mode !== 'cycle' && options.fareLookup) {
      fare = await options.fareLookup(leg).catch(() => null);
    }
    if (fare) fares.push(fare);

    if (leg.cancelled) {
      warnings.add(`A leg of this journey is marked cancelled by the operator (${leg.from.name} → ${leg.to.name}).`);
    }
    if ((leg.mode === 'walk' || leg.mode === 'cycle') && leg.durationSeconds > 1200) {
      warnings.add(`This journey includes a long ${leg.mode} connection (${minutes(leg.durationSeconds)}).`);
    }

    const fromName = resolveName(leg.from.name);
    const toName = resolveName(leg.to.name);
    const describedLeg =
      fromName === leg.from.name && toName === leg.to.name
        ? leg
        : {
            ...leg,
            from: { ...leg.from, name: fromName },
            to: { ...leg.to, name: toName },
          };

    legs.push({
      mode: leg.mode,
      instruction: describeLeg(describedLeg),
      from: {
        id: leg.from.stopId ?? `leg:${fromName}`,
        name: fromName,
        location: leg.from.location,
        platformCode: leg.from.platform,
      },
      to: {
        id: leg.to.stopId ?? `leg:${toName}`,
        name: toName,
        location: leg.to.location,
        platformCode: leg.to.platform,
      },
      startTime: leg.startTime,
      endTime: leg.endTime,
      durationSeconds: leg.durationSeconds,
      distanceMeters: leg.distanceMeters,
      geometry: leg.geometry,
      route:
        leg.mode === 'walk' || leg.mode === 'cycle'
          ? undefined
          : {
              id: leg.routeId ?? leg.rawMode,
              shortName: leg.routeShortName,
              longName: leg.routeLongName,
              mode: leg.mode,
              agencyName: leg.agencyName,
              headsign: leg.headsign,
            },
      intermediateStops: leg.intermediateStops.map((stop, index) => ({
        id: `${leg.from.stopId ?? 'stop'}:int:${index}`,
        name: stop.name,
        location: stop.location,
      })),
      fare,
      dataQuality: leg.dataQuality,
      accessibility: {
        wheelchairAccessible: leg.wheelchairAccessible,
      },
    });

    if (leg.dataQuality === 'live' && leg.mode !== 'walk') {
      warnings.add('Some departures use real-time data; arrival times can still change.');
    }
    if (leg.mode !== 'walk' && leg.mode !== 'cycle' && !fare) {
      warnings.add('Fare information is unavailable for at least one leg.');
    }
  }

  const walkingMeters = legs
    .filter((leg) => leg.mode === 'walk')
    .reduce((sum, leg) => sum + leg.distanceMeters, 0);

  const fareSummary = await summarizeFares(fares, options.displayCurrency);

  if (options.requireStepFree) {
    const unknown = legs.filter(
      (leg) => leg.mode !== 'walk' && leg.accessibility?.wheelchairAccessible !== 'yes',
    ).length;
    if (unknown > 0) {
      warnings.add(
        `Step-free access could not be verified for ${unknown} leg(s); check with the operator before travelling.`,
      );
    }
  }

  return {
    id: itinerary.id || randomUUID(),
    legs,
    departureTime: itinerary.startTime,
    arrivalTime: itinerary.endTime,
    durationSeconds: itinerary.durationSeconds,
    transfers: itinerary.transfers,
    walkingMeters,
    fare: fareSummary,
    dataQuality: itinerary.dataQuality,
    warnings: [...warnings],
  };
}

async function summarizeFares(transitFares: FareInfo[], displayCurrency: string): Promise<JourneyFareSummary> {
  if (transitFares.length === 0) {
    return {
      status: 'unknown',
      note: 'No fare data is available for this journey. RouteWise does not estimate prices.',
    };
  }

  const currencies = new Set(transitFares.map((fare) => fare.currency));
  if (currencies.size === 1) {
    const currency = [...currencies][0]!;
    const total = transitFares.reduce((sum, fare) => sum + fare.amount, 0);
    const money: Money = { amount: Math.round(total * 100) / 100, currency };
    if (currency === displayCurrency.toUpperCase() || !fxService.configured) {
      return {
        status: 'known',
        total: money,
        note:
          currency === displayCurrency.toUpperCase()
            ? `Total of ${transitFares.length} observed fare(s) in ${currency}.`
            : `Fares are shown in ${currency}; no currency conversion was applied.`,
      };
    }
    const converted = await fxService.convert(money.amount, currency, displayCurrency);
    return converted
      ? {
          status: 'known',
          total: money,
          convertedTotal: converted as ConvertedFare,
          note: `Total converted at the documented rate from ${currency} to ${displayCurrency}. Fares remain observations, not official quotes.`,
        }
      : {
          status: 'known',
          total: money,
          note: `Conversion to ${displayCurrency} is unavailable, so the original ${currency} total is shown.`,
        };
  }

  // Mixed currencies: only sum after explicit, documented conversion.
  let convertedTotal = 0;
  const rates: string[] = [];
  for (const fare of transitFares) {
    const converted = await fxService.convert(fare.amount, fare.currency, displayCurrency);
    if (!converted) {
      return {
        status: 'partial',
        note: `This journey's fares are in ${[...currencies].join(', ')}. A total cannot be shown because no documented exchange rate is available for one or more legs.`,
      };
    }
    convertedTotal += converted.amount;
    rates.push(`${fare.currency}→${displayCurrency} @ ${converted.rate} (${converted.asOf.slice(0, 10)})`);
  }
  return {
    status: 'known',
    total: { amount: Math.round(convertedTotal * 100) / 100, currency: displayCurrency.toUpperCase() },
    note: `Mixed-currency fares converted using documented rates: ${rates.join('; ')}.`,
  };
}
