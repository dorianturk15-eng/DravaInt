import { describe, expect, it } from 'vitest';
import { buildBoardLanes, classifyLinkCandidate } from './boardData';
import type { Job } from './SchedulingContext';

function job(partial: Partial<Job> & { id: number }): Job {
  return {
    machine: 'CNC-1',
    order: `RN-${partial.id}`,
    operator: '',
    start: '2026-07-14T06:00',
    end: '2026-07-14T14:00',
    status: 'planned',
    progress: 0,
    color: '#2563eb',
    ...partial,
  };
}

describe('classifyLinkCandidate', () => {
  const jobs: Job[] = [
    job({ id: 1 }),
    job({ id: 2, dependencies: [{ jobId: 1, type: 'FS', lagHours: 0 }] }),
    job({ id: 3 }),
  ];

  it('accepts a normal new edge', () => {
    expect(classifyLinkCandidate(jobs, 3, 1)).toBe('valid');
  });

  it('rejects linking a job to itself', () => {
    expect(classifyLinkCandidate(jobs, 2, 2)).toBe('invalid-self');
  });

  it('rejects an edge that already exists', () => {
    expect(classifyLinkCandidate(jobs, 1, 2)).toBe('invalid-duplicate');
  });

  it('rejects an edge that would close a cycle', () => {
    expect(classifyLinkCandidate(jobs, 2, 1)).toBe('invalid-cycle');
  });

  it('rejects a transitive cycle (3 -> 2 -> 1 -> 3)', () => {
    const chained = [
      job({ id: 1, dependencies: [{ jobId: 3, type: 'FS', lagHours: 0 }] }),
      job({ id: 2, dependencies: [{ jobId: 1, type: 'FS', lagHours: 0 }] }),
      job({ id: 3 }),
    ];
    expect(classifyLinkCandidate(chained, 2, 3)).toBe('invalid-cycle');
  });
});

describe('buildBoardLanes', () => {
  it('stacks time-overlapping jobs onto separate rows within a lane', () => {
    const jobs: Job[] = [
      job({ id: 1, start: '2026-07-14T06:00', end: '2026-07-14T14:00' }),
      job({ id: 2, start: '2026-07-14T10:00', end: '2026-07-14T18:00' }),
      job({ id: 3, start: '2026-07-14T15:00', end: '2026-07-14T20:00' }),
    ];
    const model = buildBoardLanes(jobs, [{ id: 1, name: 'CNC-1', type: 'mill', axis: 3 }]);
    const lane = model.lanes.find((item) => item.machine === 'CNC-1')!;
    const rowsById = new Map(lane.slots.map((item) => [item.slot.jobId, item.row]));
    expect(rowsById.get(1)).toBe(0);
    expect(rowsById.get(2)).toBe(1);
    expect(rowsById.get(3)).toBe(0);
    expect(lane.rowCount).toBe(2);
  });

  it('lands a routed order on every machine its route touches (the Phase 6 stress-test bug)', () => {
    // A multi-op order whose legacy `machine` is a display chain that never equals a lane name.
    const routed = job({
      id: 5,
      machine: 'Pila → CNC-1 → Kontrola kvalitete',
      start: '2026-07-14T06:00',
      end: '2026-07-14T06:00',
      operations: [
        { id: 1, name: 'Cut', machine: 'Pila', hours: 2 },
        { id: 2, name: 'Mill', machine: 'CNC-1', hours: 3 },
        { id: 3, name: 'QC', machine: 'Kontrola kvalitete', hours: 1 },
      ],
    });
    const model = buildBoardLanes([routed], [
      { id: 1, name: 'Pila', type: 'saw', axis: null },
      { id: 2, name: 'CNC-1', type: 'mill', axis: 3 },
      { id: 3, name: 'Kontrola kvalitete', type: 'qc', axis: null },
    ]);
    const laneFor = (name: string) => model.lanes.find((lane) => lane.machine === name)!;
    // Previously every one of these lanes was empty; now each shows its operation.
    expect(laneFor('Pila').slots).toHaveLength(1);
    expect(laneFor('CNC-1').slots).toHaveLength(1);
    expect(laneFor('Kontrola kvalitete').slots).toHaveLength(1);
    // Operations lay out sequentially from the job start: Pila 06–08, CNC-1 08–11, QC 11–12.
    const cnc = laneFor('CNC-1').slots[0].slot;
    expect(new Date(cnc.startMs).getHours()).toBe(8);
    expect(cnc.hours).toBe(3);
  });

  it('excludes container parents (their leaves carry the slots)', () => {
    const jobs: Job[] = [
      job({ id: 10, machine: '', start: '2026-07-14T06:00', end: '2026-07-14T06:00' }),
      job({ id: 11, parentId: 10, machine: 'CNC-1' }),
    ];
    const model = buildBoardLanes(jobs, [{ id: 1, name: 'CNC-1', type: 'mill', axis: 3 }]);
    const allJobIds = model.slots.map((slot) => slot.jobId);
    expect(allJobIds).toContain(11);
    expect(allJobIds).not.toContain(10);
  });
});
