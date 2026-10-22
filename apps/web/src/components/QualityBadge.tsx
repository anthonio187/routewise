import type { DataQuality } from '@routewise/shared';
import { useI18n } from '../i18n';

const STYLES: Record<DataQuality, string> = {
  live: 'bg-emerald-100 text-emerald-900',
  scheduled: 'bg-sky-100 text-sky-900',
  estimated: 'bg-amber-100 text-amber-900',
  community: 'bg-violet-100 text-violet-900',
  unknown: 'bg-ink-100 text-ink-700',
};

const LABEL_KEY = {
  live: 'quality.live',
  scheduled: 'quality.scheduled',
  estimated: 'quality.estimated',
  community: 'quality.community',
  unknown: 'quality.unknown',
} as const;

export function QualityBadge({ quality }: { quality: DataQuality }) {
  const { t } = useI18n();
  return <span className={`chip ${STYLES[quality]}`}>{t(LABEL_KEY[quality])}</span>;
}
