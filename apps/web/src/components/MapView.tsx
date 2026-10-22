import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import type { DistanceUnits, Journey, PlanResponse } from '@routewise/shared';
import { useI18n } from '../i18n';
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';

/**
 * OpenFreeMap serves OpenMapTiles vector tiles (keyless), with real building
 * footprints and heights, POIs, street furniture and place labels. `liberty` is
 * the full light style; `dark` is its dark counterpart.
 */
const STYLE_LIGHT =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK =
  (import.meta.env.VITE_MAP_DARK_STYLE_URL as string | undefined) ??
  'https://tiles.openfreemap.org/styles/dark';

const MODE_COLORS: Record<string, string> = {
  walk: '#557098',
  cycle: '#0ea5e9',
  bus: '#f59e0b',
  metro: '#2563eb',
  subway: '#1d4ed8',
  train: '#7c3aed',
  commuter_rail: '#6d28d9',
  tram: '#10b981',
  light_rail: '#059669',
  ferry: '#0891b2',
  cable_tram: '#db2777',
  funicular: '#be123c',
  trolleybus: '#d97706',
  monorail: '#9333ea',
  taxi: '#475569',
  ride: '#475569',
  other: '#64748b',
};

const MODE_KEYS: Record<string, string> = {
  walk: 'mode.walk',
  cycle: 'mode.cycle',
  bus: 'mode.bus',
  metro: 'mode.metro',
  subway: 'mode.subway',
  train: 'mode.train',
  commuter_rail: 'mode.commuterRail',
  tram: 'mode.tram',
  light_rail: 'mode.lightRail',
  ferry: 'mode.ferry',
  cable_tram: 'mode.cableTram',
  funicular: 'mode.funicular',
  trolleybus: 'mode.trolleybus',
  monorail: 'mode.monorail',
  taxi: 'mode.taxi',
  ride: 'mode.ride',
  other: 'mode.other',
};

/**
 * Satellite imagery (Google-Maps-style aerial view). Esri World Imagery is a
 * keyless raster service; MapLibre draws it underneath the style's labels, so
 * the result is the familiar "hybrid" look: photographs plus street names.
 * Attribution is displayed through the map's attribution control.
 */
const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';

const THREE_D_KEY = 'routewise.map.3d';
const POI_KEY = 'routewise.map.poi';
const SATELLITE_KEY = 'routewise.map.satellite';

function readPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // storage may be disabled; toggles still work for this session
  }
}

function tileSourceId(map: MapLibreMap): string | null {
  const style = map.getStyle();
  if (!style?.sources) return null;
  if (style.sources.openmaptiles) return 'openmaptiles';
  for (const [id, source] of Object.entries(style.sources)) {
    if ((source as { type?: string }).type === 'vector') return id;
  }
  return null;
}

function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  return (map.getStyle()?.layers ?? []).find((layer) => layer.type === 'symbol')?.id;
}

/**
 * Show or hide the aerial imagery. The raster layer is inserted directly below
 * the first symbol layer so place and street labels stay readable on top of it.
 */
function applySatellite(map: MapLibreMap, enabled: boolean) {
  if (!map.getStyle()) return;
  if (enabled) {
    if (!map.getSource('satellite')) {
      map.addSource('satellite', {
        type: 'raster',
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: SATELLITE_ATTRIBUTION,
      });
    }
    if (!map.getLayer('satellite')) {
      map.addLayer(
        { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-opacity': 1 } },
        firstSymbolLayerId(map),
      );
    }
    // The photographs sit above the vector fills, so the basemap is simply
    // covered; only the extruded buildings need switching off (they would
    // float above the images).
    if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', 'none');
  } else {
    if (map.getLayer('satellite')) map.removeLayer('satellite');
    if (map.getSource('satellite')) map.removeSource('satellite');
    if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', 'visible');
  }
}

function applyPoiVisibility(map: MapLibreMap, visible: boolean) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.id.startsWith('poi_')) {
      map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

interface Props {
  plan: PlanResponse | null;
  journey: Journey | null;
  units?: DistanceUnits;
}

export function MapView({ plan, journey, units = 'metric' }: Props) {
  const { t } = useI18n();
  const { resolved } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const readyRef = useRef(false);
  const renderRef = useRef<() => void>(() => {});

  const [is3D, setIs3D] = useState(() => readPref(THREE_D_KEY, true));
  const [showPois, setShowPois] = useState(() => readPref(POI_KEY, true));
  const [satellite, setSatellite] = useState(() => readPref(SATELLITE_KEY, false));
  const [expanded, setExpanded] = useState(false);
  const is3DRef = useRef(is3D);
  is3DRef.current = is3D;
  const showPoisRef = useRef(showPois);
  showPoisRef.current = showPois;
  const satelliteRef = useRef(satellite);
  satelliteRef.current = satellite;
  /** The first fit after the style loads must not animate — the map is still empty. */
  const firstFitRef = useRef(true);

  const formatDistance = useCallback(
    (meters: number) => {
      if (units === 'imperial') {
        const feet = meters * 3.28084;
        return feet >= 1000 ? `${(feet / 5280).toFixed(1)} mi` : `${Math.round(feet)} ft`;
      }
      return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
    },
    [units],
  );

  const applyPitch = useCallback((map: MapLibreMap, enabled: boolean) => {
    const zoom = map.getZoom();
    map.easeTo({ pitch: enabled ? (zoom >= 12.5 ? 55 : 16) : 0, duration: 650 });
  }, []);

  const ensureBuildingLayer = useCallback((map: MapLibreMap) => {
    if (map.getLayer('building-3d')) return;
    const source = tileSourceId(map);
    if (!source) return;
    try {
      map.addLayer({
        id: 'building-3d',
        type: 'fill-extrusion',
        source,
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'render_height'], 8],
            0,
            '#e7e2da',
            40,
            '#ddd5ca',
            120,
            '#cfc6b8',
            300,
            '#b8ad9d',
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.92,
        },
      });
    } catch {
      // Style lacks a building layer; nothing to add.
    }
  }, []);

  const installLayers = useCallback(
    (map: MapLibreMap) => {
      ensureBuildingLayer(map);
      if (!map.getSource('journey')) {
        map.addSource('journey', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('journey-casing')) {
        map.addLayer({
          id: 'journey-casing',
          type: 'line',
          source: 'journey',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': resolved === 'dark' ? '#0b1220' : '#ffffff',
            'line-width': ['case', ['get', 'dashed'], 6, 9],
            'line-opacity': 0.9,
          },
        });
      }
      if (!map.getLayer('journey-line')) {
        map.addLayer({
          id: 'journey-line',
          type: 'line',
          source: 'journey',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['case', ['get', 'dashed'], 3, 5.5],
            'line-opacity': 0.95,
          },
        });
      }
      applySatellite(map, satelliteRef.current);
      applyPoiVisibility(map, showPoisRef.current);
      renderRef.current();
    },
    [ensureBuildingLayer, resolved],
  );

  // --- Map bootstrap (once) ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolved === 'dark' ? STYLE_DARK : STYLE_LIGHT,
      center: [12, 24],
      zoom: 1.5,
      maxPitch: 70,
      antialias: true,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showAccuracyCircle: true,
      }),
      'top-right',
    );
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 90, unit: units === 'imperial' ? 'imperial' : 'metric' }),
      'bottom-left',
    );
    // The style and the satellite source already carry their own required
    // attribution; adding a duplicate line only covers the map on small screens.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    try {
      map.setSky({
        'sky-color': resolved === 'dark' ? '#0b1220' : '#9fc4ee',
        'horizon-color': resolved === 'dark' ? '#1e293b' : '#eef4fb',
        'fog-color': resolved === 'dark' ? '#0f172a' : '#e6edf6',
        'fog-ground-blend': 0.85,
        'horizon-fog-blend': 0.55,
        'sky-horizon-blend': 0.35,
      });
    } catch {
      // older MapLibre versions simply skip the sky
    }

    const onLoad = () => {
      readyRef.current = true;
      // installLayers() renders the journey, which fits the camera to it.
      // Do not animate the pitch here: an easeTo() started right after
      // fitBounds() puts the camera back at the old position, which is why the
      // map used to stay zoomed out at the whole world. Pitch is applied after
      // the fit, in render()'s moveend handler.
      installLayers(map);
      firstFitRef.current = true;
    };

    if (map.isStyleLoaded()) onLoad();
    else map.once('load', onLoad);

    // Building details.
    map.on('click', (event) => {
      if (!is3DRef.current || !map.getLayer('building-3d')) return;
      const [feature] = map.queryRenderedFeatures(event.point, { layers: ['building-3d'] });
      if (!feature) return;
      const props = feature.properties ?? {};
      const name = (props.name as string | undefined) ?? null;
      const height = Number(props.render_height);
      const levels = Number(props.levels);
      popupRef.current?.remove();
      const el = document.createElement('div');
      el.className = 'rw-popup';
      const title = document.createElement('strong');
      title.textContent = name || t('map.building');
      el.appendChild(title);
      if (Number.isFinite(height) && height > 0) {
        const line = document.createElement('div');
        line.textContent = `${t('map.height')}: ${formatDistance(height)}`;
        el.appendChild(line);
      }
      if (Number.isFinite(levels) && levels > 0) {
        const line = document.createElement('div');
        line.textContent = `${t('map.levels')}: ${levels}`;
        el.appendChild(line);
      }
      const note = document.createElement('div');
      note.className = 'rw-popup-note';
      note.textContent = 'OpenStreetMap / OpenMapTiles';
      el.appendChild(note);
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
        .setLngLat(event.lngLat)
        .setDOMContent(el)
        .addTo(map);
    });

    map.on('click', 'journey-line', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const props = feature.properties ?? {};
      popupRef.current?.remove();
      const el = document.createElement('div');
      el.className = 'rw-popup';
      const title = document.createElement('strong');
      title.textContent = String(props.label ?? '');
      el.appendChild(title);
      const meta = document.createElement('div');
      meta.textContent = String(props.meta ?? '');
      el.appendChild(meta);
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(event.lngLat)
        .setDOMContent(el)
        .addTo(map);
    });
    map.on('mouseenter', 'journey-line', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'journey-line', () => {
      map.getCanvas().style.cursor = '';
    });

    return () => {
      readyRef.current = false;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Theme switch: swap style, then rebuild overlays ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setStyle(resolved === 'dark' ? STYLE_DARK : STYLE_LIGHT);
    map.once('style.load', () => {
      installLayers(map);
      try {
        map.setSky({
          'sky-color': resolved === 'dark' ? '#0b1220' : '#9fc4ee',
          'horizon-color': resolved === 'dark' ? '#1e293b' : '#eef4fb',
          'fog-color': resolved === 'dark' ? '#0f172a' : '#e6edf6',
          'fog-ground-blend': 0.85,
          'horizon-fog-blend': 0.55,
          'sky-horizon-blend': 0.35,
        });
      } catch {
        // ignore
      }
    });
  }, [resolved, installLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyPitch(map, is3D);
    writePref(THREE_D_KEY, is3D);
  }, [is3D, applyPitch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyPoiVisibility(map, showPois);
    writePref(POI_KEY, showPois);
  }, [showPois]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applySatellite(map, satellite);
    writePref(SATELLITE_KEY, satellite);
    // 3D tilt makes no sense over photographs.
    if (satellite && map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 400 });
    if (!satellite) applyPitch(map, is3D);
  }, [satellite, is3D, applyPitch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const timer = window.setTimeout(() => map.resize(), 320);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  // --- Journey geometry + markers ---
  const render = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    const source = map.getSource('journey') as maplibregl.GeoJSONSource | undefined;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    if (!journey || !plan) {
      source?.setData(empty);
      return;
    }

    const features: GeoJSON.Feature[] = journey.legs
      .filter((leg) => leg.geometry.length > 1)
      .map((leg, index) => {
        const mode = t((MODE_KEYS[leg.mode] ?? 'mode.other') as never);
        const route = leg.route?.shortName ? ` ${leg.route.shortName}` : '';
        return {
          type: 'Feature',
          properties: {
            color: MODE_COLORS[leg.mode] ?? MODE_COLORS.other,
            order: index,
            dashed: leg.mode === 'walk' || leg.mode === 'cycle',
            label: `${mode}${route}`,
            meta: `${leg.from.name} → ${leg.to.name}`,
          },
          geometry: { type: 'LineString', coordinates: leg.geometry },
        };
      });

    source?.setData({ type: 'FeatureCollection', features });

    const addMarker = (lngLat: [number, number], color: string, label: string, kind: 'origin' | 'destination' | 'stop') => {
      const element = document.createElement('div');
      const size = kind === 'stop' ? '12px' : '16px';
      element.style.width = size;
      element.style.height = size;
      element.style.borderRadius = '9999px';
      element.style.background = color;
      element.style.border = '3px solid #fff';
      element.style.boxShadow = '0 1px 6px rgba(0,0,0,0.35)';
      element.setAttribute('aria-label', label);
      element.tabIndex = 0;
      const marker = new maplibregl.Marker({ element }).setLngLat(lngLat).addTo(map);
      marker.setPopup(
        new maplibregl.Popup({ offset: 14, closeButton: false, maxWidth: '220px' }).setText(label),
      );
      markersRef.current.push(marker);
    };

    addMarker([plan.origin.location.lng, plan.origin.location.lat], '#0f172a', plan.origin.name, 'origin');
    addMarker([plan.destination.location.lng, plan.destination.location.lat], '#059669', plan.destination.name, 'destination');
    for (const leg of journey.legs) {
      if (leg.mode === 'walk') continue;
      if (leg.from.location) addMarker([leg.from.location.lng, leg.from.location.lat], '#0ea5e9', leg.from.name, 'stop');
    }

    const bounds = new maplibregl.LngLatBounds();
    let hasPoint = false;
    for (const leg of journey.legs) {
      for (const coordinate of leg.geometry) {
        if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
        bounds.extend(coordinate as [number, number]);
        hasPoint = true;
      }
    }
    if (hasPoint && !bounds.isEmpty()) {
      const first = firstFitRef.current;
      firstFitRef.current = false;
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: { top: 90, bottom: 70, left: 50, right: 50 },
        maxZoom: 15.5,
        // The very first fit happens while the map is still painting its first
        // tiles; animating it just delays usable content.
        duration: first ? 0 : 700,
      });
      map.once('moveend', () => {
        if (!is3DRef.current || satelliteRef.current) return;
        if (map.getZoom() >= 12.5) map.easeTo({ pitch: 55, duration: 600 });
      });
    }
  }, [journey, plan, t]);

  renderRef.current = render;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (readyRef.current) render();
    else map.once('routewise:ready', render);
  }, [render]);

  const modes = Array.from(
    new Set((journey?.legs ?? []).filter((leg) => leg.mode !== 'walk').map((leg) => leg.mode)),
  );
  const hasJourney = Boolean(journey && journey.legs.some((leg) => leg.geometry.length > 1));

  return (
    <div
      className={
        expanded
          ? 'fixed inset-0 z-[60] flex flex-col bg-canvas'
          : 'overflow-hidden rounded-2xl border border-line bg-surface shadow-card'
      }
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded || undefined}
    >
      <div className={expanded ? 'relative flex-1' : 'relative'}>
        <div
          ref={containerRef}
          className={expanded ? 'h-full w-full' : 'h-[320px] w-full sm:h-[460px]'}
          role="application"
          aria-label={t('map.label')}
        />

        <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex flex-wrap gap-1.5">
          <button type="button" className="rw-map-toggle pointer-events-auto" aria-pressed={is3D} onClick={() => setIs3D((value) => !value)} title={t('map.toggle3dHint')}>
            <Icon name="layers" size={12} />
            3D
          </button>
          <button
            type="button"
            className="rw-map-toggle pointer-events-auto"
            aria-pressed={satellite}
            onClick={() => setSatellite((value) => !value)}
            title={t('map.satelliteHint')}
          >
            <Icon name="globe" size={12} />
            {satellite ? t('map.satelliteOn') : t('map.satellite')}
          </button>
          <button type="button" className="rw-map-toggle pointer-events-auto" aria-pressed={showPois} onClick={() => setShowPois((value) => !value)} title={t('map.togglePoiHint')}>
            <Icon name="pin" size={12} />
            {t('map.pois')}
          </button>
          {hasJourney ? (
            <button type="button" className="rw-map-toggle pointer-events-auto" onClick={() => render()} title={t('map.recenter')}>
              <Icon name="navigation" size={12} />
              {t('map.recenter')}
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="rw-map-toggle absolute right-2.5 top-2.5 z-10"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? t('map.close') : t('map.expand')}
          title={expanded ? t('map.close') : t('map.expand')}
        >
          <Icon name={expanded ? 'shrink' : 'expand'} size={13} />
          {expanded ? t('map.close') : t('map.expand')}
        </button>
      </div>

      {!expanded && modes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-ink-600">
          <span className="font-semibold uppercase tracking-wide text-ink-400">{t('map.legend')}</span>
          {modes.map((mode) => (
            <span key={mode} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: MODE_COLORS[mode] ?? MODE_COLORS.other }} />
              {t((MODE_KEYS[mode] ?? 'mode.other') as never)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-ink-400" />
            {t('mode.walk')}
          </span>
        </div>
      ) : null}

      {!hasJourney ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-canvas/40">
          <div className="rounded-xl border border-line bg-surface/95 px-3 py-2 text-xs font-medium text-ink-600 shadow-card">
            {t('map.empty')}
          </div>
        </div>
      ) : null}
    </div>
  );
}
