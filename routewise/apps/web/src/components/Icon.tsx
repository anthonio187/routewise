import type { ReactNode, SVGProps } from 'react';

/**
 * A small, consistent icon set (24×24, 1.75 stroke, currentColor).
 * Kept local so the app has no icon-font or runtime dependency.
 */
export type IconName =
  | 'search'
  | 'swap'
  | 'locate'
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-up-right'
  | 'clock'
  | 'calendar'
  | 'walk'
  | 'bike'
  | 'bus'
  | 'train'
  | 'tram'
  | 'ferry'
  | 'car'
  | 'route'
  | 'bookmark'
  | 'share'
  | 'copy'
  | 'close'
  | 'check'
  | 'alert'
  | 'info'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'map'
  | 'list'
  | 'filter'
  | 'trash'
  | 'external'
  | 'sliders'
  | 'flag'
  | 'home'
  | 'globe'
  | 'accessibility'
  | 'printer'
  | 'plus'
  | 'minus'
  | 'refresh'
  | 'sparkles'
  | 'navigation'
  | 'layers'
  | 'wifi-off'
  | 'users'
  | 'pin'
  | 'expand'
  | 'shrink'
  | 'shield'
  | 'leaf'
  | 'keyboard'
  | 'zap';

const P: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  swap: <path d="M7 4v13m0 0-3-3m3 3 3-3M17 20V7m0 0-3 3m3-3 3 3" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  'arrow-right': <path d="M4 12h15m0 0-5.5-5.5M19 12l-5.5 5.5" />,
  'arrow-left': <path d="M20 12H5m0 0 5.5-5.5M5 12l5.5 5.5" />,
  'arrow-up-right': <path d="M7 17 17 7m0 0H8.5M17 7v8.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4.6" r="1.9" />
      <path d="M12.5 8.4 11 13l2.2 2.4V21M11 13l-3 3.2M13.5 10.5l2.8 1.9" />
    </>
  ),
  bike: (
    <>
      <circle cx="5.8" cy="17.5" r="3.4" />
      <circle cx="18.2" cy="17.5" r="3.4" />
      <path d="M6.2 17.2 10 9.5h5.2l3 7.7M9 9.5h6.2" />
    </>
  ),
  bus: (
    <>
      <rect x="4" y="3.5" width="16" height="13.5" rx="2.5" />
      <path d="M4 10.5h16M8 17v3M16 17v3" />
      <circle cx="8" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="16" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  train: (
    <>
      <rect x="5" y="3.2" width="14" height="13.6" rx="3" />
      <path d="M5 10.2h14M9 16.8 7 21M15 16.8 17 21" />
      <circle cx="9" cy="13.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13.2" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  tram: (
    <>
      <rect x="5" y="5.5" width="14" height="12" rx="2.5" />
      <path d="M5 11.5h14M12 5.5V2.5M8.5 17.5 7 21M15.5 17.5 17 21" />
    </>
  ),
  ferry: (
    <>
      <path d="M3 14.5 5 9h14l2 5.5a5.5 5.5 0 0 1-18 0Z" />
      <path d="M12 9V4.5M9 8.5h6" />
    </>
  ),
  car: (
    <>
      <path d="M4 15.5v-2.2c0-.5.15-1 .45-1.4L7 8.2A2 2 0 0 1 8.7 7.3h6.6a2 2 0 0 1 1.7.9l2.55 3.7c.3.4.45.9.45 1.4v2.2" />
      <path d="M4 15.5h16v2.2a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1v-.7H7.2v.7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2.2Z" />
      <path d="M6.5 12h11" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M8.4 6h5.1a3 3 0 0 1 0 6h-3a3 3 0 0 0 0 6h5.1" />
    </>
  ),
  bookmark: <path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.4-6.5 4.4v-16a1 1 0 0 1 1-1Z" />,
  share: (
    <>
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="m8.3 10.8 7.4-4.3M8.3 13.2l7.4 4.3" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2.2" />
      <path d="M15 6.2V5A1.5 1.5 0 0 0 13.5 3.5H5A1.5 1.5 0 0 0 3.5 5v8.5A1.5 1.5 0 0 0 5 15h1.2" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  alert: (
    <>
      <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.2M12 16.6v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 11v5.2M12 7.9v.1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" />
    </>
  ),
  moon: <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'chevron-up': <path d="m6 14.5 6-6 6 6" />,
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  map: (
    <>
      <path d="M9 3.5 3.5 6v14.5L9 18l6 2.5 5.5-2.5V3.5L15 6 9 3.5Z" />
      <path d="M9 3.5V18M15 6v14.5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  filter: <path d="M3.5 5.5h17l-6.6 7.4v6.1l-3.8 2v-8.1L3.5 5.5Z" />,
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3V7" />
      <path d="M6.2 7l.8 12A1.8 1.8 0 0 0 8.8 20.7h6.4a1.8 1.8 0 0 0 1.8-1.7L17.8 7" />
      <path d="M10.2 11v5.5M13.8 11v5.5" />
    </>
  ),
  external: (
    <>
      <path d="M13.5 4H20v6.5M20 4l-8.5 8.5" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  flag: <path d="M5 21V4.2c3.6-2 7.4 2 11 0v9.3c-3.6 2-7.4-2-11 0" />,
  home: (
    <>
      <path d="M3.5 10.8 12 3.5l8.5 7.3" />
      <path d="M5.5 9.4V20h13V9.4" />
      <path d="M9.8 20v-5.4h4.4V20" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M3.6 9.5h16.8M3.6 14.5h16.8" />
      <path d="M12 3.3c2.4 2.3 3.7 5.3 3.7 8.7s-1.3 6.4-3.7 8.7c-2.4-2.3-3.7-5.3-3.7-8.7S9.6 5.6 12 3.3Z" />
    </>
  ),
  accessibility: (
    <>
      <circle cx="12" cy="4.2" r="2" />
      <path d="M4.5 8.2c2.4 1 5 1.5 7.5 1.5s5.1-.5 7.5-1.5M12 9.7v5M12 14.7 9 21M12 14.7 15 21" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3.5h10V8" />
      <rect x="3.5" y="8" width="17" height="8.5" rx="2" />
      <path d="M7 13.5h10v7H7z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5 13.6 8l4.4 1.6-4.4 1.6L12 15.7l-1.6-4.5L6 9.6 10.4 8 12 3.5Z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </>
  ),
  navigation: <path d="m12 3 7 18-7-4.2L5 21 12 3Z" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5" />,
  'wifi-off': (
    <>
      <path d="M3 3l18 18" />
      <path d="M8.5 15.5a5 5 0 0 1 7 0M5 12a10 10 0 0 1 4-2.4M19 12a10 10 0 0 0-3.6-2.2M2 8.8a15 15 0 0 1 5.4-3M22 8.8a15 15 0 0 0-8.2-3.4" />
      <path d="M12 19.5h.01" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6M17.5 14.4a6.2 6.2 0 0 1 3.7 5.6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  expand: <path d="M9 3.5H3.5V9M15 3.5h5.5V9M15 20.5h5.5V15M9 20.5H3.5V15" />,
  shrink: <path d="M3.5 9H9V3.5M20.5 9H15V3.5M20.5 15H15v5.5M3.5 15H9v5.5" />,
  leaf: (
    <>
      <path d="M20 4c-8.5.4-14 4.4-14 10.2 0 3 2.3 5.3 5.2 5.3C17.6 19.5 20 13 20 4Z" />
      <path d="M9.5 20c.6-4.2 2.8-7.8 6.5-10.5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2.5" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13h.01M9.5 13h.01M13 13h.01M16.5 13h.01M8 15.8h8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v6c0 4.4 3.1 7.7 7.5 9 4.4-1.3 7.5-4.6 7.5-9V6L12 3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  zap: <path d="M13.5 2.5 4.5 14h6l-1 7.5L20 9.5h-6l-.5-7Z" />,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, strokeWidth = 1.75, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {P[name]}
    </svg>
  );
}

/** Mode → icon mapping used across journey UI. */
export const MODE_ICONS: Record<string, IconName> = {
  walk: 'walk',
  cycle: 'bike',
  bus: 'bus',
  metro: 'train',
  subway: 'train',
  train: 'train',
  commuter_rail: 'train',
  tram: 'tram',
  light_rail: 'tram',
  ferry: 'ferry',
  cable_tram: 'navigation',
  funicular: 'navigation',
  trolleybus: 'bus',
  monorail: 'tram',
  taxi: 'car',
  ride: 'car',
  other: 'route',
};
