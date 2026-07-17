import { describe, expect, it } from 'vitest';
import { boardEligibleJobs, buildBoardLanes, classifyLinkCandidate } from './boardData';
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

describe('boardEligibleJobs', () => {
  it('excludes container parents and operations-routed jobs', () => {
    const jobs: Job[] = [
      job({ id: 10 }),
      job({ id: 11, parentId: 10 }),
      job({ id: 12, operations: [{ id: 1, name: 'Saw', machine: 'Pila', hours: 2 }] }),
    ];
    expect(boardEligibleJobs(jobs).map((item) => item.id)).toEqual([11]);
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
    const rowsById = new Map(lane.jobs.map((item) => [item.job.id, item.row]));
    expect(rowsById.get(1)).toBe(0);
    expect(rowsById.get(2)).toBe(1);
    expect(rowsById.get(3)).toBe(0);
    expect(lane.rowCount).toBe(2);
  });
});
