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
}: ComboboxProps) {
  const { t } = useTranslation('common');
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(value?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const visible = useMemo(
    () => options.filter((o) => matches(o, query)).slice(0, maxVisible),
    [options, query, maxVisible],
  );
  const canOpen = query.trim().length >= minChars;
  const expanded = open && canOpen;
  const activeOption = visible[active];

  function choose(option: ComboboxOption) {
    onChange(option);
    setQuery(option.label);
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
          aria-describedby={hint ? hintId : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
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
                <span>
                  {option.label}
                  {option.secondary ? (
                    <span className="ml-2 font-normal text-body">{option.secondary}</span>
                  ) : null}
                </span>
                {option.meta ? <span className="text-xs text-body">{option.meta}</span> : null}
              </li>
            ))
          : null}
      </ul>
      {expanded && visible.length === 0 ? (
        <div className="absolute top-full right-0 left-0 z-20 mt-1 rounded-md border border-control bg-card px-3 py-2 text-sm text-body shadow-overlay">
          {emptyText}
        </div>
      ) : null}
      {/* polite live region: the number of results, announced as the user types */}
      <p className="sr-only" role="status">
        {expanded
          ? visible.length === 0
            ? emptyText
            : t('status.results', { count: visible.length })
          : ''}
      </p>
    </div>
  );
}
