// Toast notifications: a provider that shows short messages, and a hook to trigger them. Styled after the reference app's
// toasts: top-right stack; 90% white frosted card (12px radius, soft shadow) with a 4px coloured left edge; a 32px tinted
// icon tile; a bold 14px title, a 13px grey detail line, a close button, and a thin countdown bar.
'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

// Message kinds.
type Tone = 'success' | 'error' | 'warning' | 'info';

// One visible notification.
interface Notice {
  id: number;
  tone: Tone;
  message: string;
}

// Function components call to show a message.
type Notify = (message: string, tone?: Tone) => void;

// Context holding the notify function.
const NotifyContext = createContext<Notify>(() => undefined);

// How long a notification stays on screen (the reference shows toasts for 5 seconds).
const DISPLAY_MS = 5000;

// Title, icon, and colours per tone (reference: emerald #10b981, red #ef4444, amber #f59e0b, blue #3b82f6).
const TONES: Record<Tone, { title: string; icon: IconName; edge: string; tile: string; bar: string }> = {
  success: { title: 'Success', icon: 'checkCircle', edge: 'border-l-emerald-500', tile: 'bg-emerald-50 text-emerald-500', bar: 'bg-emerald-500' },
  error: { title: 'Error', icon: 'error', edge: 'border-l-red-500', tile: 'bg-red-50 text-red-500', bar: 'bg-red-500' },
  warning: { title: 'Warning', icon: 'alertTriangle', edge: 'border-l-amber-500', tile: 'bg-amber-50 text-amber-500', bar: 'bg-amber-500' },
  info: { title: 'Information', icon: 'info', edge: 'border-l-blue-500', tile: 'bg-blue-50 text-blue-500', bar: 'bg-blue-500' },
};

// Provides notifications to its children and renders them in a screen-reader-friendly live region.
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);

  // Removes one notification.
  const dismiss = useCallback((id: number) => setNotices((current) => current.filter((notice) => notice.id !== id)), []);

  // Adds a notification and removes it automatically after a few seconds.
  const notify = useCallback<Notify>(
    (message, tone = 'success') => {
      const id = Date.now() + Math.random();
      setNotices((current) => [...current, { id, tone, message }]);
      setTimeout(() => dismiss(id), DISPLAY_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);
  return (
    <NotifyContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-3 sm:right-6 sm:top-6">
        {notices.map((notice) => {
          const tone = TONES[notice.tone];
          return (
            <div
              key={notice.id}
              role="status"
              className={`toast-in pointer-events-auto relative flex w-[calc(100vw-2rem)] max-w-[450px] items-start gap-4 overflow-hidden rounded-xl border border-l-4 border-white/20 bg-white/90 px-5 py-4 shadow-[0_10px_15px_-3px_#0000001a,0_4px_6px_-2px_#0000000d] backdrop-blur-[10px] sm:min-w-[320px] sm:w-auto ${tone.edge}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.tile}`}>
                <Icon name={tone.icon} className="h-5 w-5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="m-0 text-sm font-bold text-[#1a1a1a]">{tone.title}</p>
                <p className="m-0 text-[13px] leading-[1.4] text-gray-600">{notice.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(notice.id)}
                aria-label="Dismiss notification"
                className="flex items-center justify-center rounded-md p-1 text-gray-400 transition-colors hover:bg-black/5 hover:text-[#1a1a1a]"
              >
                <Icon name="close" className="h-[18px] w-[18px]" />
              </button>
              <span aria-hidden="true" className={`toast-progress absolute bottom-0 left-0 h-[3px] w-full origin-left opacity-60 ${tone.bar}`} style={{ animationDuration: `${DISPLAY_MS}ms` }} />
            </div>
          );
        })}
      </div>
    </NotifyContext.Provider>
  );
}

// Returns the function that shows a notification.
export function useNotify(): Notify {
  return useContext(NotifyContext);
}
