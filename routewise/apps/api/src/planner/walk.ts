import type { Journey, JourneyLeg } from '@routewise/shared';
import { haversineMeters } from '@routewise/shared';
import { streetRouter } from '../providers/street/index.js';
import type { PlaceRef } from '@routewise/shared';
import { randomUUID } from 'node:crypto';

/**
 * Walking / cycling alternatives. These are produced by a street-routing
 * provider when configured, otherwise by a clearly-labelled distance estimate.
 */
export async function walkingJourneys(origin: PlaceRef, destination: PlaceRef): Promise<Journey[]> {
  const straight = haversineMeters(origin.location, destination.location);
  // Beyond ~40 km a walking-only "journey" is not useful; return nothing rather
  // than recommending an 8-hour walk across a region.
  if (straight > 40_000) return [];

  const [walk, bike] = await Promise.all([
    streetRouter.route(origin.location, destination.location, 'foot'),
    straight > 1500
      ? streetRouter.route(origin.location, destination.location, 'bike')
      : Promise.resolve(null),
  ]);

  const build = (
    mode: 'walk' | 'cycle',
    route: { geometry: JourneyLeg['geometry']; distanceMeters: number; durationSeconds: number; estimated: boolean; note?: string; provider: string },
  ): Journey => {
    const start = new Date();
    const leg: JourneyLeg = {
      mode,
      instruction:
        mode === 'walk'
          ? `Walk from ${origin.name} to ${destination.name}`
          : `Cycle from ${origin.name} to ${destination.name}`,
      from: { id: `origin:${origin.name}`, name: origin.name, location: origin.location },
      to: { id: `dest:${destination.name}`, name: destination.name, location: destination.location },
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + route.durationSeconds * 1000).toISOString(),
      durationSeconds: route.durationSeconds,
      distanceMeters: route.distanceMeters,
      geometry: route.geometry,
      dataQuality: 'estimated',
    };
    return {
      id: randomUUID(),
      legs: [leg],
      departureTime: leg.startTime ?? null,
      arrivalTime: leg.endTime ?? null,
      durationSeconds: route.durationSeconds,
      transfers: 0,
      walkingMeters: mode === 'walk' ? route.distanceMeters : 0,
      fare: { status: 'unknown', note: `No fare applies to ${mode === 'walk' ? 'walking' : 'cycling'}.` },
      dataQuality: 'estimated',
      warnings: [
        route.estimated
          ? 'Duration and distance are estimates from coordinates, not a turn-by-turn walking route.'
          : 'Walking route from a street-routing service; follow local signage and crossings.',
        route.note ?? '',
      ].filter(Boolean),
    };
  };

  const journeys = [build('walk', walk)];
  if (bike) journeys.push(build('cycle', bike));
  return journeys;
}
