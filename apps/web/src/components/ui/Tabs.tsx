// Tabs (WAI-ARIA tabs pattern, automatic activation): roving tabindex, Arrow/Home/End keys.
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem {
  id: string;
  label: string;
  panel: ReactNode;
}

export function Tabs({
  tabs,
  label,
  defaultId,
}: {
  tabs: TabItem[];
  /** Accessible name of the tab list. */
  label: string;
  defaultId?: string;
}) {
  const base = useId();
  const [current, setCurrent] = useState(defaultId ?? tabs[0]?.id);
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function focusTab(id: string | undefined) {
    if (!id) return;
    setCurrent(id);
    refs.current.get(id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === current);
    if (index === -1) return;
    const last = tabs.length - 1;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next: number | null = null;
    if (event.key === forward) next = index === last ? 0 : index + 1;
    else if (event.key === backward) next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next !== null) {
      event.preventDefault();
      focusTab(tabs[next]?.id);
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1 border-b border-line"
      >
        {tabs.map((tab) => {
          const selected = tab.id === current;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) refs.current.set(tab.id, el);
                else refs.current.delete(tab.id);
              }}
              role="tab"
              type="button"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setCurrent(tab.id)}
              className={cn(
                'min-h-11 rounded-t-md border-b-4 px-4 py-2 text-base font-semibold text-ink',
                selected ? 'border-ink bg-card' : 'border-transparent hover:bg-sunken',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== current}
          tabIndex={0}
          className="pt-4"
        >
          {tab.id === current ? tab.panel : null}
        </div>
      ))}
    </div>
  );
}
