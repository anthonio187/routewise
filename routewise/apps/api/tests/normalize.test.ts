import { describe, expect, it } from 'vitest';
import { normalizeItinerary } from '../src/planner/normalize.js';
import type { TransitItinerary } from '../src/providers/transit/types.js';

const itinerary: TransitItinerary = {
  id: 'it-1',
  startTime: '2026-10-19T06:30:00.000Z',
  endTime: '2026-10-19T06:55:00.000Z',
  durationSeconds: 1500,
  transfers: 0,
  dataQuality: 'scheduled',
  provider: 'test',
  legs: [
    {
      mode: 'walk',
      rawMode: 'WALK',
      routeId: null,
      routeShortName: null,
      routeLongName: null,
      agencyName: null,
      headsign: null,
      from: { name: 'Origin', location: { lat: 52.52, lng: 13.4 }, stopId: null, platform: null, departure: null },
      to: { name: 'Alpha', location: { lat: 52.521, lng: 13.402 }, stopId: 's1', platform: null, arrival: null },
      startTime: '2026-10-19T06:30:00.000Z',
      endTime: '2026-10-19T06:35:00.000Z',
      durationSeconds: 300,
      distanceMeters: 260,
      geometry: [
        [13.4, 52.52],
        [13.402, 52.521],
      ],
      intermediateStops: [],
      realTime: false,
      cancelled: false,
      dataQuality: 'estimated',
      wheelchairAccessible: 'unknown',
    },
    {
      mode: 'metro',
      rawMode: 'METRO',
      routeId: 'route-uuid',
      routeShortName: 'U2',
      routeLongName: 'U2',
      agencyName: 'Test Transit',
      headsign: 'Beta',
      from: { name: 'Alpha', location: { lat: 52.521, lng: 13.402 }, stopId: 's1', platform: '2', departure: '2026-10-19T06:36:00.000Z' },
      to: { name: 'Beta', location: { lat: 52.53, lng: 13.41 }, stopId: 's2', platform: null, arrival: '2026-10-19T06:52:00.000Z' },
      startTime: '2026-10-19T06:36:00.000Z',
      endTime: '2026-10-19T06:52:00.000Z',
      durationSeconds: 960,
      distanceMeters: 0,
      geometry: [
        [13.402, 52.521],
        [13.41, 52.53],
      ],
      intermediateStops: [{ name: 'Between', location: { lat: 52.525, lng: 13.406 } }],
      realTime: false,
      cancelled: false,
      dataQuality: 'scheduled',
      wheelchairAccessible: 'yes',
    },
  ],
};

describe('normalizeItinerary', () => {
  it('builds instructions and uses observed fares without converting them', async () => {
    const journey = await normalizeItinerary(itinerary, {
      displayCurrency: 'EUR',
      fareLookup: async () => ({
        amount: 2.4,
        currency: 'EUR',
        source: 'community',
        verification: 'community_confirmed',
        observedAt: '2026-10-17T00:00:00.000Z',
        pricedAs: 'flat',
        note: 'observed at station',
      }),
    });

    expect(journey.legs).toHaveLength(2);
    expect(journey.legs[0]!.instruction).toMatch(/^Walk/);
    expect(journey.legs[1]!.instruction).toMatch(/metro U2 towards Beta/);
    expect(journey.walkingMeters).toBe(260);
    expect(journey.fare.status).toBe('known');
    expect(journey.fare.total).toEqual({ amount: 2.4, currency: 'EUR' });
    expect(journey.fare.note).toMatch(/observed fare/i);
  });

  it('states clearly when no fare data exists', async () => {
    const journey = await normalizeItinerary(itinerary, { displayCurrency: 'EUR' });
    expect(journey.fare.status).toBe('unknown');
    expect(journey.warnings.join(' ')).toMatch(/Fare information is unavailable/i);
  });

  it('flags estimated walking legs rather than implying live guidance', async () => {
    const journey = await normalizeItinerary(itinerary, { displayCurrency: 'EUR' });
    expect(journey.legs[0]!.dataQuality).toBe('estimated');
  });
});
