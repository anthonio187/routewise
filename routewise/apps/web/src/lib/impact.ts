/**
 * Impact estimates for a journey.
 *
 * These are deliberately simple, transparent calculations — not a carbon
 * accounting system. The car baseline is the widely used UK DEFRA/BEIS figure
 * for an average petrol car (about 170 g CO₂e per vehicle-kilometre). Anything
 * derived from it is labelled as an estimate in the UI.
 */

export const CAR_GRAMS_CO2_PER_KM = 170;

/** Walking pace used for step estimates (steps ≈ metres × 1.3). */
const STEPS_PER_METRE = 1.3;

export interface JourneyImpact {
  distanceMeters: number;
  /** Grams of CO₂e avoided compared with driving the same distance alone. */
  savedGrams: number;
  steps: number;
  activeMinutes: number;
}

export function journeyImpact(legs: Array<{ distanceMeters: number; mode: string; durationSeconds: number }>): JourneyImpact {
  const distanceMeters = legs.reduce((total, leg) => total + (leg.distanceMeters || 0), 0);
  const savedGrams = Math.round((distanceMeters / 1000) * CAR_GRAMS_CO2_PER_KM);
  const active = legs.filter((leg) => leg.mode === 'walk' || leg.mode === 'cycle');
  const activeMeters = active.reduce((total, leg) => total + (leg.distanceMeters || 0), 0);
  const activeSeconds = active.reduce((total, leg) => total + (leg.durationSeconds || 0), 0);
  return {
    distanceMeters,
    savedGrams,
    steps: Math.round(activeMeters * STEPS_PER_METRE),
    activeMinutes: Math.round(activeSeconds / 60),
  };
}

/** Compact "1.2 kg" / "340 g" formatting that stays readable in a chip. */
export function formatCo2(grams: number, locale: string): string {
  const value = grams >= 1000 ? grams / 1000 : grams;
  const unit = grams >= 1000 ? 'kg' : 'g';
  const digits = grams >= 10_000 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${unit}`;
}
