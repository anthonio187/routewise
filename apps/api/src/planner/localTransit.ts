/**
 * Local scheduled-transit engine over GTFS ingested into PostgreSQL.
 *
 * Bounded round-based (RAPTOR-style) earliest-arrival search:
 *  - access/egress walking around origin and destination
 *  - per-round boarding of candidate trips and riding to downstream stops
 *  - short walking transfers between nearby stops
 *  - journey reconstruction with leg-level provenance
 *
 * Documented limitations: one time zone per search (the city's), approximate
 * DST handling, no GTFS-Realtime yet, bounded trip counts per round.
 */
import type { LatLng } from '@routewise/shared';
import { haversineMeters } from '@routewise/shared';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { candidateTrips, type CandidateTrip } from '../db/repos/transit.js';
import { getFootpaths, nearbyStops, type NearbyStop } from '../db/repos/stops.js';
import { estimateWalking, isoDateInZone, zonedDateTimeToInstant } from '../utils/geo.js';
import type { TransitItinerary, TransitLeg } from '../providers/transit/types.js';

const TRANSFER_PENALTY_SECONDS = 180;
const TRANSFER_WALK_BUFFER_SECONDS = 60;
const MAX_FRONTIER_STOPS = 60;

interface WalkPredecessor {
  type: 'walk';
  fromStopId: string;
  seconds: number;
  meters: number;
}

interface RidePredecessor {
  type: 'ride';
  trip: CandidateTrip;
  boardIndex: number;
  alightIndex: number;
  boardEpoch: number;
  alightEpoch: number;
}

type Predecessor = WalkPredecessor | RidePredecessor;

interface Label {
  arrivalEpoch: number;
  rounds: number;
  prev: Predecessor | null;
}

export interface LocalPlanInput {
  origin: LatLng;
  destination: LatLng;
  departureTime: Date;
  maxTransfers: number;
  cityTimezone: string;
}

export async function planWithLocalTransit(input: LocalPlanInput): Promise<TransitItinerary[]> {
  const { origin, destination, departureTime, cityTimezone } = input;
  const maxRounds = Math.min(Math.max(input.maxTransfers + 1, 1), 4);
  const windowEnd = new Date(departureTime.getTime() + config.PLANNING_WINDOW_MINUTES * 60_000);

  const [originStops, destStops] = await Promise.all([
    nearbyStops(origin, config.MAX_ACCESS_WALK_METERS, 20),
    nearbyStops(destination, config.MAX_ACCESS_WALK_METERS, 20),
  ]);
  if (originStops.length === 0 || destStops.length === 0) return [];

  const stopInfo = new Map<string, NearbyStop>();
  for (const stop of [...originStops, ...destStops]) stopInfo.set(stop.id, stop);

  const labels = new Map<string, Label>();
  for (const stop of originStops) {
    const walk = estimateWalking(origin, stop.location);
    labels.set(stop.id, {
      arrivalEpoch: departureTime.getTime() + walk.durationSeconds * 1000,
      rounds: 0,
      prev: { type: 'walk', fromStopId: 'origin', seconds: walk.durationSeconds, meters: walk.distanceMeters },
    });
  }

  const baseDate = isoDateInZone(departureTime, cityTimezone);
  const serviceDates = [
    isoDateInZone(new Date(departureTime.getTime() - 86_400_000), cityTimezone),
    baseDate,
    isoDateInZone(windowEnd, cityTimezone),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  const midnight = zonedDateTimeToInstant(baseDate, 0, cityTimezone).getTime();
  let frontier = [...labels.keys()];

  for (let round = 1; round <= maxRounds; round += 1) {
    if (frontier.length === 0) break;
    const frontierSet = new Set(frontier.slice(0, MAX_FRONTIER_STOPS));
    const arrivals = [...frontierSet].map((id) => labels.get(id)!.arrivalEpoch);
    const minSeconds = Math.max(0, Math.floor((Math.min(...arrivals) - midnight) / 1000) - 600);
    const maxSeconds = Math.floor((Math.max(...arrivals, windowEnd.getTime()) - midnight) / 1000);

    const trips = await candidateTrips(
      [...frontierSet],
      serviceDates,
      minSeconds,
      Math.min(maxSeconds, 30 * 3600),
      Math.max(60, config.MAX_DEPARTURES_PER_STOP * 3),
    );

    const improved = new Set<string>();

    for (const trip of trips) {
      const tripMidnight = zonedDateTimeToInstant(baseDate, 0, trip.agencyTimezone).getTime();
      let boarded = false;
      let boardIndex = -1;

      for (let i = 0; i < trip.stops.length; i += 1) {
        const stop = trip.stops[i]!;
        const label = labels.get(stop.stopId);
        const departureEpoch = tripMidnight + stop.departureSeconds * 1000;

        if (!boarded && label) {
          const readyAt =
            label.arrivalEpoch + (label.rounds === 0 ? 0 : TRANSFER_PENALTY_SECONDS * 1000);
          if (readyAt <= departureEpoch) {
            boarded = true;
            boardIndex = i;
          }
        }

        if (boarded && i > boardIndex) {
          const arrivalEpoch = tripMidnight + stop.arrivalSeconds * 1000;
          const current = labels.get(stop.stopId);
          if (!current || arrivalEpoch < current.arrivalEpoch - 1000) {
            labels.set(stop.stopId, {
              arrivalEpoch,
              rounds: round,
              prev: {
                type: 'ride',
                trip,
                boardIndex,
                alightIndex: i,
                boardEpoch: tripMidnight + trip.stops[boardIndex]!.departureSeconds * 1000,
                alightEpoch: arrivalEpoch,
              },
            });
            if (!stopInfo.has(stop.stopId)) {
              stopInfo.set(stop.stopId, {
                id: stop.stopId,
                name: stop.name,
                location: { lat: stop.lat, lng: stop.lng },
                distanceMeters: 0,
                externalId: null,
                wheelchairBoarding: stop.wheelchairBoarding,
                agencyName: trip.agencyName,
                timezone: trip.agencyTimezone,
                mode: trip.mode,
              });
            }
            improved.add(stop.stopId);
          }
        }
      }
    }

    // Platform-to-platform walking transfers near improved stops.
    if (improved.size > 0) {
      const footpaths = await getFootpaths([...improved], config.MAX_TRANSFER_WALK_METERS, 6).catch(
        () => [],
      );
      for (const path of footpaths) {
        const from = labels.get(path.fromStopId);
        if (!from) continue;
        const arrivalEpoch =
          from.arrivalEpoch + path.seconds * 1000 + TRANSFER_WALK_BUFFER_SECONDS * 1000;
        const target = labels.get(path.toStopId);
        if (target && arrivalEpoch >= target.arrivalEpoch - 1000) continue;
        labels.set(path.toStopId, {
          arrivalEpoch,
          rounds: round,
          prev: { type: 'walk', fromStopId: path.fromStopId, seconds: path.seconds, meters: path.distanceMeters },
        });
        if (!stopInfo.has(path.toStopId)) {
          const [stop] = await nearbyStopsByIds([path.toStopId]);
          if (stop) stopInfo.set(stop.id, stop);
        }
        improved.add(path.toStopId);
      }
    }

    frontier = [...improved];
  }

  const results: TransitItinerary[] = [];
  for (const stop of destStops) {
    const label = labels.get(stop.id);
    if (!label) continue;
    if (label.arrivalEpoch <= departureTime.getTime()) continue;
    const egress = estimateWalking(stop.location, destination);
    const itinerary = reconstruct({
      labels,
      stopInfo,
      egressStop: stop,
      origin,
      destination,
      departureTime,
      egress,
    });
    if (itinerary) results.push(itinerary);
  }

  return dedupe(results)
    .sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime())
    .slice(0, 5);
}

async function nearbyStopsByIds(ids: string[]): Promise<NearbyStop[]> {
  try {
    const { getStopsByIds } = await import('../db/repos/stops.js');
    return await getStopsByIds(ids);
  } catch {
    return [];
  }
}

function reconstruct(args: {
  labels: Map<string, Label>;
  stopInfo: Map<string, NearbyStop>;
  egressStop: NearbyStop;
  origin: LatLng;
  destination: LatLng;
  departureTime: Date;
  egress: { distanceMeters: number; durationSeconds: number };
}): TransitItinerary | null {
  const { labels, stopInfo, egressStop, origin, destination, departureTime } = args;

  const chain: Array<{ stopId: string; label: Label }> = [];
  let stopId: string | null = egressStop.id;
  let guard = 0;
  while (stopId && guard < 16) {
    const label = labels.get(stopId);
    if (!label) break;
    chain.push({ stopId, label });
    const prev = label.prev;
    if (!prev) break;
    stopId = prev.type === 'ride' ? prev.trip.stops[prev.boardIndex]!.stopId : prev.fromStopId;
    if (stopId === 'origin') break;
    guard += 1;
  }
  if (chain.length === 0) return null;
  chain.reverse();

  const firstEntry = chain[0]!;
  const firstStop = stopInfo.get(firstEntry.stopId);
  const accessWalk = estimateWalking(origin, firstStop?.location ?? origin);

  const legs: TransitLeg[] = [];
  if (accessWalk.distanceMeters > 40 && firstStop) {
    legs.push(
      makeWalkLeg({
        from: origin,
        fromName: 'Origin',
        to: firstStop.location,
        toName: firstStop.name,
        startEpoch: departureTime.getTime(),
        metrics: accessWalk,
      }),
    );
  }

  for (const entry of chain) {
    const prev = entry.label.prev;
    if (!prev) continue;
    if (prev.type === 'walk') {
      if (prev.fromStopId === 'origin') continue;
      const fromStop = stopInfo.get(prev.fromStopId);
      const toStop = stopInfo.get(entry.stopId);
      if (!fromStop || !toStop) continue;
      legs.push(
        makeWalkLeg({
          from: fromStop.location,
          fromName: fromStop.name,
          to: toStop.location,
          toName: toStop.name,
          startEpoch: entry.label.arrivalEpoch - prev.seconds * 1000,
          metrics: { distanceMeters: prev.meters, durationSeconds: prev.seconds },
        }),
      );
    } else {
      const { trip, boardIndex, alightIndex, boardEpoch, alightEpoch } = prev;
      const board = trip.stops[boardIndex]!;
      const alight = trip.stops[alightIndex]!;
      const rideStops = trip.stops.slice(boardIndex, alightIndex + 1);
      let distance = 0;
      for (let i = 1; i < rideStops.length; i += 1) {
        distance += haversineMeters(
          { lat: rideStops[i - 1]!.lat, lng: rideStops[i - 1]!.lng },
          { lat: rideStops[i]!.lat, lng: rideStops[i]!.lng },
        );
      }
      legs.push({
        mode: trip.mode as TransitLeg['mode'],
        rawMode: trip.mode,
        routeId: trip.routeId,
        routeShortName: trip.routeShortName,
        routeLongName: trip.routeLongName,
        agencyName: trip.agencyName,
        headsign: trip.headsign,
        from: {
          name: board.name,
          location: { lat: board.lat, lng: board.lng },
          stopId: board.stopId,
          platform: null,
          departure: new Date(boardEpoch).toISOString(),
        },
        to: {
          name: alight.name,
          location: { lat: alight.lat, lng: alight.lng },
          stopId: alight.stopId,
          platform: null,
          arrival: new Date(alightEpoch).toISOString(),
        },
        startTime: new Date(boardEpoch).toISOString(),
        endTime: new Date(alightEpoch).toISOString(),
        durationSeconds: Math.max(1, Math.round((alightEpoch - boardEpoch) / 1000)),
        distanceMeters: Math.round(distance),
        geometry: rideStops.map((stop) => [stop.lng, stop.lat] as [number, number]),
        intermediateStops: rideStops
          .slice(1, -1)
          .map((stop) => ({ name: stop.name, location: { lat: stop.lat, lng: stop.lng } })),
        realTime: false,
        cancelled: false,
        dataQuality: 'scheduled',
        wheelchairAccessible:
          trip.wheelchairAccessible === 1 && board.wheelchairBoarding === 1
            ? 'yes'
            : trip.wheelchairAccessible === 2 || board.wheelchairBoarding === 2
              ? 'no'
              : 'unknown',
      });
    }
  }

  const lastEntry = chain.at(-1)!;
  const lastStop = stopInfo.get(lastEntry.stopId);
  if (args.egress.distanceMeters > 40 && lastStop) {
    legs.push(
      makeWalkLeg({
        from: lastStop.location,
        fromName: lastStop.name,
        to: destination,
        toName: 'Destination',
        startEpoch: lastEntry.label.arrivalEpoch,
        metrics: args.egress,
      }),
    );
  }

  if (!legs.some((leg) => leg.mode !== 'walk')) return null;

  const startTime = legs[0]!.startTime ?? departureTime.toISOString();
  const endTime = legs.at(-1)!.endTime ?? startTime;
  const transitLegs = legs.filter((leg) => leg.mode !== 'walk');

  return {
    id: `local-${randomUUID()}`,
    startTime,
    endTime,
    durationSeconds: Math.max(
      1,
      Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000),
    ),
    transfers: Math.max(0, transitLegs.length - 1),
    legs,
    dataQuality: 'scheduled',
    provider: 'local_gtfs',
  };
}

function makeWalkLeg(args: {
  from: LatLng;
  fromName: string;
  to: LatLng;
  toName: string;
  startEpoch: number;
  metrics: { distanceMeters: number; durationSeconds: number };
}): TransitLeg {
  const { from, to, startEpoch, metrics } = args;
  return {
    mode: 'walk',
    rawMode: 'WALK',
    routeShortName: null,
    routeLongName: null,
    agencyName: null,
    headsign: null,
    from: {
      name: args.fromName,
      location: from,
      stopId: null,
      platform: null,
      departure: new Date(startEpoch).toISOString(),
    },
    to: {
      name: args.toName,
      location: to,
      stopId: null,
      platform: null,
      arrival: new Date(startEpoch + metrics.durationSeconds * 1000).toISOString(),
    },
    startTime: new Date(startEpoch).toISOString(),
    endTime: new Date(startEpoch + metrics.durationSeconds * 1000).toISOString(),
    durationSeconds: metrics.durationSeconds,
    distanceMeters: metrics.distanceMeters,
    geometry: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    intermediateStops: [],
    realTime: false,
    cancelled: false,
    dataQuality: 'estimated',
    wheelchairAccessible: 'unknown',
  };
}

function dedupe(items: TransitItinerary[]): TransitItinerary[] {
  const seen = new Set<string>();
  const out: TransitItinerary[] = [];
  for (const item of items) {
    const signature = item.legs
      .filter((leg) => leg.mode !== 'walk')
      .map((leg) => `${leg.routeShortName ?? leg.routeId ?? leg.rawMode}:${leg.from.name}→${leg.to.name}`)
      .join('|');
    const key = `${signature}|${Math.round(new Date(item.startTime).getTime() / 600_000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
