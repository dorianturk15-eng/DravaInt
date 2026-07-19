import { describe, it, expect } from 'vitest';
import { detectBoardConflicts, conflictingSlotKeys, conflictsBySlot } from './boardConflicts';
import type { OperationSlot } from './operationSlots';
import type { Job } from './SchedulingContext';

const H = 3_600_000;
const baseJob = (id: number, order: string, status: Job['status'] = 'planned'): Job => ({
  id, machine: '', order, operator: '', start: '', end: '', status, progress: 0, color: '#000',
});

function slot(partial: Partial<OperationSlot> & { key: string; jobId: number; startMs: number; endMs: number }): OperationSlot {
  return {
    key: partial.key,
    jobId: partial.jobId,
    opId: partial.opId ?? 1,
    opIndex: partial.opIndex ?? 0,
    isOperation: partial.isOperation ?? true,
    isChainSegment: partial.isChainSegment ?? false,
    isFirstSlot: partial.isFirstSlot ?? true,
    isLastSlot: partial.isLastSlot ?? true,
    slotCount: partial.slotCount ?? 1,
    name: partial.name,
    machine: partial.machine ?? 'Pila',
    machineId: partial.machineId ?? 6,
    startMs: partial.startMs,
    endMs: partial.endMs,
    hours: (partial.endMs - partial.startMs) / H,
    job: partial.job ?? baseJob(partial.jobId, `RN-${partial.jobId}`),
  };
}

describe('detectBoardConflicts', () => {
  it('reports two routed operations overlapping on the same machine (by id)', () => {
    const a = slot({ key: 'a', jobId: 1, machineId: 6, startMs: 0, endMs: 4 * H, name: 'Piljenje' });
    const b = slot({ key: 'b', jobId: 2, machineId: 6, startMs: 3 * H, endMs: 6 * H, name: 'Piljenje' });
    const conflicts = detectBoardConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].a.jobId).toBe(1);
    expect(conflicts[0].b.jobId).toBe(2);
    expect(conflicts[0].overlapStartMs).toBe(3 * H);
    expect(conflicts[0].overlapEndMs).toBe(4 * H);
  });

  it('does not report non-overlapping slots or different machines', () => {
    const a = slot({ key: 'a', jobId: 1, machineId: 6, startMs: 0, endMs: 4 * H });
    const b = slot({ key: 'b', jobId: 2, machineId: 6, startMs: 4 * H, endMs: 6 * H }); // touches, no overlap
    const c = slot({ key: 'c', jobId: 3, machineId: 7, startMs: 0, endMs: 4 * H }); // other machine
    expect(detectBoardConflicts([a, b, c])).toHaveLength(0);
  });

  it('excludes plain-vs-plain (both non-operation) — legacy check owns those', () => {
    const a = slot({ key: 'a', jobId: 1, isOperation: false, startMs: 0, endMs: 4 * H });
    const b = slot({ key: 'b', jobId: 2, isOperation: false, startMs: 2 * H, endMs: 6 * H });
    expect(detectBoardConflicts([a, b])).toHaveLength(0);
  });

  it('reports routed-vs-plain (at least one side is an operation)', () => {
    const a = slot({ key: 'a', jobId: 1, isOperation: true, startMs: 0, endMs: 4 * H });
    const b = slot({ key: 'b', jobId: 2, isOperation: false, opIndex: null, startMs: 2 * H, endMs: 6 * H });
    expect(detectBoardConflicts([a, b])).toHaveLength(1);
  });

  it('never conflicts a job with itself and ignores done jobs', () => {
    const a = slot({ key: 'a', jobId: 1, opIndex: 0, startMs: 0, endMs: 4 * H });
    const a2 = slot({ key: 'a2', jobId: 1, opIndex: 1, startMs: 2 * H, endMs: 6 * H });
    expect(detectBoardConflicts([a, a2])).toHaveLength(0);
    const done = slot({ key: 'd', jobId: 3, startMs: 0, endMs: 4 * H, job: baseJob(3, 'RN-3', 'done') });
    const live = slot({ key: 'l', jobId: 4, startMs: 1 * H, endMs: 5 * H });
    expect(detectBoardConflicts([done, live])).toHaveLength(0);
  });

  it('conflictingSlotKeys and conflictsBySlot map both sides', () => {
    const a = slot({ key: 'a', jobId: 1, startMs: 0, endMs: 4 * H });
    const b = slot({ key: 'b', jobId: 2, startMs: 3 * H, endMs: 6 * H });
    const conflicts = detectBoardConflicts([a, b]);
    expect(conflictingSlotKeys(conflicts)).toEqual(new Set(['a', 'b']));
    const bySlot = conflictsBySlot(conflicts);
    expect(bySlot.get('a')).toHaveLength(1);
    expect(bySlot.get('b')).toHaveLength(1);
  });
});
