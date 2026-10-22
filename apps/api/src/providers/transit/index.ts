import { config } from '../../config.js';
import type { TransitProvider } from './types.js';
import { MotisProvider } from './motis.js';

class DisabledTransitProvider implements TransitProvider {
  readonly name = 'disabled';
  readonly configured = false;
  readonly attribution = 'Transit provider disabled';
  readonly note = 'No transit provider is configured on this deployment.';
  async plan() {
    return [];
  }
}

function create(): TransitProvider {
  switch (config.TRANSIT_PROVIDER) {
    case 'transitous':
      return new MotisProvider({
        baseUrl: config.TRANSITOUS_BASE_URL,
        userAgent: config.TRANSITOUS_USER_AGENT,
        timeoutMs: config.TRANSIT_TIMEOUT_MS,
      });
    case 'local_gtfs':
      return {
        name: 'local_gtfs',
        configured: true,
        attribution:
          'Transit data ingested from published GTFS feeds. See each data source for licence and attribution.',
        note:
          'Uses GTFS imported into this deployment. Coverage depends on which feeds have been ingested.',
        // The scheduled engine is invoked directly by the planner when this
        // provider is active; the provider object exposes no remote planning.
        async plan() {
          return [];
        },
      };
    case 'disabled':
    default:
      return new DisabledTransitProvider();
  }
}

export const transitProvider: TransitProvider = create();
