import { describe, it, expect } from 'vitest';
import { resolveBoundaryResize } from './useMachineBoardController';
import type { Job } from '../../scheduling/SchedulingContext';

/** Routed order: op1 4h → op2 6h → op3 2h (total 12h). */
function routedJob(): Job {
  return {
    id: 1,
    machine: 'Pila → CNC-1 → Bušilica',
    order: 'TEST-A',
    operator: '',
    start: '2026-07-20T06:00',
    end: '2026-07-20T18:00',
    status: 'planned',
    progress: 0,
    color: '#000',
    operations: [
      { id: 1, name: 'Piljenje', machine: 'Pila', hours: 4 },
      { id: 2, name: 'Glodanje', machine: 'CNC-1', hours: 6 },
      { id: 3, name: 'Bušenje', machine: 'Bušilica', hours: 2 },
    ],
  };
}

const totalHours = (ops: NonNullable<Job['operations']>) => ops.reduce((sum, op) => sum + op.hours, 0);

describe('resolveBoundaryResize — dragging a later operation\'s left edge', () => {
  it('moves the boundary right: the previous op takes the hours this one gives up', () => {
    const result = resolveBoundaryResize(routedJob(), 1, +1)!;
    expect(result.appliedHours).toBe(1);
    expect(result.previousHours).toBe(5); // op1 4h -> 5h
    expect(result.currentHours).toBe(5); // op2 6h -> 5h
    expect(totalHours(result.operations)).toBe(12); // order length unchanged
  });

  it('moves the boundary left: the previous op gives the hours back', () => {
    const result = resolveBoundaryResize(routedJob(), 1, -1.5)!;
    expect(result.appliedHours).toBe(-1.5);
    expect(result.previousHours).toBe(2.5); // op1 4h -> 2.5h
    expect(result.currentHours).toBe(7.5); // op2 6h -> 7.5h
    expect(totalHours(result.operations)).toBe(12);
  });

  it('leaves every other operation untouched', () => {
    const result = resolveBoundaryResize(routedJob(), 1, +2)!;
    expect(result.operations[2]).toEqual({ id: 3, name: 'Bušenje', machine: 'Bušilica', hours: 2 });
  });

  it('is bounded by the previous op when dragging left (it cannot be starved)', () => {
    // op1 is 4h, so the furthest left is -(4 - 0.25) = -3.75h.
    const result = resolveBoundaryResize(routedJob(), 1, -99)!;
    expect(result.appliedHours).toBe(-3.75);
    expect(result.previousHours).toBe(0.25);
    expect(result.currentHours).toBe(9.75);
    expect(totalHours(result.operations)).toBe(12);
  });

  it('is bounded by this op when dragging right (it cannot be starved)', () => {
    // op2 is 6h, so the furthest right is 6 - 0.25 = 5.75h.
    const result = resolveBoundaryResize(routedJob(), 1, +99)!;
    expect(result.appliedHours).toBe(5.75);
    expect(result.previousHours).toBe(9.75);
    expect(result.currentHours).toBe(0.25);
    expect(totalHours(result.operations)).toBe(12);
  });

  it('snaps to 0.25 h steps', () => {
    expect(resolveBoundaryResize(routedJob(), 1, 0.8)!.appliedHours).toBe(0.75);
    expect(resolveBoundaryResize(routedJob(), 1, -0.3)!.appliedHours).toBe(-0.25);
  });

  it('returns null when the drag resolves to no change or has no previous op', () => {
    expect(resolveBoundaryResize(routedJob(), 1, 0.05)).toBeNull(); // snaps to 0
    expect(resolveBoundaryResize(routedJob(), 0, 1)).toBeNull(); // first op has no predecessor
    expect(resolveBoundaryResize({ ...routedJob(), operations: [] }, 1, 1)).toBeNull();
  });
});
