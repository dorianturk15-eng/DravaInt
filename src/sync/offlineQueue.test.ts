import { afterEach, describe, expect, it } from 'vitest';
import { isTransientError } from './offlineQueue';

/**
 * The offline-queue replay treats classification as the pivot: a transient (network) failure keeps
 * the item and retries the whole queue later; a permanent (DB) failure parks the item so it can't
 * head-of-line block the rest of the queue. Getting this wrong either loses edits or freezes sync.
 */
describe('isTransientError', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');

  function setOnline(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
  }

  afterEach(() => {
    if (originalOnLine) Object.defineProperty(window.navigator, 'onLine', originalOnLine);
  });

  it('treats a PostgREST/Postgres error (has a code) as permanent when online', () => {
    setOnline(true);
    expect(isTransientError({ code: '23505' })).toBe(false); // unique_violation
    expect(isTransientError({ code: 'DR001' })).toBe(false); // double-booking
    expect(isTransientError({ code: '42501' })).toBe(false); // RLS/permission denied
  });

  it('treats a codeless error (network/fetch failure) as transient', () => {
    setOnline(true);
    expect(isTransientError({})).toBe(true);
    expect(isTransientError(null)).toBe(true);
    expect(isTransientError(undefined)).toBe(true);
  });

  it('treats any error as transient while the browser reports offline', () => {
    setOnline(false);
    expect(isTransientError({ code: '23505' })).toBe(true);
  });
});
