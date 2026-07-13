import type { Job } from './SchedulingContext';
import type { EffectiveSchedule } from './cpm';

export const WEEKLY_CAPACITY_HOURS = 40;

function add(loads: Map<string, number>, machine: string, hours: number) {
  const name = machine.trim();
  if (!name || !Number.isFinite(hours) || hours <= 0) return;
  loads.set(name, (loads.get(name) ?? 0) + hours);
}

/**
 * @param effective Optional CPM-resolved schedule (from computeEffectiveSchedule), keyed by job id.
 *   When provided, a job's duration reflects any dependency cascade even before that cascade has
 *   been persisted back to job.start/end — otherwise the capacity view lags a drag/connect by one
 *   write.
 */
export function calculateMachineLoads(jobs: Job[], effective?: Map<number, EffectiveSchedule>): Map<string, number> {
  const loads = new Map<string, number>();
  jobs.forEach((job) => {
    if (job.operations?.length) {
      job.operations.forEach((operation) => add(loads, operation.machine, operation.hours));
      return;
    }
    const machines = job.machine.split(' → ').map((machine) => machine.trim()).filter(Boolean);
    if (!machines.length) return;
    const eff = effective?.get(job.id);
    const scheduledHours = eff
      ? Math.max(1, (eff.end - eff.start) / 3_600_000)
      : job.start && job.end ? Math.max(1, (new Date(job.end).getTime() - new Date(job.start).getTime()) / 3_600_000) : 8;
    const hoursPerMachine = scheduledHours / machines.length;
    machines.forEach((machine) => add(loads, machine, hoursPerMachine));
  });
  return loads;
}
