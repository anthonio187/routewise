import type { ReactNode } from 'react';

type Variant = 'search' | 'saved' | 'reports' | 'route' | 'offline';

/**
 * Empty-state block with a small inline illustration. Inline SVG keeps it
 * crisp in both themes and adds no network requests (the app must work offline).
 */
export function EmptyState({
  variant = 'route',
  title,
  hint,
  action,
  compact = false,
}: {
  variant?: Variant;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`card flex flex-col items-center text-center ${compact ? 'gap-1.5 p-6' : 'gap-2 p-10'}`}
      role="status"
    >
      <Art variant={variant} />
      <p className="mt-1 text-sm font-semibold text-ink-900">{title}</p>
      {hint ? <p className="max-w-sm text-xs leading-relaxed text-ink-500">{hint}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

function Art({ variant }: { variant: Variant }) {
  const signal = 'rgb(var(--signal-500))';
  const soft = 'rgb(var(--signal-100))';
  const line = 'rgb(var(--line))';
  const ink = 'rgb(var(--ink-300))';
  return (
    <svg viewBox="0 0 120 88" className="h-20 w-28" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="es-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={soft} stopOpacity="0.9" />
          <stop offset="100%" stopColor={soft} stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <rect x="10" y="14" width="100" height="62" rx="14" fill="url(#es-fade)" stroke={line} />
      {variant === 'search' ? (
        <>
          <circle cx="54" cy="41" r="13" fill="none" stroke={signal} strokeWidth="3" />
          <path d="M64 51l11 11" stroke={signal} strokeWidth="3" strokeLinecap="round" />
          <path d="M22 68h24M22 24h16" stroke={ink} strokeWidth="2" strokeLinecap="round" />
        </>
      ) : null}
      {variant === 'saved' ? (
        <>
          <path d="M50 22h20a5 5 0 0 1 5 5v39l-15-9-15 9V27a5 5 0 0 1 5-5z" fill="none" stroke={signal} strokeWidth="3" strokeLinejoin="round" />
          <path d="M22 66h18M84 66h14" stroke={ink} strokeWidth="2" strokeLinecap="round" />
        </>
      ) : null}
      {variant === 'reports' ? (
        <>
          <path d="M60 20v42l14-9" fill="none" stroke={signal} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="60" cy="18" r="3.5" fill={signal} />
          <path d="M24 62c8-6 14 4 22-2" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5" />
        </>
      ) : null}
      {variant === 'offline' ? (
        <>
          <path d="M38 52a12 12 0 0 1 1-24 16 16 0 0 1 30 4 10 10 0 0 1 1 20z" fill="none" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M34 24l50 44" stroke={signal} strokeWidth="3" strokeLinecap="round" />
        </>
      ) : null}
      {variant === 'route' ? (
        <>
          <path d="M34 60c14 0 10-26 24-26s10 26 24 26" fill="none" stroke={signal} strokeWidth="3" strokeLinecap="round" strokeDasharray="1 7" />
          <circle cx="34" cy="60" r="5" fill={signal} />
          <circle cx="82" cy="60" r="5" fill={soft} stroke={signal} strokeWidth="2.5" />
        </>
      ) : null}
    </svg>
  );
}
