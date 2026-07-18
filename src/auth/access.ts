import type { AppTab } from '../settings/SettingsContext';

/**
 * Role-based module access. Single source of truth shared by the App shell's navigation guard and
 * any page that offers a cross-module action (e.g. "Uredi" on Praćenje napretka deep-links into the
 * work order creator, which the plain `workers` role cannot open).
 */
export function canAccessTab(role: string, tab: AppTab): boolean {
  if (role === 'admin' || role === 'boss') return true;
  if (role === 'managers' || role === 'level between admin and managers') return tab !== 'admin';
  return ['dashboard', 'machines', 'progress', 'gantt'].includes(tab);
}
