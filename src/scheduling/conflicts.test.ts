import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from './SchedulingContext';
import { getJobConflicts } from './cpm';

function job(patch: Partial<Job>): Job {
  return { id: 1, machine: '', order: 'RN-1', operator: '', start: '2026-07-15T06:00', end: '2026-07-15T14:00', status: 'planned', progress: 0, color: '#000', ...patch };
}

const WORKERS = [
  { id: 1, firstName: 'Goran', lastName: 'Ć.', roleName: 'workers', status: 'available', qualifications: ['CNC-1', 'CNC-2'] },
  { id: 2, firstName: 'Alen', lastName: 'M.', roleName: 'workers', status: 'available', qualifications: ['CNC-2'] },
  { id: 3, firstName: 'Damir', lastName: 'M.', roleName: 'workers', status: 'available', qualifications: ['Tokarilica-1'] },
  { id: 8, firstName: 'Tomislav', lastName: 'P.', roleName: 'workers', status: 'available', qualifications: [] },
  { id: 9, firstName: 'Nikola', lastName: 'V.', roleName: 'workers', status: 'absent', qualifications: ['Tokarilica-2'] },
  { id: 10, firstName: 'Marija', lastName: 'H.', roleName: 'workers', status: 'available', qualifications: ['Kontrola kvalitete'] },
];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('dravaint-workers-v2', JSON.stringify(WORKERS));
});
afterEach(() => localStorage.clear());

describe('getJobConflicts machine double-booking (bug 1)', () => {
  it('detects a plain machine overlapping one operation of a routing chain', () => {
    // Routing chain lays out Tokarilica-1 13:00-16:00, then CNC-2 16:00-20:00.
    const routing = job({ id: 33, order: 'RN-2026-030-A2', machine: 'Tokarilica-1 → CNC-2', operator: 'Podsklop A2', start: '2026-07-15T13:00', end: '2026-07-15T13:00',
      operations: [
        { id: 1, name: 'Tokarenje', machine: 'Tokarilica-1', hours: 3, operator: 'Damir M.' },
        { id: 2, name: 'Glodanje', machine: 'CNC-2', hours: 4, operator: 'Alen M.' },
      ] });
    const plain = job({ id: 44, order: 'RN-2026-053', machine: 'CNC-2', operator: 'Goran Ć.', start: '2026-07-15T14:00', end: '2026-07-15T18:00' });
    const conflicts = getJobConflicts(plain, [routing, plain]);
    expect(conflicts.machineOverlap?.otherOrder).toBe('RN-2026-030-A2');
  });

  it('does not flag a machine that only appears as a different link in the chain', () => {
    const routing = job({ id: 33, order: 'RN-A', machine: 'Tokarilica-1 → CNC-2', start: '2026-07-15T13:00', end: '2026-07-15T13:00',
      operations: [{ id: 1, name: 'T', machine: 'Tokarilica-1', hours: 3, operator: 'Damir M.' }, { id: 2, name: 'G', machine: 'CNC-2', hours: 4, operator: 'Alen M.' }] });
    const plain = job({ id: 44, order: 'RN-B', machine: 'CNC-1', operator: 'Goran Ć.', start: '2026-07-15T14:00', end: '2026-07-15T18:00' });
    expect(getJobConflicts(plain, [routing, plain]).machineOverlap).toBeUndefined();
  });
});

describe('getJobConflicts routing operator checks (bug 2, 3, 4)', () => {
  it('runs qualification checks per operation for a routing order', () => {
    // Damir (Tokarilica-1 only) assigned to a CNC-2 operation -> unqualified.
    const routing = job({ id: 33, order: 'RN-A', machine: 'Tokarilica-1 → CNC-2', operator: 'Podsklop', start: '2026-07-15T13:00', end: '2026-07-15T13:00',
      operations: [{ id: 1, name: 'T', machine: 'Tokarilica-1', hours: 3, operator: 'Damir M.' }, { id: 2, name: 'G', machine: 'CNC-2', hours: 4, operator: 'Damir M.' }] });
    expect(getJobConflicts(routing, [routing]).unqualified?.message).toContain('CNC-2');
  });

  it('recognises a QC worker qualified as "Kontrola kvalitete" (bug 4)', () => {
    const routing = job({ id: 3, order: 'RN-QC', machine: 'Kontrola kvalitete', operator: 'Kalup', start: '2026-07-15T06:00', end: '2026-07-15T06:00',
      operations: [{ id: 1, name: 'Kontrola', machine: 'Kontrola kvalitete', hours: 1, operator: 'Marija H.' }] });
    expect(getJobConflicts(routing, [routing]).unqualified).toBeUndefined();
  });

  it('does not guess qualification from role when none are recorded (bug 3)', () => {
    const j = job({ id: 46, order: 'RN-App', machine: 'CNC-1', operator: 'Tomislav P.' });
    expect(getJobConflicts(j, [j]).unqualified).toBeUndefined();
  });
});

describe('getJobConflicts absence cross-check (bug 6)', () => {
  it('flags a job assigned to a worker whose live status is absent', () => {
    const j = job({ id: 41, order: 'RN-050', machine: 'Tokarilica-2', operator: 'Nikola V.' });
    expect(getJobConflicts(j, [j]).absent?.message).toContain('Nikola V.');
  });

  it('flags a routing operation assigned to an absent worker', () => {
    const routing = job({ id: 56, order: 'RN-070', machine: 'Pila → Tokarilica-2', operator: 'Poklopac', start: '2026-07-15T06:00', end: '2026-07-15T06:00',
      operations: [{ id: 1, name: 'Pila', machine: 'Pila', hours: 2, operator: 'Marija H.' }, { id: 2, name: 'Tok', machine: 'Tokarilica-2', hours: 5, operator: 'Nikola V.' }] });
    expect(getJobConflicts(routing, [routing]).absent?.message).toContain('Nikola V.');
  });

  it('flags a date-ranged absence record even when live status is available', () => {
    localStorage.setItem('dravaint-absences-v1', JSON.stringify([{ workerId: 3, startDate: '2026-07-14', endDate: '2026-07-16' }]));
    const j = job({ id: 1, order: 'RN-X', machine: 'Tokarilica-1', operator: 'Damir M.' });
    expect(getJobConflicts(j, [j]).absent?.message).toContain('Damir M.');
  });
});

describe('getJobConflicts shift fallback (bug 7)', () => {
  it('does not flag "outside shift schedule" when no schedule has been generated', () => {
    const j = job({ id: 1, order: 'RN-X', machine: 'CNC-1', operator: 'Goran Ć.' });
    expect(getJobConflicts(j, [j]).shiftOutside).toBeUndefined();
  });
});
