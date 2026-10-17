// Editable combobox with list autocomplete (WAI-ARIA Authoring Practices 1.2).
// Focus stays in the input; the highlighted option is exposed with aria-activedescendant.
// Keys: ArrowDown/ArrowUp open and move, Enter selects, Escape closes (then clears), Home/End in the list.
import { ChevronDown } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';

export interface ComboboxOption {
  id: string;
  label: string;
  /** Lighter second text, e.g. a brand name or strength. */
  secondary?: string;
  /** Small trailing text, e.g. a source tag. */
  meta?: string;
  /** A lighter second line, e.g. a brand name. */
  tertiary?: string;
  /** A small third line, e.g. a review note or a source. */
  note?: string;
  /** What the input shows once this option is chosen (default: the label). */
  inputText?: string;
}

export interface ComboboxProps {
  label: string;
  options: ComboboxOption[];
  value: ComboboxOption | null;
  onChange: (option: ComboboxOption | null) => void;
  hint?: string;
  placeholder?: string;
  /** Text shown when nothing matches. */
  emptyText: string;
  /** Minimum characters before the list opens (default 1). */
  minChars?: number;
  maxVisible?: number;
  /**
   * true (default): the component filters `options` by what was typed.
   * false: the options are the answer to the typed text (a search the parent runs), shown as they are.
   */
  filter?: boolean;
  /** Called with the typed text on every change (and with '' when it is cleared). */
  onQueryChange?: (query: string) => void;
  /** The parent is still looking: show `busyText` instead of "no results". */
  busy?: boolean;
  busyText?: string;
  /** Lets a form's error summary link to the input. */
  inputId?: string;
  error?: string;
}

function matches(option: ComboboxOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return `${option.label} ${option.secondary ?? ''}`.toLowerCase().includes(q);
}

export function Combobox({
  label,
  options,
  value,
  onChange,
  hint,
  placeholder,
  emptyText,
  minChars = 1,
  maxVisible = 8,
  filter = true,
  onQueryChange,
  busy = false,
  busyText,
  inputId,
  error,
}: ComboboxProps) {
  const { t } = useTranslation('common');
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(value ? (value.inputText ?? value.label) : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const visible = useMemo(
    () => (filter ? options.filter((o) => matches(o, query)) : options).slice(0, maxVisible),
    [options, query, maxVisible, filter],
  );
  const canOpen = query.trim().length >= minChars;
  const expanded = open && canOpen;
  const activeOption = visible[active];

  function choose(option: ComboboxOption) {
    onChange(option);
    setQuery(option.inputText ?? option.label);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!expanded) {
          setOpen(true);
          setActive(0);
        } else {
          setActive((i) => Math.min(i + 1, visible.length - 1));
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (expanded) setActive((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        if (expanded) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (expanded) {
          event.preventDefault();
          setActive(Math.max(visible.length - 1, 0));
        }
        break;
      case 'Enter':
        if (expanded && activeOption) {
          event.preventDefault();
          choose(activeOption);
        }
        break;
      case 'Escape':
        if (expanded) {
          event.preventDefault();
          setOpen(false);
        } else if (query !== '') {
          event.preventDefault();
          setQuery('');
          onQueryChange?.('');
          onChange(null);
        }
        break;
      default:
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          type="text"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={
            expanded && activeOption ? `${id}-opt-${activeOption.id}` : undefined
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
          }
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onQueryChange?.(event.target.value);
            setOpen(true);
            setActive(0);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="block min-h-11 w-full rounded-md border border-control bg-card py-2 pr-10 pl-3 text-base text-ink placeholder:text-muted"
        />
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-ink"
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-body">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-semibold text-blocked-fg">
          {error}
        </p>
      ) : null}
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!expanded || visible.length === 0}
        className="absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-auto rounded-md border border-control bg-card py-1 shadow-overlay"
      >
        {expanded
          ? visible.map((option, index) => (
              <li
                key={option.id}
                id={`${id}-opt-${option.id}`}
                role="option"
                aria-selected={index === active}
                // mouse: pick without stealing focus from the input (blur would close the list first)
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-base text-ink',
                  index === active ? 'bg-selected font-semibold' : 'bg-card',
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span>
                    {option.label}
                    {option.secondary ? (
                      <span className="ml-2 font-normal text-body">{option.secondary}</span>
                    ) : null}
                  </span>
                  {option.tertiary ? (
                    <span className="text-sm font-normal text-body">{option.tertiary}</span>
                  ) : null}
                  {option.note ? (
                    <span className="text-xs font-normal text-body">{option.note}</span>
                  ) : null}
                </span>
                {option.meta ? <span className="text-xs text-body">{option.meta}</span> : null}
              </li>
            ))
          : null}
      </ul>
      {expanded && visible.length === 0 ? (
        <div className="absolute top-full right-0 left-0 z-20 mt-1 rounded-md border border-control bg-card px-3 py-2 text-sm text-body shadow-overlay">
          {busy && busyText ? busyText : emptyText}
        </div>
      ) : null}
      {/* polite live region: the number of results, announced as the user types */}
      <p className="sr-only" role="status">
        {expanded
          ? visible.length === 0
            ? busy && busyText
              ? busyText
              : emptyText
            : t('status.results', { count: visible.length })
          : ''}
      </p>
    </div>
  );
}
