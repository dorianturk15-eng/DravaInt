import { describe, expect, it } from 'vitest';
import { addWorkingTime, cascadeDependents, computeCriticalPath, computeEffectiveSchedule, computeScheduleSlack, findDependencyCycle, splitMachineChain, toLocalDateTimeString, type ScheduleInput } from './cpm';

const date = (hours: number) => `2026-07-13T${String(hours).padStart(2, '0')}:00`;

describe('splitMachineChain', () => {
  it('splits a routing chain the same way regardless of spacing around the arrow', () => {
    expect(splitMachineChain('Tokarilica-1 → CNC-2')).toEqual(['Tokarilica-1', 'CNC-2']);
    // Without spaces the old ' → ' split silently kept one phantom machine — now normalised.
    expect(splitMachineChain('Tokarilica-1→CNC-2')).toEqual(['Tokarilica-1', 'CNC-2']);
    expect(splitMachineChain('CNC-1')).toEqual(['CNC-1']);
    expect(splitMachineChain('')).toEqual([]);
    expect(splitMachineChain(undefined)).toEqual([]);
  });
});

describe('CPM scheduling', () => {
  it('applies all four dependency relationship types exactly', () => {
    const predecessor: ScheduleInput = { id: 1, start: date(6), end: date(10) };
    const cases = [
      { type: 'FS' as const, expected: 11 },
      { type: 'SS' as const, expected: 7 },
      { type: 'FF' as const, expected: 9 },
      { type: 'SF' as const, expected: 5 },
    ];
    cases.forEach(({ type, expected }) => {
      const jobs: ScheduleInput[] = [predecessor, { id: 2, start: date(0), end: date(2), dependencies: [{ jobId: 1, type, lagHours: 1 }] }];
      const result = computeEffectiveSchedule(jobs).get(2)!;
      expect(new Date(result.start).getHours()).toBe(expected);
    });
  });

  it('finds and reports the concrete dependency cycle', () => {
    const jobs: ScheduleInput[] = [
      { id: 1, start: date(6), end: date(7), dependencies: [{ jobId: 3, type: 'FS', lagHours: 0 }] },
      { id: 2, start: date(7), end: date(8), dependencies: [{ jobId: 1, type: 'FS', lagHours: 0 }] },
      { id: 3, start: date(8), end: date(9), dependencies: [{ jobId: 2, type: 'FS', lagHours: 0 }] },
    ];
    expect(findDependencyCycle(jobs)).toEqual([1, 3, 2, 1]);
  });

  it('computes critical nodes using generalized relationship weights', () => {
    const jobs: ScheduleInput[] = [
      { id: 1, start: date(6), end: date(8) },
      { id: 2, start: date(6), end: date(7) },
      { id: 3, start: date(8), end: date(10), dependencies: [{ jobId: 1, type: 'FS', lagHours: 0 }] },
    ];
    const effective = computeEffectiveSchedule(jobs);
    expect([...computeCriticalPath(jobs, effective, 1)]).toEqual(expect.arrayContaining([1, 3]));
    expect(computeCriticalPath(jobs, effective, 1).has(2)).toBe(false);
    expect(computeScheduleSlack(jobs, effective).get(2)).toBeGreaterThan(0);
  });

  it('skips weekends and holidays when adding work time', () => {
    const friday = new Date('2026-07-17T14:00:00').getTime();
    const result = new Date(addWorkingTime(friday, 4 * 3_600_000, { workdayStart: 6, workdayEnd: 16, holidays: ['2026-07-20'], skipWeekends: true }));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(21);
    expect(result.getHours()).toBe(8);
  });

  it('cascades a moved job forward through a chain of FS dependents, preserving each duration', () => {
    const jobs: ScheduleInput[] = [
      { id: 1, start: date(6), end: date(10) },
      { id: 2, start: date(10), end: date(12), dependencies: [{ jobId: 1, type: 'FS', lagHours: 0 }] },
      { id: 3, start: date(12), end: date(15), dependencies: [{ jobId: 2, type: 'FS', lagHours: 0 }] },
    ];
    const pending = cascadeDependents(1, date(6), date(14), jobs);
    expect(pending.get(2)).toEqual({ start: toLocalDateTimeString(new Date(date(14))), end: toLocalDateTimeString(new Date(date(16))) });
    expect(pending.get(3)).toEqual({ start: toLocalDateTimeString(new Date(date(16))), end: toLocalDateTimeString(new Date(date(19))) });
  });

  it('does not cascade a dependent whose own start already satisfies the new constraint', () => {
    const jobs: ScheduleInput[] = [
      { id: 1, start: date(6), end: date(8) },
      { id: 2, start: date(20), end: date(22), dependencies: [{ jobId: 1, type: 'FS', lagHours: 0 }] },
    ];
    const pending = cascadeDependents(1, date(6), date(8), jobs);
    expect(pending.has(2)).toBe(false);
  });
});
