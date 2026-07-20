import { useEffect, useState } from 'react';

/**
 * Reactive media query.
 *
 * Listens to BOTH the MediaQueryList `change` event and window `resize`. The
 * change event alone is the tidier signal, but it was observed not firing under
 * programmatic viewport resizing (devtools/CDP metric overrides), which left the
 * mobile drawer's open state stale across a breakpoint crossing. `resize` is a
 * cheap, universally reliable backstop, and the state setter bails when the
 * value is unchanged, so the extra events cost no renders.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const sync = () => setMatches(list.matches);
    sync();
    list.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      list.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, [query]);

  return matches;
}
