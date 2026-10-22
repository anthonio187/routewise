/**
 * UI smoke tests: mount the real app in jsdom with a stubbed API and map.
 *
 * These catch render-time crashes (undefined access, bad i18n keys, missing
 * providers) that type checking cannot see. They never touch the network.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { PlanResponse } from '@routewise/shared';

// MapLibre needs WebGL; the map is irrelevant to these assertions.
vi.mock('../src/components/MapView', () => ({
  MapView: () => <div data-testid="map" />,
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return {
    ...actual,
    api: {
      meta: vi.fn(async () => ({
        name: 'RouteWise',
        version: '0.1.0',
        apiVersion: 'v1',
        generatedAt: new Date().toISOString(),
        defaultLocale: 'en',
        defaultCurrency: null,
        supportedPreferences: ['fastest'],
        supportedModes: ['bus'],
        providers: { transit: { provider: 'transitous', configured: true } },
        dataSources: [],
        notices: [],
        stats: { countries: 250, cities: 236353, stops: 4, routes: 1, citiesWithTransit: 1 },
      })),
      cities: vi.fn(async () => ({
        cities: [
          {
            id: 'c1',
            name: 'Berlin',
            countryCode: 'DE',
            timezone: 'Europe/Berlin',
            defaultCurrency: 'EUR',
            center: { lat: 52.52, lng: 13.405 },
            stopCount: 4,
            hasTransitData: true,
            population: 3426354,
          },
          {
            id: 'c2',
            name: 'Lagos',
            countryCode: 'NG',
            timezone: 'Africa/Lagos',
            defaultCurrency: 'NGN',
            center: { lat: 6.45, lng: 3.39 },
            stopCount: 0,
            hasTransitData: false,
            population: 15388000,
          },
        ],
        total: 2,
      })),
      stops: vi.fn(async () => ({ stops: [] })),
      geocode: vi.fn(async () => ({ places: [], attribution: 'OSM', provider: 'nominatim' })),
      reverse: vi.fn(async () => ({ place: null })),
      plan: vi.fn(async () => samplePlan),
      coverage: vi.fn(async () => ({
        transitDataAvailable: true,
        nearbyStops: 4,
        city: null,
        notice: null,
      })),
      reports: vi.fn(async () => ({ reports: [] })),
      createReport: vi.fn(),
      voteReport: vi.fn(),
      fx: vi.fn(async () => ({ base: 'EUR', provider: 'open_er_api', attribution: '', rates: {} })),
      getPreferences: vi.fn(),
      savePreferences: vi.fn(async (prefs: unknown) => ({ preferences: prefs })),
      saveJourney: vi.fn(async () => ({ saved: { id: 's1', shareSlug: 'abc' } })),
      listSaved: vi.fn(async () => ({ saved: [] })),
      getShared: vi.fn(async () => ({ saved: { plan: samplePlan, journeyId: 'j1' } })),
      deleteSaved: vi.fn(),
    },
  };
});

const samplePlan = {
  requestId: 'r1',
  origin: { id: 'o', name: 'Alpha Street', location: { lat: 52.5219, lng: 13.4132 }, kind: 'address', provider: 'nominatim' },
  destination: { id: 'd', name: 'Delta Park', location: { lat: 52.503, lng: 13.38 }, kind: 'poi', provider: 'nominatim' },
  departureTime: '2026-10-20T06:00:00.000Z',
  arriveBy: false,
  preference: 'fastest',
  currency: 'EUR',
  journeys: [
    {
      id: 'j1',
      legs: [
        {
          mode: 'bus',
          instruction: 'Take bus T1 towards Delta Park',
          from: { name: 'Alpha Street', location: { lat: 52.5219, lng: 13.4132 } },
          to: { name: 'Delta Park', location: { lat: 52.503, lng: 13.38 } },
          startTime: '2026-10-20T06:00:00.000Z',
          endTime: '2026-10-20T06:18:00.000Z',
          durationSeconds: 1080,
          distanceMeters: 2400,
          geometry: [
            [13.4132, 52.5219],
            [13.38, 52.503],
          ],
          route: { id: 'r', shortName: 'T1', longName: 'Test Line', mode: 'bus', agencyName: 'TEST Transit' },
          intermediateStops: [{ name: 'Bravo Square' }, { name: 'Charlie Bridge' }],
          dataQuality: 'scheduled',
        },
      ],
      departureTime: '2026-10-20T06:00:00.000Z',
      arrivalTime: '2026-10-20T06:18:00.000Z',
      durationSeconds: 1080,
      transfers: 0,
      walkingMeters: 120,
      fare: { status: 'known', total: { amount: 3.5, currency: 'EUR' }, note: 'Observed fare' },
      dataQuality: 'scheduled',
      warnings: [],
      rankingNote: null,
    },
  ],
  coverage: {
    transitDataAvailable: true,
    nearbyStops: 4,
    cityId: 'c1',
    cityName: 'Berlin',
    countryCode: 'DE',
    dataSources: [],
  },
  notices: [],
  providers: { transit: { provider: 'local_gtfs', configured: true } },
} as unknown as PlanResponse;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderAt(path: string) {
  const { default: App } = await import('../src/App');
  const { I18nProvider } = await import('../src/i18n');
  const { ToastProvider } = await import('../src/components/Toast');
  // Fresh root per render: a MemoryRouter keeps its own history instance.
  act(() => root.unmount());
  container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </ToastProvider>
      </I18nProvider>,
    );
  });
  // Let effects and the stubbed API promises settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return container.textContent ?? '';
}

describe('app shell', () => {
  it('renders the planner with the global hero and quick starts', async () => {
    const text = await renderAt('/');
    expect(text).toContain('Plan any journey, anywhere.');
    expect(text).toContain('Berlin');
    expect(text).toContain('Lagos');
    expect(text).toContain('250 countries & territories');
    expect(text).toContain('236k real cities');
  });

  it('renders the explore directory with database stats', async () => {
    const text = await renderAt('/explore');
    expect(text).toContain('Explore the world');
    expect(text).toContain('236,353');
    expect(text).toContain('Berlin');
    expect(text).toContain('Transit');
  });

  it('renders the settings page with every section', async () => {
    const text = await renderAt('/settings');
    for (const heading of ['Appearance', 'Language & region', 'Money', 'Accessibility', 'Data & privacy', 'Connected providers']) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('Light');
    expect(text).toContain('System');
  });

  it('renders a shared itinerary from a self-contained link', async () => {
    const { encodePlanFragment } = await import('../src/lib/storage');
    const text = await renderAt(`/share#p=${encodePlanFragment(samplePlan)}`);
    expect(text).toContain('Alpha Street');
    expect(text).toContain('Delta Park');
    expect(text).toContain('Shared journey');
    expect(text).toContain('Best match');
    expect(text).toContain('€3.50');
  });

  it('renders the 404 page for an unknown route', async () => {
    const text = await renderAt('/definitely-not-a-page');
    expect(text).toContain('404');
  });

  it('opens the keyboard shortcut sheet with "?"', async () => {
    await renderAt('/explore');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('Keyboard shortcuts');
    expect(text).toContain('Search places and pages');
    expect(text).toContain('Close a dialog');
  });

  it('shows the impact estimate on a journey card', async () => {
    const text = await renderAt('/');
    // The planner restores the last plan only after a search, so drive one:
    // fill both endpoints by clicking quick-start cities, then submit.
    const buttons = Array.from(container.querySelectorAll('button'));
    const berlin = buttons.find((button) => button.textContent?.includes('Berlin'));
    const lagos = buttons.find((button) => button.textContent?.includes('Lagos'));
    expect(berlin).toBeTruthy();
    expect(lagos).toBeTruthy();
    await act(async () => {
      berlin?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      lagos?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const submit = container.querySelector('button[type="submit"]');
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const rendered = container.textContent ?? '';
    expect(rendered).toContain('CO₂ avoided');
    expect(text).toContain('Plan any journey, anywhere.');
  });

  it('renders reports and saved pages without crashing', async () => {
    const reports = await renderAt('/reports');
    expect(reports).toContain('Community reports');
    expect(reports).toContain('No reports yet for this area.');
    const saved = await renderAt('/saved');
    expect(saved).toContain('Saved journeys');
  });
});
