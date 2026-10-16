// Toasts: a polite live region that always exists, so screen readers announce each addition.
// "blocked" toasts use role="alert". Safety-related toasts stay until dismissed; only neutral/clear auto-dismiss.
import { Info, X } from 'lucide-react';
import { motion } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { STATE_STYLES, type SafetyState } from '../../design/states';
import { cn } from './cn';
import { IconButton } from './Button';

export type ToastKind = 'neutral' | Exclude<SafetyState, 'unconfirmed'>;

export interface ToastInput {
  kind?: ToastKind;
  title: string;
  message?: string;
  /** Auto-dismiss after this many ms (default 6000 for neutral/clear; none for acknowledge/blocked/ai). */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  kind: ToastKind;
}

interface ToastApi {
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

const MAX_TOASTS = 3;

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { t } = useTranslation('common');
  const [paused, setPaused] = useState(false);
  const auto =
    toast.durationMs ?? (toast.kind === 'neutral' || toast.kind === 'clear' ? 6000 : undefined);

  useEffect(() => {
    if (auto === undefined || paused) return;
    const timer = window.setTimeout(onDismiss, auto);
    return () => window.clearTimeout(timer);
  }, [auto, paused, onDismiss]);

  const style = toast.kind === 'neutral' ? null : STATE_STYLES[toast.kind];
  const Icon = style ? style.Icon : Info;
  return (
    <motion.div
      role={toast.kind === 'blocked' ? 'alert' : undefined}
      initial={{ opacity: 0, x: 32, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className={cn(
        'flex items-start gap-3 rounded-md p-3 shadow-card',
        style ? style.panel : 'border border-control bg-card text-ink',
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 size-5 shrink-0', style ? style.icon : 'text-ink')}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.message ? <p className="mt-0.5 text-sm">{toast.message}</p> : null}
      </div>
      <IconButton icon={X} label={t('action.dismiss')} onClick={onDismiss} className="-m-1" />
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((item) => item.id !== id)),
    [],
  );
  const push = useCallback((input: ToastInput) => {
    counter.current += 1;
    const item: ToastItem = { ...input, kind: input.kind ?? 'neutral', id: counter.current };
    setToasts((list) => [...list, item].slice(-MAX_TOASTS));
    return item.id;
  }, []);
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          role="region"
          aria-label={t('toast.region')}
          aria-live="polite"
          aria-relevant="additions"
          className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        >
          {toasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto">
              <ToastView toast={toast} onDismiss={() => dismiss(toast.id)} />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
