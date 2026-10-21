import { describe, expect, it } from 'vitest';
import { PlanRequestSchema, ReportSchema } from '../src/routes/schemas.js';

describe('PlanRequestSchema', () => {
  it('accepts a minimal valid request in any country', () => {
    const result = PlanRequestSchema.safeParse({
      origin: { name: 'Shibuya Station', location: { lat: 35.658, lng: 139.7016 } },
      destination: { name: 'Tokyo Station', location: { lat: 35.6812, lng: 139.7671 } },
      currency: 'JPY',
      preference: 'fastest',
    });
    expect(result.success).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    const result = PlanRequestSchema.safeParse({
      origin: { name: 'Nowhere', location: { lat: 91, lng: 0 } },
      destination: { name: 'Somewhere', location: { lat: 0, lng: 0 } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-ISO currency codes', () => {
    const result = PlanRequestSchema.safeParse({
      origin: { name: 'A', location: { lat: 0, lng: 0 } },
      destination: { name: 'B', location: { lat: 1, lng: 1 } },
      currency: 'naira',
    });
    expect(result.success).toBe(false);
  });
});

describe('ReportSchema', () => {
  it('requires an explicit observation timestamp with offset', () => {
    const base = {
      category: 'disruption',
      title: 'Signal failure on line 2',
      body: 'Trains are being held outside the city centre station.',
    };
    expect(ReportSchema.safeParse({ ...base, observedAt: '2026-10-19T08:00:00Z' }).success).toBe(true);
    expect(ReportSchema.safeParse({ ...base, observedAt: '2026-10-19 08:00' }).success).toBe(false);
  });
});
