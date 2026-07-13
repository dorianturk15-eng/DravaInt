import type { Dependency, Job } from './SchedulingContext';

export interface EffectiveSchedule {
  start: number; // epoch ms
  end: number; // epoch ms
}

interface ScheduleInput {
  id: number;
  start: string;
  end: string;
  dependencies?: Dependency[];
}

/**
 * Computes each job's effective start/end by applying dependency constraints
 * on top of its own manually-set start/end. A job's own duration is always
 * preserved; dependencies can only push its start later (never earlier than
 * what the user set), matching how real scheduling tools treat manual dates
 * as a floor rather than silently overriding user input.
 */
export function computeEffectiveSchedule(jobs: ScheduleInput[]): Map<number, EffectiveSchedule> {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const durationMs = new Map(jobs.map((j) => [j.id, new Date(j.end).getTime() - new Date(j.start).getTime()]));

  const effective = new Map<number, EffectiveSchedule>();
  const visiting = new Set<number>();

  function resolve(id: number): EffectiveSchedule {
    const cached = effective.get(id);
    if (cached) return cached;

    const job = byId.get(id);
    const dur = durationMs.get(id) ?? 0;
    if (!job) return { start: 0, end: dur };

    if (visiting.has(id)) {
      // dependency cycle: fall back to the job's own manual timing
      const start = new Date(job.start).getTime();
      return { start, end: start + dur };
    }
    visiting.add(id);

    let earliestStart = new Date(job.start).getTime();

    for (const dep of job.dependencies ?? []) {
      const pred = resolve(dep.jobId);
      const lagMs = dep.lagHours * 3600000;
      switch (dep.type) {
        case 'FS':
          earliestStart = Math.max(earliestStart, pred.end + lagMs);
          break;
        case 'SS':
          earliestStart = Math.max(earliestStart, pred.start + lagMs);
          break;
        case 'FF':
          earliestStart = Math.max(earliestStart, pred.end + lagMs - dur);
          break;
        case 'SF':
          earliestStart = Math.max(earliestStart, pred.start + lagMs - dur);
          break;
      }
    }

    const result = { start: earliestStart, end: earliestStart + dur };
    visiting.delete(id);
    effective.set(id, result);
    return result;
  }

  jobs.forEach((j) => resolve(j.id));
  return effective;
}

/**
 * Standard Critical Path Method backward pass. Simplification: the backward
 * pass treats every dependency as effectively Finish-to-Start for slack
 * purposes (i.e. "this job's latest finish is bounded by its successors'
 * latest start minus lag"), which is the common approximation lightweight
 * schedulers use — it's exact for FS chains and a safe, conservative
 * estimate for SS/FF/SF links.
 */
export function computeCriticalPath(jobs: ScheduleInput[], effective: Map<number, EffectiveSchedule>): Set<number> {
  const durationMs = new Map(
    jobs.map((j) => [j.id, (effective.get(j.id)?.end ?? 0) - (effective.get(j.id)?.start ?? 0)]),
  );

  const successorEdges = new Map<number, { to: number; lagMs: number }[]>();
  jobs.forEach((j) => {
    (j.dependencies ?? []).forEach((dep) => {
      if (!successorEdges.has(dep.jobId)) successorEdges.set(dep.jobId, []);
      successorEdges.get(dep.jobId)!.push({ to: j.id, lagMs: dep.lagHours * 3600000 });
    });
  });

  let projectEnd = 0;
  effective.forEach((s) => {
    if (s.end > projectEnd) projectEnd = s.end;
  });

  const latestFinish = new Map<number, number>();
  const visiting = new Set<number>();

  function resolveLatestFinish(id: number): number {
    const cached = latestFinish.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return projectEnd;
    visiting.add(id);

    const edges = successorEdges.get(id) ?? [];
    let lf = projectEnd;
    if (edges.length > 0) {
      lf = Math.min(
        ...edges.map((e) => {
          const succLatestFinish = resolveLatestFinish(e.to);
          const succLatestStart = succLatestFinish - (durationMs.get(e.to) ?? 0);
          return succLatestStart - e.lagMs;
        }),
      );
    }
    latestFinish.set(id, lf);
    visiting.delete(id);
    return lf;
  }

  jobs.forEach((j) => resolveLatestFinish(j.id));

  const TOLERANCE_MS = 60000;
  const critical = new Set<number>();
  jobs.forEach((j) => {
    const eff = effective.get(j.id);
    const lf = latestFinish.get(j.id);
    if (eff && lf !== undefined && lf - eff.end <= TOLERANCE_MS) critical.add(j.id);
  });
  return critical;
}

export function jobsToScheduleInput(jobs: Job[]): ScheduleInput[] {
  return jobs
    .filter((j) => j.start && j.end)
    .map((j) => ({ id: j.id, start: j.start, end: j.end, dependencies: j.dependencies }));
}
