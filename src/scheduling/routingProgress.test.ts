import { describe, expect, it } from 'vitest';
import { routingStates } from './routingProgress';
import type { Job, OperationStep } from './SchedulingContext';

const op = (id: number, hours: number): OperationStep => ({ id, name: `Op ${id}`, machine: 'M', hours });

const job = (over: Partial<Pick<Job, 'status' | 'progress' | 'operations'>>) => ({
  status: 'inProgress' as const,
  progress: 0,
  operations: [op(1, 10), op(2, 10), op(3, 10), op(4, 10)],
  ...over,
});

describe('routingStates', () => {
  it('marks the first unfinished operation active, not always the second', () => {
    // The bug this replaces: index 1 was hardcoded active at every progress.
    expect(routingStates(job({ progress: 0 }))).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(routingStates(job({ progress: 60 }))).toEqual(['done', 'done', 'active', 'pending']);
    expect(routingStates(job({ progress: 95 }))).toEqual(['done', 'done', 'done', 'active']);
  });

  it('treats a completed order as fully done with no active node', () => {
    expect(routingStates(job({ status: 'done', progress: 100 }))).toEqual(['done', 'done', 'done', 'done']);
  });

  it('shows nothing active on an order that has not started', () => {
    expect(routingStates(job({ status: 'planned', progress: 0 })))
      .toEqual(['pending', 'pending', 'pending', 'pending']);
  });

  it('still advances on a delayed order', () => {
    expect(routingStates(job({ status: 'delayed', progress: 30 })))
      .toEqual(['done', 'active', 'pending', 'pending']);
  });

  it('weights by operation hours rather than step count', () => {
    // 50% of 100h lands inside the long second op, not at the halfway step.
    const uneven = [op(1, 10), op(2, 80), op(3, 10)];
    expect(routingStates(job({ operations: uneven, progress: 50 })))
      .toEqual(['done', 'active', 'pending']);
    expect(routingStates(job({ operations: uneven, progress: 95 })))
      .toEqual(['done', 'done', 'active']);
  });

  it('handles a single-operation route', () => {
    expect(routingStates(job({ operations: [op(1, 5)], progress: 40 }))).toEqual(['active']);
    expect(routingStates(job({ operations: [op(1, 5)], progress: 100 }))).toEqual(['done']);
  });

  it('falls back to equal weighting when every operation has zero hours', () => {
    const zero = [op(1, 0), op(2, 0), op(3, 0), op(4, 0)];
    expect(routingStates(job({ operations: zero, progress: 50 })))
      .toEqual(['done', 'done', 'active', 'pending']);
  });

  it('returns nothing for a route with no operations', () => {
    expect(routingStates(job({ operations: [] }))).toEqual([]);
    expect(routingStates(job({ operations: undefined }))).toEqual([]);
  });

  it('clamps out-of-range progress', () => {
    expect(routingStates(job({ progress: -20 }))).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(routingStates(job({ progress: 250 }))).toEqual(['done', 'done', 'done', 'done']);
  });
});
