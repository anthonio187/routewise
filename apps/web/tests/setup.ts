// jsdom gaps used by the app shell and MapLibre-adjacent code.
import { vi } from 'vitest';

// React 18 requires this flag for act() in jsdom.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

window.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

if (!('crypto' in window) || !window.crypto.randomUUID) {
  Object.defineProperty(window, 'crypto', {
    value: { randomUUID: () => '00000000-0000-4000-8000-000000000000', getRandomValues: (a: Uint8Array) => a.fill(1) },
  });
}

Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
