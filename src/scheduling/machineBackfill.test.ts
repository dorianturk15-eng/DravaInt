import { describe, expect, it } from 'vitest';
import type { Job } from './SchedulingContext';
import type { Machine } from '../machines/MachinesContext';
import { planBackfill, applyBackfill } from './machineBackfill';
import { findUnmappedOperationMachines, buildMachineLookup } from './machineIdentity';

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

const MACHINES: Machine[] = [
  { id: 1, name: 'CNC-1', type: 'mill', axis: 3 },
  { id: 6, name: 'Pila', type: 'saw', axis: null },
  { id: 7, name: 'Kontrola kvalitete', type: 'qc', axis: null },
];

describe('planBackfill', () => {
  it('assigns machineId to routed ops by case-insensitive, trimmed name match', () => {
    const jobs = [job({
      id: 1,
      machine: 'Pila → CNC-1',
      operations: [
        { id: 1, name: 'Saw', machine: ' pila ', hours: 2 },
        { id: 2, name: 'Mill', machine: 'CNC-1', hours: 3 },
      ],
    })];
    const { opAssignments, unmatched } = planBackfill(jobs, MACHINES);
    expect(unmatched).toHaveLength(0);
    expect(opAssignments).toEqual([
      { jobId: 1, order: 'RN-1', opId: 1, opName: 'Saw', machineName: 'pila', machineId: 6 },
      { jobId: 1, order: 'RN-1', opId: 2, opName: 'Mill', machineName: 'CNC-1', machineId: 1 },
    ]);
  });

  it('never overwrites an operation that already has a machineId', () => {
    const jobs = [job({
      id: 2,
      operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', machineId: 99, hours: 3 }],
    })];
    const { opAssignments } = planBackfill(jobs, MACHINES);
    expect(opAssignments).toHaveLength(0);
  });

  it('reports operations whose machine name matches no current machine instead of guessing', () => {
    const jobs = [job({
      id: 3,
      operations: [
        { id: 1, name: 'Weld', machine: 'Robot-Weld-9', hours: 2 },
        { id: 2, name: 'Mill', machine: 'CNC-1', hours: 1 },
      ],
    })];
    const { opAssignments, unmatched } = planBackfill(jobs, MACHINES);
    expect(opAssignments).toHaveLength(1);
    expect(unmatched).toEqual([
      { jobId: 3, order: 'RN-3', opId: 1, opName: 'Weld', machineName: 'Robot-Weld-9' },
    ]);
  });

  it('backfills jobs.machine_id for a plain single-machine job', () => {
    const jobs = [job({ id: 4, machine: 'CNC-1', operations: undefined })];
    const { plainJobAssignments } = planBackfill(jobs, MACHINES);
    expect(plainJobAssignments).toEqual([{ jobId: 4, order: 'RN-4', machineName: 'CNC-1', machineId: 1 }]);
  });

  it('does not assign a single machine_id to a legacy chain-string job; reports unmatched segments', () => {
    const jobs = [job({ id: 5, machine: 'Pila → Robot-Weld-9', operations: undefined })];
    const { plainJobAssignments, unmatched } = planBackfill(jobs, MACHINES);
    expect(plainJobAssignments).toHaveLength(0);
    expect(unmatched).toEqual([{ jobId: 5, order: 'RN-5', opId: null, machineName: 'Robot-Weld-9' }]);
  });

  it('applying the plan produces rows the matching logic then treats as fully mapped', () => {
    const jobs = [job({
      id: 6,
      operations: [
        { id: 1, name: 'Saw', machine: 'Pila', hours: 2 },
        { id: 2, name: 'Mill', machine: 'CNC-1', hours: 3 },
      ],
    })];
    const lookup = buildMachineLookup(MACHINES);
    expect(findUnmappedOperationMachines(jobs, lookup)).toHaveLength(0); // names match already
    const applied = applyBackfill(jobs, planBackfill(jobs, MACHINES));
    expect(applied[0].operations?.map((op) => op.machineId)).toEqual([6, 1]);
    // Post-backfill, a subsequent rename still resolves via id: swap CNC-1 → "Glodalica-1".
    const renamed: Machine[] = [{ id: 1, name: 'Glodalica-1', type: 'mill', axis: 3 }, MACHINES[1]];
    expect(findUnmappedOperationMachines(applied, buildMachineLookup(renamed))).toHaveLength(0);
  });
});
