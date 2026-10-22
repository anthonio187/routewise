import { z } from 'zod';

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const PlaceRefSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(300),
  displayName: z.string().max(600).optional(),
  location: LatLngSchema,
  kind: z
    .enum(['address', 'landmark', 'station', 'stop', 'city', 'poi', 'coordinate', 'locality', 'other'])
    .optional(),
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'countryCode must be ISO 3166-1 alpha-2')
    .optional(),
  cityName: z.string().max(200).optional(),
});

export const PlanRequestSchema = z.object({
  origin: PlaceRefSchema,
  destination: PlaceRefSchema,
  departureTime: z.string().datetime({ offset: true }).optional(),
  arriveBy: z.boolean().optional(),
  preference: z
    .enum(['fastest', 'cheapest', 'fewest_transfers', 'least_walking', 'accessible'])
    .optional(),
  maxTransfers: z.number().int().min(0).max(6).optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter ISO 4217 code')
    .optional(),
  requireStepFree: z.boolean().optional(),
  locale: z.string().min(2).max(35).optional(),
});

export const ReportSchema = z.object({
  category: z.enum([
    'disruption',
    'fare_change',
    'route_correction',
    'service_availability',
    'accessibility',
    'safety',
    'other',
  ]),
  title: z.string().trim().min(4).max(160),
  body: z.string().trim().min(10).max(4000),
  observedAt: z.string().datetime({ offset: true }),
  cityId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  stopId: z.string().uuid().optional(),
  location: LatLngSchema.optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
});

export const VoteSchema = z.object({ vote: z.enum(['confirm', 'dispute']) });

export const PreferencesSchema = z.object({
  preferredLanguage: z.string().min(2).max(35).optional(),
  preferredCurrency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .nullable()
    .optional(),
  units: z.enum(['metric', 'imperial']).optional(),
  timezone: z.string().min(1).max(60).nullable().optional(),
  homeCityId: z.string().uuid().nullable().optional(),
});

export const SavedJourneySchema = z.object({
  title: z.string().trim().min(1).max(160),
  journeyId: z.string().min(1),
  plan: z.unknown(),
});
