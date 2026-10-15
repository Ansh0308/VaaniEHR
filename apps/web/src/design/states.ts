// The five safety / provenance states (PRD F6 safety status, F3 heard facts, F4 AI-suggested wording).
// Colour is NEVER the only signal: each state has an icon and a text label (WCAG 1.4.1).
// Class strings are written out in full so Tailwind can see them.
import { Ban, CircleCheck, Ear, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react';

export type SafetyState = 'clear' | 'acknowledge' | 'blocked' | 'unconfirmed' | 'ai';

export interface StateStyle {
  Icon: LucideIcon;
  /** i18n key under the "common" namespace for the label ("Clear", "Blocked", ...) */
  labelKey: `state.${SafetyState}.label`;
  descKey: `state.${SafetyState}.desc`;
  /** tinted chip: text + background + outline */
  badge: string;
  /** panel (cards, banners): tinted background, text, left accent bar */
  panel: string;
  /** icon colour on the tinted background (non-text, 3:1) */
  icon: string;
}

export const STATE_STYLES: Record<SafetyState, StateStyle> = {
  clear: {
    Icon: CircleCheck,
    labelKey: 'state.clear.label',
    descKey: 'state.clear.desc',
    badge: 'bg-clear-bg text-clear-fg border border-clear-accent',
    panel: 'bg-clear-bg text-clear-fg border-l-4 border-clear-accent',
    icon: 'text-clear-accent',
  },
  acknowledge: {
    Icon: TriangleAlert,
    labelKey: 'state.acknowledge.label',
    descKey: 'state.acknowledge.desc',
    badge: 'bg-acknowledge-bg text-acknowledge-fg border border-acknowledge-accent',
    panel: 'bg-acknowledge-bg text-acknowledge-fg border-l-4 border-acknowledge-accent',
    icon: 'text-acknowledge-accent',
  },
  blocked: {
    Icon: Ban,
    labelKey: 'state.blocked.label',
    descKey: 'state.blocked.desc',
    badge: 'bg-blocked-bg text-blocked-fg border border-blocked-accent',
    panel: 'bg-blocked-bg text-blocked-fg border-l-4 border-blocked-accent',
    icon: 'text-blocked-accent',
  },
  unconfirmed: {
    Icon: Ear,
    labelKey: 'state.unconfirmed.label',
    descKey: 'state.unconfirmed.desc',
    // dashed outline: a shape cue that works without colour
    badge: 'bg-unconfirmed-bg text-unconfirmed-fg border border-dashed border-unconfirmed-accent',
    panel:
      'bg-unconfirmed-bg text-unconfirmed-fg border-l-4 border-dashed border-unconfirmed-accent',
    icon: 'text-unconfirmed-accent',
  },
  ai: {
    Icon: Sparkles,
    labelKey: 'state.ai.label',
    descKey: 'state.ai.desc',
    badge: 'bg-ai-bg text-ai-fg border border-ai-accent',
    panel: 'bg-ai-bg text-ai-fg border-l-4 border-ai-accent',
    icon: 'text-ai-accent',
  },
};

export const SAFETY_STATES = Object.keys(STATE_STYLES) as SafetyState[];
