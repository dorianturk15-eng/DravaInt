import type { Job, DependencyType } from './SchedulingContext';
import type { Machine } from '../machines/MachinesContext';
import { hasChildren } from './hierarchy';
import { computeEffectiveSchedule, findDependencyCycle, jobsToScheduleInput, type SchedulingOptions, type EffectiveSchedule } from './cpm';
import { expandToOperationSlots, type OperationSlot } from './operationSlots';

export type LinkClassification = 'valid' | 'invalid-self' | 'invalid-duplicate' | 'invalid-cycle';

/** Validates a prospective dependency edge (source = predecessor, target = successor) before the
 *  board commits it: rejects self-links, duplicates, and anything that would close a cycle. */
export function classifyLinkCandidate(jobs: Job[], sourceJobId: number, targetJobId: number): LinkClassification {
  if (targetJobId === sourceJobId) return 'invalid-self';
  const target = jobs.find((job) => job.id === targetJobId);
  if (target?.dependencies?.some((dependency) => dependency.jobId === sourceJobId)) return 'invalid-duplicate';
  const candidateJobs = jobs.map((job) =>
    job.id === targetJobId
      ? { ...job, dependencies: [...(job.dependencies ?? []), { jobId: sourceJobId, type: 'FS' as DependencyType, lagHours: 0 }] }
      : job,
  );
  if (findDependencyCycle(jobsToScheduleInput(candidateJobs))) return 'invalid-cycle';
  return 'valid';
}

/* Kept in sync with the theme tokens in index.css (--primary/success/danger); hex because these
   also feed SVG fills where CSS variables aren't always usable. */
export const STATUS_COLORS: Record<Job['status'], string> = {
  planned: '#64748b',
  inProgress: '#2563eb',
  done: '#10b981',
  delayed: '#ef4444',
};

export interface BoardSlot {
  slot: OperationSlot;
  /** Sub-row within the lane, so time-overlapping slots stack instead of occluding one another. */
  row: number;
}

export interface BoardLane {
  machine: string;
  slots: BoardSlot[];
  rowCount: number;
}

/** Greedy interval-graph row assignment: each slot gets the lowest row whose last slot already ended. */
function assignRows(slots: Array<{ startMs: number; endMs: number }>): number[] {
  const rowEndTimes: number[] = [];
  return slots.map((slot) => {
    let row = rowEndTimes.findIndex((endTime) => endTime <= slot.startMs);
    if (row === -1) {
      row = rowEndTimes.length;
      rowEndTimes.push(slot.endMs);
    } else {
      rowEndTimes[row] = slot.endMs;
    }
    return row;
  });
}

export interface BoardModel {
  lanes: BoardLane[];
  effective: Map<number, EffectiveSchedule>;
  /** Every rendered slot, flattened — the board's card list and hit-testing derive from this. */
  slots: OperationSlot[];
}

/**
 * The board's per-machine lanes, built from operation slots rather than the legacy single `machine`
 * string. Every leaf job — plain, chain-string, or multi-operation routed — expands via
 * {@link expandToOperationSlots} into the (machine, time-window) segments it actually occupies, so a
 * routed order finally shows up on each machine its route touches (the Phase 6 stress-test bug).
 * Container/tool nodes contribute no slots; their leaves do.
 */
export function buildBoardLanes(jobs: Job[], machines: Machine[], schedulingOptions: SchedulingOptions = {}): BoardModel {
  const leaves = jobs.filter((job) => !hasChildren(jobs, job.id));
  const effective = computeEffectiveSchedule(jobsToScheduleInput(leaves), schedulingOptions);
  const slots = expandToOperationSlots(jobs, effective);

  const names = new Set<string>();
  machines.forEach((machine) => names.add(machine.name));
  slots.forEach((slot) => names.add(slot.machine));
  if (names.size === 0) names.add('General / Unassigned');

  const lanes: BoardLane[] = Array.from(names).map((machine) => {
    const laneSlots = slots
      .filter((slot) => slot.machine === machine)
      .sort((a, b) => a.startMs - b.startMs);
    const rows = assignRows(laneSlots);
    const boardSlots: BoardSlot[] = laneSlots.map((slot, index) => ({ slot, row: rows[index] }));
    return { machine, slots: boardSlots, rowCount: Math.max(1, ...rows.map((r) => r + 1)) };
  });

  return { lanes, effective, slots };
}
