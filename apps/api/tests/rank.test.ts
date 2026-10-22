import { describe, expect, it } from 'vitest';
import type { Journey } from '@routewise/shared';
import { dedupeJourneys, rankJourneys } from '../src/planner/rank.js';

function journey(overrides: Partial<Journey> & { id: string }): Journey {
  return {
    legs: [],
    durationSeconds: 1800,
    transfers: 0,
    walkingMeters: 200,
    fare: { status: 'unknown', total: null },
    dataQuality: 'scheduled',
    warnings: [],
    ...overrides,
  };
}

describe('rankJourneys', () => {
  it('orders by duration for the fastest preference', () => {
    const slow = journey({ id: 'slow', durationSeconds: 3000 });
    const fast = journey({ id: 'fast', durationSeconds: 1200 });
    const { journeys } = rankJourneys([slow, fast], 'fastest');
    expect(journeys.map((j) => j.id)).toEqual(['fast', 'slow']);
    expect(journeys[0]!.rankingNote).toContain('fastest');
  });

  it('prefers fewer transfers before duration', () => {
    const direct = journey({ id: 'direct', durationSeconds: 2400, transfers: 0 });
    const change = journey({ id: 'change', durationSeconds: 1900, transfers: 2 });
    const { journeys } = rankJourneys([direct, change], 'fewest_transfers');
    expect(journeys[0]!.id).toBe('direct');
  });

  it('does not fabricate price ranking when fares are unknown', () => {
    const a = journey({ id: 'a', durationSeconds: 1000 });
    const b = journey({ id: 'b', durationSeconds: 2000 });
    const { journeys, notes } = rankJourneys([a, b], 'cheapest');
    expect(journeys.map((j) => j.id)).toEqual(['a', 'b']);
    expect(notes.join(' ')).toMatch(/Fares are unavailable/i);
    expect(journeys[0]!.rankingNote).toMatch(/fare data is missing/i);
  });

  it('ranks cheapest only when totals exist', () => {
    const cheap = journey({
      id: 'cheap',
      durationSeconds: 3000,
      fare: { status: 'known', total: { amount: 2.4, currency: 'EUR' } },
    });
    const pricey = journey({
      id: 'pricey',
      durationSeconds: 1200,
      fare: { status: 'known', total: { amount: 7.5, currency: 'EUR' } },
    });
    const { journeys } = rankJourneys([pricey, cheap], 'cheapest');
    expect(journeys[0]!.id).toBe('cheap');
  });

  it('penalises journeys with known accessibility problems', () => {
    const inaccessible = journey({
      id: 'no-lift',
      durationSeconds: 900,
      legs: [
        {
          mode: 'metro',
          instruction: 'x',
          from: { id: 'a', name: 'A', location: { lat: 0, lng: 0 } },
          to: { id: 'b', name: 'B', location: { lat: 0, lng: 0 } },
          durationSeconds: 900,
          distanceMeters: 1000,
          geometry: [],
          dataQuality: 'scheduled',
          accessibility: { wheelchairAccessible: 'no' },
        },
      ],
    });
    const stepFree = journey({
      id: 'step-free',
      durationSeconds: 1500,
      legs: [
        {
          mode: 'bus',
          instruction: 'x',
          from: { id: 'a', name: 'A', location: { lat: 0, lng: 0 } },
          to: { id: 'b', name: 'B', location: { lat: 0, lng: 0 } },
          durationSeconds: 1500,
          distanceMeters: 1000,
          geometry: [],
          dataQuality: 'scheduled',
          accessibility: { wheelchairAccessible: 'yes' },
        },
      ],
    });
    const { journeys } = rankJourneys([inaccessible, stepFree], 'accessible');
    expect(journeys[0]!.id).toBe('step-free');
  });
});

describe('dedupeJourneys', () => {
  it('removes same-line journeys within ten minutes of each other', () => {
    const leg = {
      mode: 'bus' as const,
      instruction: 'Bus 1',
      from: { id: 'a', name: 'Alpha', location: { lat: 0, lng: 0 } },
      to: { id: 'b', name: 'Beta', location: { lat: 0, lng: 0 } },
      durationSeconds: 600,
      distanceMeters: 3000,
      geometry: [],
      dataQuality: 'scheduled' as const,
      route: { id: 'r1', shortName: '1', longName: 'One', mode: 'bus' as const, agencyName: null },
    };
    const a = journey({
      id: 'a',
      legs: [leg],
      departureTime: '2026-10-19T08:00:00.000Z',
    });
    const b = journey({
      id: 'b',
      legs: [leg],
      departureTime: '2026-10-19T08:05:00.000Z',
    });
    expect(dedupeJourneys([a, b])).toHaveLength(1);
  });
});
