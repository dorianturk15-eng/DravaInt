import { describe, expect, it } from 'vitest';
import { collectDescendants } from './hierarchy';
import type { Job } from './SchedulingContext';

function job(id: number, parentId?: number): Job {
  return {
    id,
    machine: '',
    order: `RN-${id}`,
    operator: '',
    start: '2026-07-01T06:00',
    end: '2026-07-01T08:00',
    status: 'planned',
    progress: 0,
    color: '#000',
    parentId,
  };
}

describe('collectDescendants', () => {
  // tool 1 -> assembly 2 -> sub-assembly 3; assembly 4 also under 1; 5 is unrelated
  const jobs = [job(1), job(2, 1), job(3, 2), job(4, 1), job(5)];

  it('returns every transitive child, not just direct ones', () => {
    expect(collectDescendants(jobs, 1)).toEqual(new Set([2, 3, 4]));
  });

  it('excludes the job itself and unrelated branches', () => {
    const result = collectDescendants(jobs, 2);
    expect(result).toEqual(new Set([3]));
    expect(result.has(2)).toBe(false);
    expect(result.has(5)).toBe(false);
  });

  it('is empty for leaves and unknown ids', () => {
    expect(collectDescendants(jobs, 3).size).toBe(0);
    expect(collectDescendants(jobs, 999).size).toBe(0);
  });
});
