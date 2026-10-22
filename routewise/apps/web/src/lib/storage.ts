import type { PlanResponse, SavedJourney } from '@routewise/shared';

const PROFILE_KEY = 'routewise.profile.v1';
const SETTINGS_KEY = 'routewise.settings.v1';
const SAVED_KEY = 'routewise.saved.v1';
const RECENT_KEY = 'routewise.recent-places.v1';
const LAST_PLAN_KEY = 'routewise.last-plan.v1';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface AppSettings {
  language: string | null;
  currency: string | null;
  units: 'metric' | 'imperial' | null;
  timezone: string | null;
  theme: ThemePreference;
  /** Pre-select step-free routing on the plan form. */
  stepFreeByDefault: boolean;
  /** Prefer larger tap targets / text where the browser supports it. */
  largerText: boolean;
}

export interface LocalSaved {
  id: string;
  title: string;
  plan: PlanResponse;
  journeyId: string;
  createdAt: string;
  shareSlug?: string | null;
}

/** Stable anonymous profile token; only its salted hash is stored server-side. */
export function getProfileToken(): string {
  try {
    const existing = localStorage.getItem(PROFILE_KEY);
    if (existing && existing.length >= 16) return existing;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(PROFILE_KEY, token);
    return token;
  } catch {
    return 'anon-0000000000000000';
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode, quota). The app keeps working.
  }
}

const DEFAULT_SETTINGS: AppSettings = {
  language: null,
  currency: null,
  units: null,
  timezone: null,
  theme: 'system',
  stepFreeByDefault: false,
  largerText: false,
};

type SettingsListener = () => void;
const settingsListeners = new Set<SettingsListener>();
let settingsSnapshot: AppSettings = { ...DEFAULT_SETTINGS, ...readJson<Partial<AppSettings>>(SETTINGS_KEY, {}) };

export const settingsStore = {
  get(): AppSettings {
    return settingsSnapshot;
  },
  set(patch: Partial<AppSettings>): AppSettings {
    settingsSnapshot = { ...settingsSnapshot, ...patch };
    writeJson(SETTINGS_KEY, settingsSnapshot);
    settingsListeners.forEach((listener) => listener());
    return settingsSnapshot;
  },
  subscribe(listener: SettingsListener): () => void {
    settingsListeners.add(listener);
    return () => settingsListeners.delete(listener);
  },
  reset(): void {
    settingsSnapshot = { ...DEFAULT_SETTINGS };
    writeJson(SETTINGS_KEY, settingsSnapshot);
    settingsListeners.forEach((listener) => listener());
  },
};

export const localSavedStore = {
  all(): LocalSaved[] {
    return readJson<LocalSaved[]>(SAVED_KEY, []);
  },
  add(entry: LocalSaved): LocalSaved[] {
    const sameJourney = (item: LocalSaved) =>
      item.journeyId === entry.journeyId && item.plan.generatedAt === entry.plan.generatedAt;
    const existing = localSavedStore.all().filter((item) => item.id !== entry.id && !sameJourney(item));
    const next = [entry, ...existing].slice(0, 50);
    writeJson(SAVED_KEY, next);
    return next;
  },
  remove(id: string): LocalSaved[] {
    const next = localSavedStore.all().filter((item) => item.id !== id);
    writeJson(SAVED_KEY, next);
    return next;
  },
  get(id: string): LocalSaved | undefined {
    return localSavedStore.all().find((item) => item.id === id);
  },
};

export interface RecentPlace {
  name: string;
  displayName: string;
  location: { lat: number; lng: number };
  kind?: string;
}

export const recentPlacesStore = {
  all(): RecentPlace[] {
    return readJson<RecentPlace[]>(RECENT_KEY, []);
  },
  add(place: RecentPlace): void {
    const existing = recentPlacesStore.all().filter((item) => item.name !== place.name);
    writeJson(RECENT_KEY, [place, ...existing].slice(0, 8));
  },
  clear(): void {
    writeJson(RECENT_KEY, []);
  },
};

export const lastPlanStore = {
  get(): PlanResponse | null {
    return readJson<PlanResponse | null>(LAST_PLAN_KEY, null);
  },
  set(plan: PlanResponse | null): void {
    writeJson(LAST_PLAN_KEY, plan);
  },
};

/** Encode a plan into a URL-safe fragment for offline/shareable links. */
export function encodePlanFragment(plan: PlanResponse): string {
  const json = JSON.stringify({ plan });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePlanFragment(fragment: string): PlanResponse | null {
  try {
    const base64 = fragment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { plan?: PlanResponse };
    return parsed.plan && Array.isArray(parsed.plan.journeys) ? parsed.plan : null;
  } catch {
    return null;
  }
}

export function toLocalSaved(saved: SavedJourney): LocalSaved {
  return {
    id: saved.id,
    title: saved.title,
    plan: saved.plan,
    journeyId: saved.journeyId,
    createdAt: saved.createdAt,
    shareSlug: saved.shareSlug ?? null,
  };
}
