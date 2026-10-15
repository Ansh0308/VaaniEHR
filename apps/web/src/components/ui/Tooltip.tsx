// Tooltip: shown on hover and keyboard focus, dismissed with Escape (WCAG 1.4.13: dismissible, hoverable,
// persistent). Never the only place where essential information lives; it supplements a visible label.
import {
  cloneElement,
  useEffect,
  useId,
  useState,
  type FocusEvent,
  type ReactElement,
} from 'react';

type TriggerProps = {
  'aria-describedby'?: string;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
};

export function Tooltip({
  content,
  children,
}: {
  content: string;
  children: ReactElement<TriggerProps>;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setVisible(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible]);

  const trigger = cloneElement(children, {
    'aria-describedby': id,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      children.props.onFocus?.(event);
      setVisible(true);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      children.props.onBlur?.(event);
      setVisible(false);
    },
  });

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {trigger}
      <span
        role="tooltip"
        id={id}
        hidden={!visible}
        className="absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-64 -translate-x-1/2 rounded-md bg-action px-3 py-2 text-sm text-on-action shadow-overlay"
      >
        {content}
      </span>
    </span>
  );
}
