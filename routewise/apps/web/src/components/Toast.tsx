import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Tone = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  toast: (input: { title: string; description?: string; tone?: Tone; action?: ToastMessage['action'] }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<Tone, IconName> = {
  success: 'check',
  error: 'alert',
  info: 'info',
};

const TONE_CLASS: Record<Tone, string> = {
  success: 'border-[rgb(var(--ok-fg)/0.25)] text-[rgb(var(--ok-fg))]',
  error: 'border-[rgb(var(--danger-fg)/0.3)] text-[rgb(var(--danger-fg))]',
  info: 'border-[rgb(var(--info-fg)/0.25)] text-[rgb(var(--info-fg))]',
};

const ICON_CLASS: Record<Tone, string> = {
  success: 'bg-[rgb(var(--ok-bg))] text-[rgb(var(--ok-fg))]',
  error: 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-fg))]',
  info: 'bg-[rgb(var(--info-bg))] text-[rgb(var(--info-fg))]',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const counter = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback<ToastApi['toast']>(
    ({ title, description, tone = 'info', action }) => {
      const id = ++counter.current;
      setMessages((current) => [...current.slice(-2), { id, title, description, tone, action }]);
      const timer = window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end sm:px-0"
        role="region"
        aria-label="Notifications"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className="rw-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-lift"
            role={message.tone === 'error' ? 'alert' : 'status'}
          >
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ICON_CLASS[message.tone]}`}>
              <Icon name={TONE_ICON[message.tone]} size={16} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${TONE_CLASS[message.tone]}`}>{message.title}</p>
              {message.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{message.description}</p>
              ) : null}
              {message.action ? (
                <button
                  type="button"
                  className="mt-1.5 text-xs font-semibold text-signal-700 underline underline-offset-2"
                  onClick={() => {
                    message.action?.onClick();
                    dismiss(message.id);
                  }}
                >
                  {message.action.label}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              onClick={() => dismiss(message.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
