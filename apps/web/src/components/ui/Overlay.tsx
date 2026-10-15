// Modal and Drawer: dialog semantics, focus trap, Escape to close, focus restored on close, page inert behind.
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { IconButton } from './Button';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

function useOverlay(
  open: boolean,
  onClose: () => void,
  dismissible: boolean,
  panelRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById('root');
    appRoot?.setAttribute('inert', '');
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    if (panel) {
      const target = initialFocusRef?.current ?? focusables(panel)[0] ?? panel;
      target.focus();
    }

    function onKeyDown(event: KeyboardEvent) {
      const current = panelRef.current;
      if (!current) return;
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = focusables(current);
      if (list.length === 0) {
        event.preventDefault();
        current.focus();
        return;
      }
      const first = list[0] as HTMLElement;
      const last = list[list.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      appRoot?.removeAttribute('inert');
      document.body.style.overflow = overflow;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, dismissible, panelRef, initialFocusRef]);
}

interface OverlayBase {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Escape key and backdrop click close the overlay (default true). Use false for forced decisions. */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

function OverlayFrame({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  initialFocusRef,
  placement,
  panelClass,
}: OverlayBase & { placement: string; panelClass: string }) {
  const { t } = useTranslation('common');
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay(open, onClose, dismissible, panelRef, initialFocusRef);
  if (!open) return null;
  return createPortal(
    <div
      className={cn('fixed inset-0 z-40 flex bg-scrim', placement)}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn('flex max-h-full flex-col bg-card shadow-overlay', panelClass)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-4">
          <div>
            <h2 id={titleId} className="text-xl font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-body">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? <IconButton icon={X} label={t('action.close')} onClick={onClose} /> : null}
        </div>
        <div className="overflow-auto p-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line p-4">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function Modal(props: OverlayBase) {
  return (
    <OverlayFrame
      {...props}
      placement="items-center justify-center p-4"
      panelClass="w-full max-w-lg rounded-lg"
    />
  );
}

export function Drawer({ side = 'right', ...props }: OverlayBase & { side?: 'left' | 'right' }) {
  return (
    <OverlayFrame
      {...props}
      placement={side === 'right' ? 'justify-end' : 'justify-start'}
      panelClass="h-full w-full max-w-sm"
    />
  );
}
