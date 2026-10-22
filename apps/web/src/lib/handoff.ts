import type { Place } from '@routewise/shared';

const KEY = 'routewise.pending-place.v1';

export type PendingRole = 'origin' | 'destination';

interface Pending {
  role: PendingRole;
  place: Place;
}

/** Pass a chosen place from the command palette (or Explore) to the planner. */
export function setPendingPlace(place: Place, role: PendingRole = 'destination'): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ role, place } satisfies Pending));
  } catch {
    // Private mode: the planner simply opens without a pre-filled field.
  }
}

/** Read and clear the pending place exactly once. */
export function takePendingPlace(): Pending | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as Pending;
    if (!parsed?.place?.location || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}
