import { describe, expect, it } from 'vitest';
import { decodePolyline } from '../src/providers/transit/motis.js';

/**
 * Sample captured from the real Transitous/MOTIS API for the first walking leg
 * of a Berlin Alexanderplatz → BER journey (precision 7). The decoded endpoints
 * must line up with the leg's from/to coordinates.
 */
const SAMPLE =
  'kxvwh^qe{y~F`_A|xB??p~Bp_F??pQqX`dByjC??flAh_DbRxuB??fRzvBr@';

describe('decodePolyline', () => {
  it('decodes MOTIS precision-7 geometry into lng/lat pairs', () => {
    const points = decodePolyline(SAMPLE, 7);
    expect(points.length).toBeGreaterThan(5);
    const [firstLng, firstLat] = points[0]!;
    const [lastLng, lastLat] = points[points.length - 1]!;

    expect(firstLat).toBeCloseTo(52.5219, 2);
    expect(firstLng).toBeCloseTo(13.4132, 2);
    expect(lastLat).toBeCloseTo(52.5215, 2);
    expect(lastLng).toBeCloseTo(13.4112, 2);
  });

  it('returns an empty array for empty input', () => {
    expect(decodePolyline('', 7)).toEqual([]);
  });
});
