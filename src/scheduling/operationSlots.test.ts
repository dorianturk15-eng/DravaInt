import { describe, expect, it } from 'vitest';
import type { Job } from './SchedulingContext';
import { expandToOperationSlots } from './operationSlots';
import { calculateMachineLoads } from './capacity';
import { computeEffectiveSchedule, jobsToScheduleInput, type EffectiveSchedule } from './cpm';

function job(patch: Partial<Job> & { id: number }): Job {
  return {
    machine: 'CNC-1',
    order: `RN-${patch.id}`,
    operator: '',
    start: '2026-07-14T06:00',
    end: '2026-07-14T14:00',
    status: 'planned',
    progress: 0,
    color: '#2563eb',
    ...patch,
  };
}

const NO_EFFECTIVE = new Map<number, EffectiveSchedule>();

describe('expandToOperationSlots', () => {
  it('emits one synthetic slot for a plain single-machine job', () => {
    const slots = expandToOperationSlots([job({ id: 1, machine: 'CNC-1' })], NO_EFFECTIVE);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ machine: 'CNC-1', opId: null, isOperation: false, isFirstSlot: true, isLastSlot: true });
    expect(slots[0].hours).toBeCloseTo(8);
  });

  it('emits one slot per operation for a routed order, sequential from the job start', () => {
    const slots = expandToOperationSlots([job({
      id: 2,
      machine: 'Pila → CNC-1',
      operations: [
        { id: 1, name: 'Saw', machine: 'Pila', hours: 2 },
        { id: 2, name: 'Mill', machine: 'CNC-1', hours: 3 },
      ],
    })], NO_EFFECTIVE);
    expect(slots.map((s) => s.machine)).toEqual(['Pila', 'CNC-1']);
    expect(slots[0]).toMatchObject({ isFirstSlot: true, isLastSlot: false, opId: 1, name: 'Saw' });
    expect(slots[1]).toMatchObject({ isFirstSlot: false, isLastSlot: true, opId: 2, name: 'Mill' });
    // Sequential: Saw 06–08, Mill 08–11.
    expect(new Date(slots[1].startMs).getHours()).toBe(8);
    expect(slots[1].endMs - slots[1].startMs).toBe(3 * 3_600_000);
  });

  it('splits a legacy chain-string job (no operations) into evenly-windowed segments', () => {
    const slots = expandToOperationSlots([job({ id: 3, machine: 'Pila → CNC-1', start: '2026-07-14T06:00', end: '2026-07-14T14:00' })], NO_EFFECTIVE);
    expect(slots.map((s) => s.machine)).toEqual(['Pila', 'CNC-1']);
    expect(slots[0].hours).toBeCloseTo(4);
    expect(slots[1].hours).toBeCloseTo(4);
    expect(slots[0].isChainSegment).toBe(true);
  });

  it('contributes no slots for container jobs (their leaves do)', () => {
    const jobs: Job[] = [
      job({ id: 10, machine: '', start: '2026-07-14T06:00', end: '2026-07-14T06:00' }),
      job({ id: 11, parentId: 10, machine: 'CNC-1' }),
    ];
    const slots = expandToOperationSlots(jobs, NO_EFFECTIVE);
    expect(slots.map((s) => s.jobId)).toEqual([11]);
  });

  it('drops slots whose machine is empty (they belong to no lane)', () => {
    const slots = expandToOperationSlots([job({ id: 12, machine: '  ' })], NO_EFFECTIVE);
    expect(slots).toHaveLength(0);
  });

  it('lays a routed order out from its dependency-cascaded (effective) start', () => {
    const jobs: Job[] = [
      job({ id: 20, machine: 'CNC-1', start: '2026-07-14T06:00', end: '2026-07-14T10:00' }),
      job({
        id: 21,
        machine: 'Pila',
        start: '2026-07-14T06:00',
        end: '2026-07-14T06:00',
        dependencies: [{ jobId: 20, type: 'FS', lagHours: 0 }],
        operations: [{ id: 1, name: 'Saw', machine: 'Pila', hours: 2 }],
      }),
    ];
    const effective = computeEffectiveSchedule(jobsToScheduleInput(jobs), { skipWeekends: false });
    const slots = expandToOperationSlots(jobs, effective);
    const routed = slots.find((s) => s.jobId === 21)!;
    // FS pushes op 21 to start when 20 finishes (10:00), not its own stored 06:00.
    expect(new Date(routed.startMs).getHours()).toBe(10);
  });

  it('lane totals match calculateMachineLoads (single derivation of per-machine hours)', () => {
    const jobs: Job[] = [
      job({ id: 30, machine: 'CNC-1', start: '2026-07-14T06:00', end: '2026-07-14T14:00' }),
      job({ id: 31, machine: 'Pila → CNC-1', operations: [
        { id: 1, name: 'Saw', machine: 'Pila', hours: 2 },
        { id: 2, name: 'Mill', machine: 'CNC-1', hours: 3 },
      ] }),
    ];
    const slots = expandToOperationSlots(jobs, NO_EFFECTIVE);
    const perMachine = new Map<string, number>();
    for (const slot of slots) perMachine.set(slot.machine, (perMachine.get(slot.machine) ?? 0) + (slot.endMs - slot.startMs) / 3_600_000);
    const loads = calculateMachineLoads(jobs);
    expect(perMachine.get('Pila')).toBeCloseTo(loads.get('Pila')!);
    expect(perMachine.get('CNC-1')).toBeCloseTo(loads.get('CNC-1')!); // 8 (synthetic) + 3 (op) = 11
    expect(perMachine.get('CNC-1')).toBeCloseTo(11);
  });
});
