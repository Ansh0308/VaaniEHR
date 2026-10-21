// Navigation by role, from the PRD page list (§4). Routes for pages that are not built yet open a placeholder.
import {
  ClipboardList,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Palette,
  Pill,
  ScrollText,
  Settings,
  ShieldAlert,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '../api/types';

export interface NavItem {
  to: string;
  /** i18n key in the "shell" namespace */
  labelKey: `shell:nav.items.${string}`;
  icon: LucideIcon;
  /** PRD page id (§4); undefined for the design-system page */
  pg?: string;
  roles: readonly Role[];
}

const ALL: readonly Role[] = ['doctor', 'staff', 'admin', 'researcher'];

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/doctor',
    labelKey: 'shell:nav.items.doctorDashboard',
    icon: LayoutDashboard,
    pg: 'PG-02',
    roles: ['doctor'],
  },
  {
    to: '/patients',
    labelKey: 'shell:nav.items.patients',
    icon: Users,
    pg: 'PG-03',
    roles: ['staff', 'admin'],
  },
  {
    to: '/visits',
    labelKey: 'shell:nav.items.visits',
    icon: Stethoscope,
    pg: 'PG-10',
    roles: ['doctor', 'admin', 'researcher'],
  },
  {
    to: '/admin/medicines',
    labelKey: 'shell:nav.items.medicines',
    icon: Pill,
    pg: 'PG-12',
    roles: ['admin'],
  },
  {
    to: '/admin/templates',
    labelKey: 'shell:nav.items.templates',
    icon: ClipboardList,
    pg: 'PG-13',
    roles: ['admin', 'doctor'],
  },
  {
    to: '/admin/pathways',
    labelKey: 'shell:nav.items.pathways',
    icon: GitBranch,
    pg: 'PG-14',
    roles: ['doctor', 'admin'],
  },
  {
    to: '/admin/safety',
    labelKey: 'shell:nav.items.safety',
    icon: ShieldAlert,
    pg: 'PG-15',
    roles: ['admin'],
  },
  {
    to: '/admin/audit',
    labelKey: 'shell:nav.items.audit',
    icon: ScrollText,
    pg: 'PG-16',
    roles: ['admin', 'researcher'],
  },
  {
    to: '/research/eval',
    labelKey: 'shell:nav.items.evaluation',
    icon: FlaskConical,
    pg: 'PG-17',
    roles: ['researcher', 'admin'],
  },
  {
    to: '/settings',
    labelKey: 'shell:nav.items.settings',
    icon: Settings,
    pg: 'PG-18',
    roles: ALL,
  },
  { to: '/design', labelKey: 'shell:nav.items.design', icon: Palette, roles: ALL },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
