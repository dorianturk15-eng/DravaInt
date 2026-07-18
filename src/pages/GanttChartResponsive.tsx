import { lazy } from 'react';
import { useViewportTier } from '../components/gantt-mobile/useViewportTier';
import { GanttMobile } from '../components/gantt-mobile/GanttMobile';

// The desktop chart (and the DravaGantt renderer behind it) only loads on wide
// viewports; phones and tablets get the touch-first experience instead.
const GanttChartDesktop = lazy(() => import('./GanttChart'));

/**
 * Thin responsive switch for the Gantt tab (GANTT_ELEVATION_PLAN.md Phase 2). Keeps the desktop
 * renderer untouched so it can be swapped independently (Phase 1); the mobile experience talks
 * only to the shared scheduling data layer.
 */
export default function GanttChartResponsive() {
  const tier = useViewportTier();
  if (tier === 'desktop') return <GanttChartDesktop />;
  return <GanttMobile tier={tier} />;
}
