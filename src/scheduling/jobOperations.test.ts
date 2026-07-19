import { describe, expect, it } from 'vitest';
import type { Job } from './SchedulingContext';
import type { Machine } from '../machines/MachinesContext';
import {
  buildJobOperationRows,
  jobOperationChecksum,
  expandJobEffectiveWindows,
  detectOperationOverlaps,
} from './jobOperations';

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
  { id: 2, name: 'CNC-2', type: 'mill', axis: 5 },
  { id: 6, name: 'Pila', type: 'saw', axis: null },
  { id: 7, name: 'Kontrola kvalitete', type: 'qc', axis: null },
];

describe('buildJobOperationRows (JSONB → job_operations mirror)', () => {
  it('maps each operation to a contiguous 0-based seq row, copying id/name/hours/operator verbatim', () => {
    const rows = buildJobOperationRows(job({
      id: 1,
      machine: 'Pila → CNC-1',
      operations: [
        { id: 11, name: 'Saw', machine: ' Pila ', machineId: 6, hours: 2, operator: 'Ivana K.', operatorId: 7 },
        { id: 12, name: 'Mill', machine: 'CNC-1', machineId: 1, hours: 3 },
      ],
    }));
    expect(rows).toEqual([
      { jobId: 1, seq: 0, name: 'Saw', machineId: 6, machineName: 'Pila', hours: 2, operatorId: 7, operatorName: 'Ivana K.' },
      { jobId: 1, seq: 1, name: 'Mill', machineId: 1, machineName: 'CNC-1', hours: 3, operatorId: null, operatorName: '' },
    ]);
  });

  it('emits no rows for a plain single-machine job (enforcement stays on the legacy string check)', () => {
    expect(buildJobOperationRows(job({ id: 2, machine: 'CNC-1', operations: undefined }))).toEqual([]);
  });

  it('keeps an empty-machine / zero-hour op as a row so row count equals JSONB length (checksum)', () => {
    const j = job({
      id: 3,
      operations: [
        { id: 1, name: 'Placeholder', machine: '', hours: 0 },
        { id: 2, name: 'Mill', machine: 'CNC-1', hours: 3 },
      ],
    });
    const rows = buildJobOperationRows(j);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ seq: 0, machineName: '', hours: 0 });
    expect(jobOperationChecksum(j)).toEqual({ jobId: 3, order: 'RN-3', jsonbLength: 2, rowCount: 2, ok: true });
  });

  it('never writes a negative hours value (clamped to 0, matching the table check hours >= 0)', () => {
    const rows = buildJobOperationRows(job({ id: 4, operations: [{ id: 1, name: 'x', machine: 'CNC-1', hours: -5 }] }));
    expect(rows[0].hours).toBe(0);
  });
});

describe('expandJobEffectiveWindows', () => {
  it('lays a routed job out sequentially from its start (op.hours each)', () => {
    const windows = expandJobEffectiveWindows([job({
      id: 1,
      start: '2026-07-14T06:00',
      operations: [
        { id: 1, name: 'Saw', machine: 'Pila', hours: 2 },
        { id: 2, name: 'Mill', machine: 'CNC-1', hours: 3 },
      ],
    })], MACHINES);
    expect(windows.map((w) => [w.machineName, new Date(w.startMs).toISOString(), new Date(w.endMs).toISOString()])).toEqual([
      ['Pila', '2026-07-14T04:00:00.000Z', '2026-07-14T06:00:00.000Z'],
      ['CNC-1', '2026-07-14T06:00:00.000Z', '2026-07-14T09:00:00.000Z'],
    ]);
  });

  it('gives a plain single-machine job one window over the whole job', () => {
    const windows = expandJobEffectiveWindows([job({ id: 2, machine: 'CNC-1', operations: undefined })], MACHINES);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ jobId: 2, isOperation: false, machineName: 'CNC-1' });
  });

  it('excludes legacy chain-string jobs (no operations) and done jobs and containers', () => {
    const jobs = [
      job({ id: 3, machine: 'Pila → CNC-1', operations: undefined }), // legacy chain, no ops
      job({ id: 4, machine: 'CNC-1', status: 'done' }),
      job({ id: 5, machine: '', operations: undefined }), // container-ish (has child below)
      job({ id: 6, parentId: 5, machine: 'CNC-1', operations: undefined }),
    ];
    const windows = expandJobEffectiveWindows(jobs, MACHINES);
    expect(windows.map((w) => w.jobId).sort()).toEqual([6]);
  });

  it('drops an empty-machine or zero-length op (cannot double-book) but keeps numbering of the rest', () => {
    const windows = expandJobEffectiveWindows([job({
      id: 7,
      operations: [
        { id: 1, name: 'skip', machine: '', hours: 2 },
        { id: 2, name: 'Mill', machine: 'CNC-1', hours: 3 },
      ],
    })], MACHINES);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ seq: 1, machineName: 'CNC-1' });
  });
});

describe('detectOperationOverlaps (warn-then-enforce mirror)', () => {
  it('flags two routed operations that collide on the same machine', () => {
    const jobs = [
      job({ id: 1, start: '2026-07-14T06:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', hours: 4 }] }),
      job({ id: 2, start: '2026-07-14T08:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', hours: 4 }] }),
    ];
    const overlaps = detectOperationOverlaps(jobs, MACHINES);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ jobId: 1, otherJobId: 2, machineName: 'CNC-1' });
  });

  it('does not flag sequential (touching-but-not-overlapping) operations', () => {
    const jobs = [
      job({ id: 1, start: '2026-07-14T06:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', hours: 2 }] }),
      job({ id: 2, start: '2026-07-14T08:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', hours: 2 }] }),
    ];
    expect(detectOperationOverlaps(jobs, MACHINES)).toHaveLength(0);
  });

  it('flags a routed operation overlapping a plain single-machine job (the gap Phase D closes)', () => {
    const jobs = [
      // Plain job holds CNC-2 for the afternoon.
      job({ id: 44, machine: 'CNC-2', start: '2026-07-15T14:00', end: '2026-07-15T18:00', operations: undefined }),
      // Routed order whose 2nd op lands on CNC-2 16:00–20:00.
      job({
        id: 33,
        machine: 'Tokarilica-1 → CNC-2',
        start: '2026-07-15T13:00',
        operations: [
          { id: 1, name: 'Turn', machine: 'Tokarilica-1', hours: 3 },
          { id: 2, name: 'Mill', machine: 'CNC-2', hours: 4 },
        ],
      }),
    ];
    const overlaps = detectOperationOverlaps(jobs, MACHINES);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].machineName).toBe('CNC-2');
  });

  it('does NOT flag plain-vs-plain overlaps (owned by the legacy string check, not double-reported)', () => {
    const jobs = [
      job({ id: 1, machine: 'CNC-1', start: '2026-07-14T06:00', end: '2026-07-14T10:00', operations: undefined }),
      job({ id: 2, machine: 'CNC-1', start: '2026-07-14T08:00', end: '2026-07-14T12:00', operations: undefined }),
    ];
    expect(detectOperationOverlaps(jobs, MACHINES)).toHaveLength(0);
  });

  it('resolves id-side and name-side to the same machine key (an id op clashes with a name-only op)', () => {
    // Job A's op carries machineId 1; job B stores only the name "CNC-1". Both resolve to id:1 (the
    // name still matches the current machine list), so they are recognised as the same machine.
    const jobs = [
      job({ id: 1, start: '2026-07-14T06:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', machineId: 1, hours: 4 }] }),
      job({ id: 2, start: '2026-07-14T08:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', hours: 4 }] }),
    ];
    expect(detectOperationOverlaps(jobs, MACHINES)).toHaveLength(1);
  });

  it('stays rename-safe when both ops carry the id: renaming CNC-1 does not hide the clash', () => {
    // Machine 1 renamed CNC-1 → "Glodalica-1". Both ops were backfilled with machineId 1, so they
    // still clash by id even though neither op's stored name matches the current machine name.
    const renamed: Machine[] = [{ id: 1, name: 'Glodalica-1', type: 'mill', axis: 3 }, MACHINES[2]];
    const jobs = [
      job({ id: 1, start: '2026-07-14T06:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', machineId: 1, hours: 4 }] }),
      job({ id: 2, start: '2026-07-14T08:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', machineId: 1, hours: 4 }] }),
    ];
    expect(detectOperationOverlaps(jobs, renamed)).toHaveLength(1);
  });

  it('does not flag operations on different machines that overlap in time', () => {
    const jobs = [
      job({ id: 1, start: '2026-07-14T06:00', operations: [{ id: 1, name: 'Saw', machine: 'Pila', hours: 4 }] }),
      job({ id: 2, start: '2026-07-14T06:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', hours: 4 }] }),
    ];
    expect(detectOperationOverlaps(jobs, MACHINES)).toHaveLength(0);
  });

  it('reports each unordered clash once (lower job id first)', () => {
    const jobs = [
      job({ id: 5, start: '2026-07-14T06:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', hours: 4 }] }),
      job({ id: 9, start: '2026-07-14T07:00', operations: [{ id: 1, name: 'Mill', machine: 'CNC-1', hours: 4 }] }),
    ];
    const overlaps = detectOperationOverlaps(jobs, MACHINES);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ jobId: 5, otherJobId: 9 });
  });
});
