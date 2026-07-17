import type { Task } from 'gantt-task-react';
import type { Job, OperationStep } from './SchedulingContext';
import { computeEffectiveSchedule, computeCriticalPath, jobsToScheduleInput, type SchedulingOptions } from './cpm';

export function getChildren(jobs: Job[], parentId: number): Job[] {
  return jobs.filter((j) => j.parentId === parentId);
}

export function hasChildren(jobs: Job[], id: number): boolean {
  return jobs.some((j) => j.parentId === id);
}

/** True for organizational nodes (a tool, assembly, sub-assembly) that group
 * other work orders rather than representing work done on a machine. */
export function isContainerNode(jobs: Job[], job: Job): boolean {
  return hasChildren(jobs, job.id);
}

export interface OperationSchedule {
  op: OperationStep;
  start: Date;
  end: Date;
}

/** Lays operations out sequentially starting from the job's own start time. */
export function computeOperationSchedule(job: Job): OperationSchedule[] {
  if (!job.operations || job.operations.length === 0) return [];
  let cursor = new Date(job.start).getTime();
  return job.operations.map((op) => {
    const start = new Date(cursor);
    const end = new Date(cursor + op.hours * 3600000);
    cursor = end.getTime();
    return { op, start, end };
  });
}

interface Range {
  start: number;
  end: number;
}

function computeJobRange(jobs: Job[], job: Job, effective: Map<number, { start: number; end: number }>): Range {
  const children = getChildren(jobs, job.id);
  const ranges: Range[] = [];

  if (job.operations && job.operations.length > 0) {
    const opSchedule = computeOperationSchedule(job);
    opSchedule.forEach((o) => ranges.push({ start: o.start.getTime(), end: o.end.getTime() }));
  } else if (children.length === 0) {
    const eff = effective.get(job.id);
    if (eff) ranges.push(eff);
  }

  children.forEach((child) => {
    ranges.push(computeJobRange(jobs, child, effective));
  });

  if (ranges.length === 0) {
    const start = new Date(job.start).getTime();
    return { start, end: start };
  }

  return {
    start: Math.min(...ranges.map((r) => r.start)),
    end: Math.max(...ranges.map((r) => r.end)),
  };
}

const STATUS_COLORS: Record<Job['status'], string> = {
  planned: '#64748b',
  inProgress: '#2563eb',
  done: '#10b981',
  delayed: '#ef4444',
};

/**
 * Flattens the parent/child work-order tree (tool -> assembly -> sub-assembly
 * -> part) plus each leaf's operation route into gantt-task-react's Task
 * list, using its native "project" rows for containers so parent bars
 * automatically span their children.
 */
export interface GanttBuildOptions {
  highlightCritical?: boolean;
  criticalToleranceMs?: number;
  collapsedIds?: Set<number>;
  scheduling?: SchedulingOptions;
}

export function buildGanttTasks(jobs: Job[], options: GanttBuildOptions = {}): Task[] {
  const validJobs = jobs.filter((j) => j.start);
  const scheduleInput = jobsToScheduleInput(validJobs.filter((j) => !hasChildren(validJobs, j.id)));
  const effective = computeEffectiveSchedule(scheduleInput, options.scheduling);
  const criticalIds = options.highlightCritical === false ? new Set<number>() : computeCriticalPath(scheduleInput, effective, options.criticalToleranceMs);

  const tasks: Task[] = [];
  const roots = validJobs.filter((j) => !j.parentId || !validJobs.some((p) => p.id === j.parentId));

  function walk(job: Job, projectId?: string) {
    const children = getChildren(validJobs, job.id);
    const label = job.order || job.machine || `#${job.id}`;
    const isCritical = criticalIds.has(job.id);
    const color = isCritical ? '#ef4444' : STATUS_COLORS[job.status];

    if (children.length > 0) {
      const range = computeJobRange(validJobs, job, effective);
      tasks.push({
        id: `wo-${job.id}`,
        type: 'project',
        name: label,
        start: new Date(range.start),
        end: new Date(Math.max(range.end, range.start + 3600000)),
        progress: job.progress,
        project: projectId,
        isDisabled: true,
        styles: { backgroundColor: color, backgroundSelectedColor: color },
      });
      if (options.collapsedIds?.has(job.id)) return;
      children.forEach((child) => walk(child, `wo-${job.id}`));
      return;
    }

    if (job.operations && job.operations.length > 0) {
      const range = computeJobRange(validJobs, job, effective);
      tasks.push({
        id: `wo-${job.id}`,
        type: 'project',
        name: label,
        start: new Date(range.start),
        end: new Date(Math.max(range.end, range.start + 3600000)),
        progress: job.progress,
        project: projectId,
        isDisabled: true,
        styles: { backgroundColor: color, backgroundSelectedColor: color },
      });
      computeOperationSchedule(job).forEach((o) => {
        tasks.push({
          id: `op-${job.id}-${o.op.id}`,
          type: 'task',
          name: `${o.op.name} (${o.op.machine})`,
          start: o.start,
          end: o.end > o.start ? o.end : new Date(o.start.getTime() + 3600000),
          progress: job.status === 'done' ? 100 : job.status === 'inProgress' ? job.progress : 0,
          project: `wo-${job.id}`,
          styles: { backgroundColor: STATUS_COLORS[job.status], backgroundSelectedColor: STATUS_COLORS[job.status] },
        });
      });
      return;
    }

    const eff = effective.get(job.id);
    const start = eff ? new Date(eff.start) : new Date(job.start);
    const end = eff ? new Date(eff.end) : new Date(job.end || job.start);
    const isMilestone = end.getTime() <= start.getTime();
    tasks.push({
      id: `wo-${job.id}`,
      type: isMilestone ? 'milestone' : 'task',
      name: label,
      start,
      end: isMilestone ? start : end,
      progress: job.progress,
      project: projectId,
      dependencies: (job.dependencies ?? []).map((d) => `wo-${d.jobId}`),
      styles: { backgroundColor: color, backgroundSelectedColor: color },
    });
  }

  roots.forEach((job) => walk(job));
  return tasks;
}

/** Reverses a gantt-task-react task id ("wo-12" / "op-12-3") back to a job id. */
export function jobIdFromTaskId(taskId: string): number | null {
  const match = taskId.match(/^(?:wo|op)-(\d+)/);
  return match ? Number(match[1]) : null;
}
