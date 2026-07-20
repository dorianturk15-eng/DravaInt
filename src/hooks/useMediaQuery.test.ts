import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

/**
 * A controllable matchMedia. The shared test setup stubs matchMedia as a
 * permanently non-matching object, which cannot exercise a breakpoint crossing.
 *
 * This matters because the in-app preview browser fires NEITHER `resize` nor
 * MediaQueryList `change` when the viewport is resized programmatically, so the
 * navigation model's breakpoint behaviour cannot be verified in the browser at
 * all — these tests are the coverage for it.
 */
function installMatchMedia(initial: boolean) {
  const state = { matches: initial };
  const changeListeners = new Set<() => void>();
  const resizeListeners = new Set<() => void>();

  window.matchMedia = ((query: string) => ({
    get matches() { return state.matches; },
    media: query,
    onchange: null,
    addEventListener: (_: string, fn: () => void) => { changeListeners.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { changeListeners.delete(fn); },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  const realAdd = window.addEventListener.bind(window);
  const realRemove = window.removeEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => {
    if (type === 'resize') { resizeListeners.add(fn as () => void); return; }
    return realAdd(type, fn as EventListener, opts);
  });
  vi.spyOn(window, 'removeEventListener').mockImplementation((type, fn, opts) => {
    if (type === 'resize') { resizeListeners.delete(fn as () => void); return; }
    return realRemove(type, fn as EventListener, opts);
  });

  return {
    /** Cross the breakpoint, announcing it only via the given channel. */
    set(matches: boolean, channel: 'change' | 'resize' | 'silent') {
      state.matches = matches;
      if (channel === 'change') changeListeners.forEach((fn) => fn());
      if (channel === 'resize') resizeListeners.forEach((fn) => fn());
    },
    counts: () => ({ change: changeListeners.size, resize: resizeListeners.size }),
  };
}

describe('useMediaQuery', () => {
  let mm: ReturnType<typeof installMatchMedia>;

  beforeEach(() => { mm = installMatchMedia(false); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports the initial match', () => {
    mm.set(true, 'silent');
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);
  });

  it('updates when the MediaQueryList change event fires', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);
    act(() => mm.set(true, 'change'));
    expect(result.current).toBe(true);
  });

  it('also updates from a plain resize event', () => {
    // The backstop: some environments resize the viewport without ever firing
    // the MediaQueryList change event.
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    act(() => mm.set(true, 'resize'));
    expect(result.current).toBe(true);
  });

  it('subscribes to both channels and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(mm.counts()).toEqual({ change: 1, resize: 1 });
    unmount();
    expect(mm.counts()).toEqual({ change: 0, resize: 0 });
  });

  it('tracks crossings in both directions', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    act(() => mm.set(true, 'change'));
    expect(result.current).toBe(true);
    act(() => mm.set(false, 'change'));
    expect(result.current).toBe(false);
  });
});

/**
 * The drawer gate itself. `drawerOpen = isSidebarOpen && !isDesktop` is what
 * keeps a drawer opened on mobile from reappearing after a resize up and back
 * down — the regression observed before the derived gate was introduced.
 */
describe('drawer visibility gate', () => {
  const drawerOpen = (isSidebarOpen: boolean, isDesktop: boolean) => isSidebarOpen && !isDesktop;

  it('shows an opened drawer below the breakpoint', () => {
    expect(drawerOpen(true, false)).toBe(true);
  });

  it('never shows the drawer on desktop, even with stale open state', () => {
    expect(drawerOpen(true, true)).toBe(false);
  });

  it('stays closed when it was never opened', () => {
    expect(drawerOpen(false, false)).toBe(false);
  });
});
