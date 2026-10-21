import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

const DISMISS_KEY = 'routewise.install-dismissed.v1';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Add to home screen" invitation.
 *
 * Browsers only fire `beforeinstallprompt` when the app is installable and not
 * already installed, so this stays invisible everywhere else. Dismissing it is
 * remembered locally; nothing is sent to a server.
 */
export function InstallBanner() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!prompt || dismissed) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Storage is optional; hiding for this session is enough.
    }
  };

  return (
    <div className="flex animate-fade-up items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-card">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-signal-100 text-signal-700">
        <Icon name="zap" size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink-900">{t('install.title')}</p>
        <p className="truncate text-[11px] text-ink-500">{t('install.hint')}</p>
      </div>
      <button
        type="button"
        className="btn-primary btn-sm shrink-0"
        onClick={async () => {
          await prompt.prompt();
          const choice = await prompt.userChoice;
          if (choice.outcome !== 'accepted') close();
          else close();
        }}
      >
        {t('install.action')}
      </button>
      <button type="button" className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100" onClick={close} aria-label={t('common.dismiss')}>
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
