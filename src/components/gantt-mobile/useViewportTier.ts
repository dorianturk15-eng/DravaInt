import { useEffect, useState } from 'react';

export type ViewportTier = 'phone' | 'tablet' | 'desktop';

/** Breakpoints from GANTT_ELEVATION_PLAN.md §3: phone < 700px, tablet 700–1100px, desktop > 1100px. */
export const PHONE_MAX_WIDTH = 700;
export const TABLET_MAX_WIDTH = 1100;

function resolveTier(width: number): ViewportTier {
  if (width < PHONE_MAX_WIDTH) return 'phone';
  if (width <= TABLET_MAX_WIDTH) return 'tablet';
  return 'desktop';
}

export function useViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(() => resolveTier(window.innerWidth));

  useEffect(() => {
    const phoneQuery = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH - 1}px)`);
    const tabletQuery = window.matchMedia(`(max-width: ${TABLET_MAX_WIDTH}px)`);
    const apply = () => setTier(resolveTier(window.innerWidth));
    apply();
    phoneQuery.addEventListener('change', apply);
    tabletQuery.addEventListener('change', apply);
    return () => {
      phoneQuery.removeEventListener('change', apply);
      tabletQuery.removeEventListener('change', apply);
    };
  }, []);

  return tier;
}
