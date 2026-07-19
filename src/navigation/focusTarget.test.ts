import { describe, it, expect, beforeEach } from 'vitest';
import { requestFocus, peekFocus, consumeFocus, clearFocus } from './focusTarget';

describe('focusTarget bus', () => {
  beforeEach(() => {
    clearFocus();
    try { sessionStorage.clear(); } catch { /* ignore */ }
  });

  it('stores a target and returns it for the matching tab', () => {
    requestFocus({ tab: 'machines', jobId: 42 });
    const target = peekFocus('machines');
    expect(target?.jobId).toBe(42);
    expect(target?.tab).toBe('machines');
  });

  it('does not return a target for a different tab', () => {
    requestFocus({ tab: 'gantt', jobId: 7 });
    expect(peekFocus('machines')).toBeNull();
    expect(peekFocus('gantt')?.jobId).toBe(7);
  });

  it('consumeFocus is one-shot — the second read is null', () => {
    requestFocus({ tab: 'machines', jobId: 1 });
    expect(consumeFocus('machines')?.jobId).toBe(1);
    expect(consumeFocus('machines')).toBeNull();
    expect(peekFocus('machines')).toBeNull();
  });

  it('reads a persisted target from sessionStorage when the module var is empty (reload)', () => {
    clearFocus();
    // Simulate a fresh page load: nothing in the module var, a fresh target only in sessionStorage.
    sessionStorage.setItem('dravaint-focus-target', JSON.stringify({ tab: 'machines', machineName: 'Pila', ts: Date.now() }));
    expect(peekFocus('machines')?.machineName).toBe('Pila');
  });

  it('ignores a stale target older than the max age', () => {
    clearFocus();
    sessionStorage.setItem('dravaint-focus-target', JSON.stringify({ tab: 'machines', jobId: 5, ts: Date.now() - 60_000 }));
    expect(peekFocus('machines')).toBeNull();
  });
});
