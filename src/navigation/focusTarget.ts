import type { AppTab } from '../settings/SettingsContext';

/**
 * Lightweight cross-page focus bus.
 *
 * Navigation in this app is tab/route state, not deep-linkable URLs, so "show job X on page Y" can't
 * be expressed as a link. This module is the tiny primitive that fills the gap: a caller anywhere
 * (NotificationCenter alert, Gantt bar, Progress row, Dashboard capacity row, Admin unmapped-machines
 * report) calls {@link requestFocus} with a one-shot target; the destination page consumes it on
 * mount via {@link consumeFocus} and scrolls to + pulses the referenced card (or falls back
 * gracefully when the job is gone / filtered out).
 *
 * The target is held both in a module-level variable (survives a same-session tab switch without a
 * storage round-trip) and in sessionStorage (survives a full reload — the destination page may be
 * lazy-loaded and mount a tick after the navigation). It is a *one-shot*: reading it clears it, so a
 * later unrelated mount of the same page doesn't re-pulse a stale card.
 */
export interface FocusTarget {
  tab: AppTab;
  /** The order/job to focus. */
  jobId?: number;
  /** A specific operation within a routed order (OperationStep.id) — the board pulses that op's slot. */
  opId?: number | null;
  /** A machine lane to focus/scope to (e.g. Dashboard capacity row → collapse other lanes). */
  machineName?: string;
  /** Epoch ms the request was made — lets a consumer ignore an unexpectedly ancient target. */
  ts: number;
}

/** Fired when a focus is requested, so the shell (App) can navigate to `detail.tab`. */
export const FOCUS_REQUEST_EVENT = 'dravaint:focus-request';

const STORAGE_KEY = 'dravaint-focus-target';
/** Ignore a persisted target older than this (a stale sessionStorage entry from a prior visit). */
const MAX_AGE_MS = 30_000;

let pending: FocusTarget | null = null;

function persist(target: FocusTarget | null) {
  try {
    if (target) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sessionStorage unavailable (private mode / SSR) — module var still works within the session. */
  }
}

function readPersisted(): FocusTarget | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FocusTarget;
    if (!parsed || typeof parsed.tab !== 'string' || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Request that `target.tab` focus a job/operation/machine. Stores the target and dispatches
 * {@link FOCUS_REQUEST_EVENT}; the shell listens and performs the actual route change. Safe to call
 * from any page.
 */
export function requestFocus(target: Omit<FocusTarget, 'ts'>): void {
  const full: FocusTarget = { ...target, ts: Date.now() };
  pending = full;
  persist(full);
  try {
    window.dispatchEvent(new CustomEvent<FocusTarget>(FOCUS_REQUEST_EVENT, { detail: full }));
  } catch {
    /* window unavailable — the consumer will still pick it up on mount. */
  }
}

/** Peek at the current target for `tab` without consuming it (null if none / not for this tab / stale). */
export function peekFocus(tab: AppTab): FocusTarget | null {
  const target = pending ?? readPersisted();
  if (!target) return null;
  if (target.tab !== tab) return null;
  if (Date.now() - target.ts > MAX_AGE_MS) return null;
  return target;
}

/** Read and clear the current target if it is for `tab` (and fresh). Returns null otherwise. */
export function consumeFocus(tab: AppTab): FocusTarget | null {
  const target = peekFocus(tab);
  if (!target) return null;
  pending = null;
  persist(null);
  return target;
}

/** Discard any pending target unconditionally (used when a consumer is unmounting). */
export function clearFocus(): void {
  pending = null;
  persist(null);
}
