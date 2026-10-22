import type { Journey, JourneyPreference } from '@routewise/shared';

export interface RankResult {
  journeys: Journey[];
  /** Honest explanation of any preference that could not be applied. */
  notes: string[];
}

/**
 * Rank journeys for a stated preference using ONLY data that exists.
 * When "cheapest" is requested but fares are missing, we do not pretend to rank
 * by price; we fall back to duration and say so.
 */
export function rankJourneys(journeys: Journey[], preference: JourneyPreference = 'fastest'): RankResult {
  const notes: string[] = [];
  const scored = journeys.map((journey) => ({ journey, score: scoreJourney(journey, preference, notes) }));
  scored.sort((a, b) => a.score - b.score || a.journey.transfers - b.journey.transfers);

  const ranked = scored.map(({ journey }, index) => ({
    ...journey,
    rankingNote: buildRankingNote(journey, preference, index),
  }));
  return { journeys: ranked, notes };
}

function scoreJourney(journey: Journey, preference: JourneyPreference, notes: string[]): number {
  const duration = journey.durationSeconds;
  switch (preference) {
    case 'fewest_transfers':
      return journey.transfers * 900 + duration * 0.35;
    case 'least_walking':
      return journey.walkingMeters / 80 + duration * 0.25;
    case 'accessible': {
      const issues = journey.legs.filter((leg) => leg.accessibility?.wheelchairAccessible === 'no').length;
      const unknown = journey.legs.filter(
        (leg) => leg.mode !== 'walk' && (!leg.accessibility || leg.accessibility.wheelchairAccessible === 'unknown'),
      ).length;
      return issues * 3600 + unknown * 300 + duration * 0.2;
    }
    case 'cheapest': {
      const total = journey.fare.total;
      if (total && journey.fare.status === 'known') {
        // Costs are only comparable inside one currency; mixed-currency totals
        // are converted by the caller before ranking when FX is available.
        return total.amount + duration / 3600;
      }
      if (!notes.includes('Fares are unavailable for some journeys, so they cannot be ranked by price.')) {
        notes.push('Fares are unavailable for some journeys, so they cannot be ranked by price.');
      }
      return duration;
    }
    case 'fastest':
    default:
      return duration;
  }
}

function buildRankingNote(journey: Journey, preference: JourneyPreference, index: number): string {
  const base = `Ranked #${index + 1}`;
  switch (preference) {
    case 'fewest_transfers':
      return `${base} by fewest transfers (${journey.transfers}), with duration as a tie-breaker.`;
    case 'least_walking':
      return `${base} by least walking (${Math.round(journey.walkingMeters)} m), with duration as a tie-breaker.`;
    case 'accessible': {
      const unknown = journey.legs.filter(
        (leg) => leg.mode !== 'walk' && (!leg.accessibility || leg.accessibility.wheelchairAccessible === 'unknown'),
      ).length;
      return unknown > 0
        ? `${base} using verified accessibility data where available; ${unknown} leg(s) have unknown accessibility.`
        : `${base} using verified step-free information.`;
    }
    case 'cheapest':
      return journey.fare.status === 'known' && journey.fare.total
        ? `${base} by total fare (${journey.fare.total.amount.toFixed(2)} ${journey.fare.total.currency}).`
        : `${base} by duration — fare data is missing, so price ranking was not possible.`;
    case 'fastest':
    default:
      return `${base} by fastest arrival.`;
  }
}

/** Remove duplicates that share the same mode sequence and near-identical timing. */
export function dedupeJourneys(journeys: Journey[]): Journey[] {
  const out: Journey[] = [];
  for (const journey of journeys) {
    const signature = journey.legs
      .map((leg) => `${leg.mode}:${leg.route?.shortName ?? ''}:${leg.from.name}→${leg.to.name}`)
      .join('|');
    const duplicate = out.find((existing) => {
      const existingSig = existing.legs
        .map((leg) => `${leg.mode}:${leg.route?.shortName ?? ''}:${leg.from.name}→${leg.to.name}`)
        .join('|');
      if (existingSig !== signature) return false;
      const depA = existing.departureTime ? new Date(existing.departureTime).getTime() : 0;
      const depB = journey.departureTime ? new Date(journey.departureTime).getTime() : 0;
      return Math.abs(depA - depB) < 10 * 60_000;
    });
    if (!duplicate) out.push(journey);
  }
  return out;
}
