import type {
  ApiMeta,
  CitySummary,
  CommunityReport,
  CountrySummary,
  JourneyPreference,
  Place,
  PlanRequest,
  PlanResponse,
  SavedJourney,
  UserPreferences,
} from '@routewise/shared';
import { getProfileToken } from './storage';

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
export const API_BASE = RAW_BASE.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    'X-Profile-Token': getProfileToken(),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const body = payload as { message?: string; error?: string } | null;
    throw new ApiError(
      body?.message ?? body?.error ?? `Request failed (HTTP ${res.status})`,
      res.status,
      body?.error ?? 'http_error',
    );
  }
  return payload as T;
}

export const api = {
  meta: () => request<ApiMeta>('/api/v1/meta'),

  geocode: (q: string, opts: { lang?: string; near?: { lat: number; lng: number }; limit?: number } = {}) => {
    const params = new URLSearchParams({ q });
    if (opts.lang) params.set('lang', opts.lang);
    if (opts.near) {
      params.set('lat', String(opts.near.lat));
      params.set('lng', String(opts.near.lng));
    }
    if (opts.limit) params.set('limit', String(opts.limit));
    return request<{ places: Place[]; attribution: string; provider: string }>(
      `/api/v1/geocode?${params.toString()}`,
    );
  },

  reverse: (lat: number, lng: number, lang?: string) => {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (lang) params.set('lang', lang);
    return request<{ place: Place | null }>(`/api/v1/places/reverse?${params.toString()}`);
  },

  plan: (body: PlanRequest) =>
    request<PlanResponse>('/api/v1/plan', { method: 'POST', body: JSON.stringify(body) }),

  coverage: (lat: number, lng: number) =>
    request<{
      transitDataAvailable: boolean;
      nearbyStops: number;
      city: { name: string; countryCode: string; timezone: string; defaultCurrency: string } | null;
      notice: string | null;
    }>(`/api/v1/coverage?lat=${lat}&lng=${lng}`),

  cities: (params: { q?: string; country?: string; hasTransit?: boolean; limit?: number; offset?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.country) search.set('country', params.country);
    if (params.hasTransit) search.set('hasTransit', '1');
    if (params.limit) search.set('limit', String(params.limit));
    if (params.offset) search.set('offset', String(params.offset));
    const qs = search.toString();
    return request<{ cities: CitySummary[]; total: number; notice?: string }>(
      `/api/v1/cities${qs ? `?${qs}` : ''}`,
    );
  },

  stops: (q: string, limit = 15) =>
    request<{ stops: Array<{ id: string; name: string; code?: string | null; location: { lat: number; lng: number } }> }>(
      `/api/v1/stops?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  reports: (params: { cityId?: string; routeId?: string; bbox?: string; category?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    return request<{ reports: CommunityReport[]; disclaimer?: string; notice?: string }>(
      `/api/v1/reports?${search.toString()}`,
    );
  },

  createReport: (body: {
    category: string;
    title: string;
    body: string;
    observedAt: string;
    cityId?: string;
    routeId?: string;
    stopId?: string;
    location?: { lat: number; lng: number };
    currency?: string;
  }) => request<{ report: CommunityReport }>('/api/v1/reports', { method: 'POST', body: JSON.stringify(body) }),

  voteReport: (id: string, vote: 'confirm' | 'dispute') =>
    request<{ report: CommunityReport; alreadyVoted: boolean }>(`/api/v1/reports/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote }),
    }),

  fx: (base: string, symbols?: string[]) =>
    request<{ base: string; provider: string; attribution: string; rates: Record<string, { rate: number; asOf: string } | null> }>(
      `/api/v1/fx/rates?base=${encodeURIComponent(base)}${symbols ? `&symbols=${symbols.join(',')}` : ''}`,
    ),

  getPreferences: () => request<{ preferences: UserPreferences }>('/api/v1/preferences'),

  savePreferences: (prefs: Partial<UserPreferences>) =>
    request<{ preferences: UserPreferences }>('/api/v1/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    }),

  saveJourney: (body: { title: string; journeyId: string; plan: PlanResponse }) =>
    request<{ saved: SavedJourney }>('/api/v1/saved', { method: 'POST', body: JSON.stringify(body) }),

  listSaved: () => request<{ saved: SavedJourney[] }>('/api/v1/saved'),

  getShared: (slug: string) => request<{ saved: SavedJourney }>(`/api/v1/saved/${encodeURIComponent(slug)}`),

  deleteSaved: (id: string) => request<null>(`/api/v1/saved/${id}`, { method: 'DELETE' }),
};

export type { CountrySummary, JourneyPreference };
