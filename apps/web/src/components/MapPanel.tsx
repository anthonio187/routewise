import { Suspense, lazy, useEffect, useState } from 'react';
import type { DistanceUnits, Journey, PlanResponse } from '@routewise/shared';
import { useI18n } from '../i18n';

/**
 * Lazy boundary around the map.
 *
 * MapLibre GL is by far the largest dependency in the bundle (~800 kB raw).
 * Loading it lazily keeps the planner's first paint fast on a phone; the chunk
 * is prefetched while the browser is idle and while a journey request is in
 * flight, so by the time there are results to draw the map is usually ready.
 */
const MapView = lazy(() =>
  import('./MapView').then((module) => ({ default: module.MapView })),
);

interface Props {
  plan: PlanResponse | null;
  journey: Journey | null;
  units?: DistanceUnits;
}

function MapSkeleton() {
  const { t } = useI18n();
  return (
    <div
      className="flex h-[320px] w-full items-center justify-center overflow-hidden rounded-2xl border border-line bg-ink-50 sm:h-[460px]"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-300 border-t-transparent" />
        <span className="text-xs font-medium text-ink-500">{t('map.loading')}</span>
      </div>
    </div>
  );
}

export function MapPanel(props: Props) {
  const [mounted, setMounted] = useState(false);

  // Mount the lazy map on the next frame after the panel exists, giving the
  // skeleton a chance to paint instead of blocking on the chunk request.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  if (!mounted) return <MapSkeleton />;
  return (
    <Suspense fallback={<MapSkeleton />}>
      <MapView {...props} />
    </Suspense>
  );
}
