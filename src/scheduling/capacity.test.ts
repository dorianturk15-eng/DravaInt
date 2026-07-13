import { describe, expect, it } from 'vitest';
import type { Job } from './SchedulingContext';
import { calculateMachineLoads } from './capacity';
import type { EffectiveSchedule } from './cpm';

function job(patch: Partial<Job>): Job {
  return { id: 1, machine: '', order: 'RN-1', operator: '', start: '2026-07-13T06:00', end: '2026-07-13T14:00', status: 'planned', progress: 0, color: '#2563eb', ...patch };
}

describe('machine capacity', () => {
  it('uses explicit operation hours when a route is available', () => {
    const loads = calculateMachineLoads([job({ operations: [{ id: 1, name: 'Cut', machine: 'CNC-1', hours: 2 }, { id: 2, name: 'Mill', machine: 'CNC-2', hours: 5 }] })]);
    expect(loads.get('CNC-1')).toBe(2);
    expect(loads.get('CNC-2')).toBe(5);
  });

  it('distributes scheduled time across a route without operation detail', () => {
    const loads = calculateMachineLoads([job({ machine: 'Pila → CNC-1', start: '2026-07-13T06:00', end: '2026-07-13T14:00' })]);
    expect(loads.get('Pila')).toBe(4);
    expect(loads.get('CNC-1')).toBe(4);
  });

  it('prefers a supplied CPM-effective schedule over the raw persisted start/end', () => {
    const theJob = job({ machine: 'CNC-1', start: '2026-07-13T06:00', end: '2026-07-13T14:00' });
    const effective = new Map<number, EffectiveSchedule>([
      [theJob.id, { start: new Date('2026-07-13T06:00').getTime(), end: new Date('2026-07-13T22:00').getTime() }],
    ]);
    expect(calculateMachineLoads([theJob]).get('CNC-1')).toBe(8);
    expect(calculateMachineLoads([theJob], effective).get('CNC-1')).toBe(16);
  });
});
