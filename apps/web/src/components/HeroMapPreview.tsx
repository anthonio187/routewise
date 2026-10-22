/**
 * Hero artwork: real satellite imagery, not a drawn placeholder.
 *
 * The card is a tiny mosaic of Esri World Imagery raster tiles — the same
 * imagery the map's Satellite mode uses — so the first thing a visitor sees is
 * actual aerial photography. When the browser already knows roughly where the
 * traveller is, the mosaic is centred on their own neighbourhood; otherwise it
 * shows the whole planet, which is the honest neutral default for a global app.
 *
 * It is decorative: no tiles are interactive and no message depends on it.
 * Plain <img> tiles keep it far cheaper than booting a WebGL map on the landing
 * page (six cached images instead of MapLibre plus a style and fonts).
 */
import { useMemo } from 'react';
import { useI18n } from '../i18n';

const TILE = 256;
const TILES = 3; // 3x3 mosaic, cropped by the card

interface Props {
  /** Rough device/last-plan area. Null renders the global view. */
  area: { lat: number; lng: number } | null;
}

/** Fractional slippy-map tile coordinates for a point at a zoom level. */
function project(lat: number, lng: number, zoom: number) {
  const scale = 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const clamped = Math.max(Math.min(lat, 85.0511), -85.0511);
  const rad = (clamped * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
  return { x, y };
}

function tileUrl(x: number, y: number, z: number) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

export function HeroMapPreview({ area }: Props) {
  const { t } = useI18n();

  // Neighbourhood level when we know the area (real streets and rooftops),
  // otherwise zoom 2 — Earth, photographed.
  const zoom = area ? 13 : 2;
  const centre = area ?? { lat: 12, lng: 24 };

  const mosaic = useMemo(() => {
    const { x, y } = project(centre.lat, centre.lng, zoom);
    const firstX = Math.floor(x) - 1;
    const firstY = Math.floor(y) - 1;
    const max = 2 ** zoom;
    const tiles: Array<{ key: string; src: string; left: number; top: number }> = [];
    for (let dy = 0; dy < TILES; dy += 1) {
      for (let dx = 0; dx < TILES; dx += 1) {
        const tx = ((firstX + dx) % max + max) % max;
        const ty = firstY + dy;
        if (ty < 0 || ty >= max) continue;
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          src: tileUrl(tx, ty, zoom),
          left: dx * TILE,
          top: dy * TILE,
        });
      }
    }
    // Offset so the centre of the mosaic sits on the point of interest.
    const offsetX = (x - Math.floor(x)) * TILE;
    const offsetY = (y - Math.floor(y)) * TILE;
    return { tiles, offsetX, offsetY, size: TILES * TILE };
  }, [centre.lat, centre.lng, zoom]);

  return (
    <div
      className="pointer-events-none absolute right-4 top-5 hidden h-[188px] w-[292px] overflow-hidden rounded-3xl border border-line shadow-lift lg:block"
      aria-hidden="true"
    >
      <div
        className="absolute"
        style={{
          width: mosaic.size,
          height: mosaic.size,
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) translate(${TILE / 2 - mosaic.offsetX}px, ${TILE / 2 - mosaic.offsetY}px)`,
        }}
      >
        {mosaic.tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.src}
            alt=""
            width={TILE}
            height={TILE}
            loading="eager"
            decoding="async"
            className="absolute select-none"
            style={{ left: tile.left, top: tile.top }}
            draggable={false}
          />
        ))}
      </div>

      {/* Route accent drawn over the imagery, matching the map's route colour. */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 292 188" fill="none" aria-hidden="true">
        <path
          d="M38 142c30-6 26-42 55-49s34 27 57 18 21-42 50-47"
          stroke="rgb(var(--signal-500))"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="0.5 10"
        />
        <circle cx="38" cy="142" r="7" fill="#fff" stroke="rgb(var(--signal-600))" strokeWidth="4" />
        <circle cx="200" cy="64" r="7" fill="#fff" stroke="rgb(var(--ink-900))" strokeWidth="4" />
        {area ? (
          <circle cx="146" cy="94" r="5" fill="#fff" stroke="rgb(var(--signal-500))" strokeWidth="3" />
        ) : null}
      </svg>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 pb-2 pt-6">
        <span
          className="block truncate text-[9px] font-medium leading-tight text-white/85"
          title={`${area ? t('home.heroArea') : t('home.heroWorld')} · ${t('map.imageryCredit')}`}
        >
          {area ? t('home.heroArea') : t('home.heroWorld')} · {t('map.imageryCredit')}
        </span>
      </div>
    </div>
  );
}
