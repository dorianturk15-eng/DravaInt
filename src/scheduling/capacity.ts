import type { Job } from './SchedulingContext';
import { splitMachineChain, type EffectiveSchedule } from './cpm';

export const WEEKLY_CAPACITY_HOURS = 40;

/** Weekly machine-capacity threshold. Admins tune it via the "bottleneck hours" system config
 *  (Admin → System); falls back to the 40h default when unset or invalid. */
export function getWeeklyCapacityHours(): number {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem('cfg-bottleneck-hours');
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : WEEKLY_CAPACITY_HOURS;
}

export interface WeekWindow {
  start: number;
  end: number;
}

/** Monday 00:00 → next Monday 00:00 for the week containing `ref` (optionally shifted by whole weeks). */
export function weekWindow(ref: Date = new Date(), weekOffset = 0): WeekWindow {
  const d = new Date(ref);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + weekOffset * 7;
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return { start: monday.getTime(), end: monday.getTime() + 7 * 24 * 60 * 60 * 1000 };
}

/** True when a job's scheduled window intersects the given week. Routed orders carry a zero-duration
 * parent window at their start, so a start inside the week counts. */
export function jobIntersectsWeek(job: Job, win: WeekWindow): boolean {
  if (!job.start) return false;
  const start = new Date(job.start).getTime();
  if (isNaN(start)) return false;
  const rawEnd = job.end ? new Date(job.end).getTime() : start;
  const end = isNaN(rawEnd) ? start : Math.max(rawEnd, start);
  return start < win.end && end >= win.start;
}

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
    const machines = splitMachineChain(job.machine);
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
