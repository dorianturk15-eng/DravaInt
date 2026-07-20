import { describe, expect, it } from 'vitest';
import { dominantShift, isUniformWeek, nextShift, planRotation, seedShift } from './rotation';

const defs = [
  { id: 1, isActive: true },
  { id: 2, isActive: true },
  { id: 3, isActive: true },
];
const ids = [1, 2, 3];

const plan = (over: Partial<Parameters<typeof planRotation>[0]> = {}) => planRotation({
  workers: [{ id: 10 }, { id: 20 }, { id: 30 }],
  definitions: defs,
  weekCount: 3,
  previousWeekShift: () => null,
  ...over,
});

/** Flatten to workerId → shift per week for readable assertions. */
const shifts = (p: ReturnType<typeof planRotation>, workerId: number) =>
  p.weeks.map((w) => w.get(workerId));

describe('nextShift', () => {
  it('walks the cycle and wraps', () => {
    expect(nextShift(ids, 1)).toBe(2);
    expect(nextShift(ids, 3)).toBe(1);
  });

  it('starts at the first shift with no history', () => {
    expect(nextShift(ids, null)).toBe(1);
    expect(nextShift(ids, undefined)).toBe(1);
  });

  it('rejoins the cycle when the previous lane was retired', () => {
    expect(nextShift(ids, 99)).toBe(1);
  });
});

describe('planRotation', () => {
  it('rotates each worker one step per week', () => {
    expect(shifts(plan(), 10)).toEqual([1, 2, 3]);
  });

  it('fans a fresh roster across the shifts', () => {
    const p = plan();
    expect(p.weeks[0].get(10)).toBe(1);
    expect(p.weeks[0].get(20)).toBe(2);
    expect(p.weeks[0].get(30)).toBe(3);
  });

  it('anchors phase to the worker own previous week, not roster position', () => {
    const history = new Map([[10, 3], [20, 1], [30, 2]]);
    const p = plan({ previousWeekShift: (id) => history.get(id) ?? null });
    // Each worker steps on from where THEY were, regardless of array order.
    expect(p.weeks[0].get(10)).toBe(1);
    expect(p.weeks[0].get(20)).toBe(2);
    expect(p.weeks[0].get(30)).toBe(3);
  });

  it('is stable when a worker is removed from the roster', () => {
    // The regression the positional formula caused: dropping the FIRST worker
    // used to shift everyone after them onto a different shift.
    const history = new Map([[10, 3], [20, 1], [30, 2]]);
    const previousWeekShift = (id: number) => history.get(id) ?? null;
    const full = plan({ previousWeekShift });
    const shrunk = plan({ workers: [{ id: 20 }, { id: 30 }], previousWeekShift });
    expect(shrunk.weeks[0].get(20)).toBe(full.weeks[0].get(20));
    expect(shrunk.weeks[0].get(30)).toBe(full.weeks[0].get(30));
    expect(shrunk.weeks[2].get(30)).toBe(full.weeks[2].get(30));
  });

  it('is idempotent: regenerating from the same history gives the same weeks', () => {
    const previousWeekShift = () => 2;
    expect(plan({ previousWeekShift }).weeks.map((w) => [...w]))
      .toEqual(plan({ previousWeekShift }).weeks.map((w) => [...w]));
  });

  it('pins a fixed worker to their shift in every week', () => {
    const p = plan({ workers: [{ id: 10, fixedShiftDefinitionId: 1 }, { id: 20 }] });
    expect(shifts(p, 10)).toEqual([1, 1, 1]);
    expect(p.warnings).toEqual([]);
  });

  it('does not renumber rotating workers when a worker is pinned', () => {
    const rotatingOnly = plan({ workers: [{ id: 20 }, { id: 30 }] });
    const withPin = plan({
      workers: [{ id: 10, fixedShiftDefinitionId: 1 }, { id: 20 }, { id: 30 }],
    });
    expect(withPin.weeks[0].get(20)).toBe(rotatingOnly.weeks[0].get(20));
    expect(withPin.weeks[0].get(30)).toBe(rotatingOnly.weeks[0].get(30));
  });

  it('falls back to rotation and warns when the pinned shift is inactive', () => {
    const p = plan({
      definitions: [{ id: 1, isActive: true }, { id: 2, isActive: true }, { id: 3, isActive: false }],
      workers: [{ id: 10, fixedShiftDefinitionId: 3 }],
    });
    expect(p.warnings).toEqual([{ workerId: 10, reason: 'inactive-fixed-shift', shiftDefinitionId: 3 }]);
    // Rotating over the two remaining active lanes.
    expect(shifts(p, 10)).toEqual([1, 2, 1]);
  });

  it('rotates only over active definitions', () => {
    const p = plan({ definitions: [{ id: 1, isActive: true }, { id: 2, isActive: false }, { id: 3, isActive: true }] });
    expect(shifts(p, 10)).toEqual([1, 3, 1]);
  });

  it('throws when there are no active definitions', () => {
    expect(() => plan({ definitions: [{ id: 1, isActive: false }] })).toThrow(/No active shift/);
  });
});

describe('seedShift', () => {
  it('spreads by rotating index', () => {
    expect([0, 1, 2, 3].map((i) => seedShift(ids, i))).toEqual([1, 2, 3, 1]);
  });
});

describe('dominantShift', () => {
  const a = (workerId: number, shiftDefinitionId: number) => ({ workerId, shiftDefinitionId });

  it('returns the most common shift of the week', () => {
    expect(dominantShift([a(1, 2), a(1, 2), a(1, 2), a(1, 3), a(2, 1)], 1, ids)).toBe(2);
  });

  it('breaks ties toward the earlier definition', () => {
    expect(dominantShift([a(1, 3), a(1, 2)], 1, ids)).toBe(2);
  });

  it('returns null for a worker with no assignments', () => {
    expect(dominantShift([a(2, 1)], 1, ids)).toBeNull();
  });
});

describe('isUniformWeek', () => {
  const a = (workerId: number, shiftDefinitionId: number) => ({ workerId, shiftDefinitionId });

  it('is true when every day shares a shift', () => {
    expect(isUniformWeek([a(1, 2), a(1, 2), a(1, 2)], 1)).toBe(true);
  });

  it('is false when a day was overridden', () => {
    expect(isUniformWeek([a(1, 2), a(1, 3)], 1)).toBe(false);
  });

  it('treats an empty week as uniform', () => {
    expect(isUniformWeek([], 1)).toBe(true);
  });
});
