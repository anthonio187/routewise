import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Keyboard shortcut reference. Opened with "?" or from the command palette.
 * Uses a native dialog-like overlay: Escape closes, focus moves in on open and
 * returns to the previously focused element on close.
 */
export function ShortcutsDialog({ open, onClose }: Props) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => panelRef.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const rows: Array<{ keys: string[]; label: string }> = [
    { keys: ['⌘', 'K'], label: t('keys.palette') },
    { keys: ['/'], label: t('keys.search') },
    { keys: ['?'], label: t('keys.help') },
    { keys: ['Esc'], label: t('keys.close') },
    { keys: ['↑', '↓'], label: t('keys.move') },
    { keys: ['↵'], label: t('keys.select') },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm"
        aria-label={t('common.close')}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-lift animate-fade-up focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="shortcuts-title" className="text-sm font-bold text-ink-900">
            {t('keys.title')}
          </h2>
          <button type="button" className="icon-btn h-8 w-8" onClick={onClose} aria-label={t('common.close')}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <dl className="divide-y divide-line px-4 py-1">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-[13px] text-ink-700">{row.label}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {row.keys.map((key) => (
                  <kbd
                    key={key}
                    className="min-w-[24px] rounded-md border border-line bg-raised px-1.5 py-0.5 text-center text-[11px] font-semibold text-ink-600"
                  >
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line bg-raised px-4 py-2.5 text-[11px] leading-relaxed text-ink-500">
          {t('keys.note')}
        </p>
      </div>
    </div>
  );
}
