import type { LatLng, Place } from '@routewise/shared';

export interface GeocodeOptions {
  limit?: number;
  language?: string;
  /** Bias results around the user's current view/position. */
  near?: LatLng;
  countryCode?: string;
}

export interface GeocodingProvider {
  readonly name: string;
  readonly configured: boolean;
  readonly attribution: string;
  search(query: string, options: GeocodeOptions): Promise<Place[]>;
  reverse(location: LatLng, language?: string): Promise<Place | null>;
}
