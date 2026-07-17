import type { Job } from './SchedulingContext';

/**
 * True when a job's own dates say it is late but its manual kanban status hasn't caught up: it is
 * not done, has an end date, and that end is already in the past. Lets the UI auto-flag lateness
 * (e.g. an order 11 days overdue still sitting in "PLANIRANO") without silently overwriting a
 * planner's deliberate status choice.
 */
export function isJobOverdue(job: Job, now: number = Date.now()): boolean {
  if (job.status === 'done' || !job.end) return false;
  const end = new Date(job.end).getTime();
  if (isNaN(end)) return false;
  return end < now;
}

/**
 * True when a job is heading toward being late — not yet overdue, but its end falls inside the
 * given look-ahead window (default 48h). "At risk" rather than "late".
 */
export function isJobAtRisk(job: Job, now: number = Date.now(), lookaheadMs: number = 48 * 3_600_000): boolean {
  if (job.status === 'done' || !job.end) return false;
  const end = new Date(job.end).getTime();
  if (isNaN(end)) return false;
  return end >= now && end <= now + lookaheadMs;
}
