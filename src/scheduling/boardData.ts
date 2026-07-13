import type { Job } from './SchedulingContext';
import type { Machine } from '../machines/MachinesContext';
import { hasChildren } from './hierarchy';
import { computeEffectiveSchedule, jobsToScheduleInput, type SchedulingOptions, type EffectiveSchedule } from './cpm';

export const STATUS_COLORS: Record<Job['status'], string> = {
  planned: '#64748b',
  inProgress: '#2b6cb0',
  done: '#16a34a',
  delayed: '#dc2626',
};

export interface BoardJob {
  job: Job;
  effectiveStart: number;
  effectiveEnd: number;
  /** Sub-row within the lane, so time-overlapping jobs stack instead of occluding one another. */
  row: number;
}

export interface BoardLane {
  machine: string;
  jobs: BoardJob[];
  rowCount: number;
}

/** Greedy interval-graph row assignment: each job gets the lowest row whose last job already ended. */
function assignRows(jobs: Array<{ effectiveStart: number; effectiveEnd: number }>): number[] {
  const rowEndTimes: number[] = [];
  return jobs.map((job) => {
    let row = rowEndTimes.findIndex((endTime) => endTime <= job.effectiveStart);
    if (row === -1) {
      row = rowEndTimes.length;
      rowEndTimes.push(job.effectiveEnd);
    } else {
      rowEndTimes[row] = job.effectiveEnd;
    }
    return row;
  });
}

export interface BoardModel {
  lanes: BoardLane[];
  effective: Map<number, EffectiveSchedule>;
}

/**
 * Jobs the board can render: leaf work orders (no sub-assemblies) with a single machine
 * assignment. Container/tool nodes and multi-step operations routes stay off this v1 board —
 * they already have a dedicated view in the Gantt chart's hierarchy rendering, and reassigning
 * "which machine" is ambiguous for a job whose steps span several machines.
 */
export function boardEligibleJobs(jobs: Job[]): Job[] {
  return jobs.filter((job) => !hasChildren(jobs, job.id) && !(job.operations && job.operations.length > 0));
}

export function buildBoardLanes(jobs: Job[], machines: Machine[], schedulingOptions: SchedulingOptions = {}): BoardModel {
  const eligible = boardEligibleJobs(jobs);
  const effective = computeEffectiveSchedule(jobsToScheduleInput(eligible), schedulingOptions);

  const names = new Set<string>();
  machines.forEach((machine) => names.add(machine.name));
  eligible.forEach((job) => {
    const name = job.machine.trim();
    if (name) names.add(name);
  });
  if (names.size === 0) names.add('General / Unassigned');

  const lanes: BoardLane[] = Array.from(names).map((machine) => {
    const laneJobs = eligible
      .filter((job) => job.machine.trim() === machine)
      .map((job) => {
        const eff = effective.get(job.id);
        return {
          job,
          effectiveStart: eff?.start ?? (job.start ? new Date(job.start).getTime() : Date.now()),
          effectiveEnd: eff?.end ?? (job.end ? new Date(job.end).getTime() : Date.now() + 3_600_000),
        };
      })
      .sort((a, b) => a.effectiveStart - b.effectiveStart);
    const rows = assignRows(laneJobs);
    const boardJobs: BoardJob[] = laneJobs.map((job, index) => ({ ...job, row: rows[index] }));
    return { machine, jobs: boardJobs, rowCount: Math.max(1, ...rows.map((r) => r + 1)) };
  });

  return { lanes, effective };
}
