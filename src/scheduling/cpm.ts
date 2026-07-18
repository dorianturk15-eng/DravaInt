import type { Dependency, Job } from './SchedulingContext';

export interface EffectiveSchedule {
  start: number; // epoch ms
  end: number; // epoch ms
}

export interface ScheduleInput {
  id: number;
  start: string;
  end: string;
  dependencies?: Dependency[];
}

export interface SchedulingOptions {
  holidays?: string[];
  workdayStart?: number;
  workdayEnd?: number;
  skipWeekends?: boolean;
}

function isWorkingMoment(date: Date, options: SchedulingOptions) {
  if (options.holidays?.includes(date.toISOString().slice(0, 10))) return false;
  if (options.skipWeekends !== false && (date.getDay() === 0 || date.getDay() === 6)) return false;
  const hour = date.getHours() + date.getMinutes() / 60;
  return hour >= (options.workdayStart ?? 0) && hour < (options.workdayEnd ?? 24);
}

export function addWorkingTime(start: number, durationMs: number, options: SchedulingOptions = {}) {
  if (!durationMs) return start;
  if (!options.holidays?.length && options.skipWeekends === undefined && options.workdayStart === undefined && options.workdayEnd === undefined) return start + durationMs;
  const direction = durationMs < 0 ? -1 : 1;
  let remainingMinutes = Math.ceil(Math.abs(durationMs) / 60_000);
  const cursor = new Date(start);
  while (remainingMinutes > 0) {
    cursor.setMinutes(cursor.getMinutes() + direction);
    if (isWorkingMoment(cursor, options)) remainingMinutes--;
  }
  return cursor.getTime();
}

export function findDependencyCycle(jobs: ScheduleInput[]): number[] | null {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const visited = new Set<number>();
  const active = new Set<number>();
  const path: number[] = [];
  function visit(id: number): number[] | null {
    if (active.has(id)) return [...path.slice(path.indexOf(id)), id];
    if (visited.has(id)) return null;
    visited.add(id);
    active.add(id);
    path.push(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      const cycle = visit(dependency.jobId);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(id);
    return null;
  }
  for (const job of jobs) {
    const cycle = visit(job.id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Computes each job's effective start/end by applying dependency constraints
 * on top of its own manually-set start/end. A job's own duration is always
 * preserved; dependencies can only push its start later (never earlier than
 * what the user set), matching how real scheduling tools treat manual dates
 * as a floor rather than silently overriding user input.
 */
export function computeEffectiveSchedule(jobs: ScheduleInput[], options: SchedulingOptions = {}): Map<number, EffectiveSchedule> {
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
          earliestStart = Math.max(earliestStart, addWorkingTime(pred.end, lagMs, options));
          break;
        case 'SS':
          earliestStart = Math.max(earliestStart, addWorkingTime(pred.start, lagMs, options));
          break;
        case 'FF':
          earliestStart = Math.max(earliestStart, addWorkingTime(pred.end, lagMs, options) - dur);
          break;
        case 'SF':
          earliestStart = Math.max(earliestStart, addWorkingTime(pred.start, lagMs, options) - dur);
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
export function computeScheduleSlack(jobs: ScheduleInput[], effective: Map<number, EffectiveSchedule>): Map<number, number> {
  const durationMs = new Map(
    jobs.map((j) => [j.id, (effective.get(j.id)?.end ?? 0) - (effective.get(j.id)?.start ?? 0)]),
  );

  const successorEdges = new Map<number, { to: number; weightMs: number }[]>();
  jobs.forEach((j) => {
    (j.dependencies ?? []).forEach((dep) => {
      if (!successorEdges.has(dep.jobId)) successorEdges.set(dep.jobId, []);
      const predecessorDuration = durationMs.get(dep.jobId) ?? 0;
      const successorDuration = durationMs.get(j.id) ?? 0;
      const lag = dep.lagHours * 3_600_000;
      const weightMs = dep.type === 'FS' ? predecessorDuration + lag
        : dep.type === 'SS' ? lag
        : dep.type === 'FF' ? predecessorDuration + lag - successorDuration
        : lag - successorDuration;
      successorEdges.get(dep.jobId)!.push({ to: j.id, weightMs });
    });
  });

  let projectEnd = 0;
  effective.forEach((s) => {
    if (s.end > projectEnd) projectEnd = s.end;
  });

  const latestStart = new Map<number, number>();
  const visiting = new Set<number>();

  function resolveLatestStart(id: number): number {
    const cached = latestStart.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return projectEnd;
    visiting.add(id);

    const edges = successorEdges.get(id) ?? [];
    let latest = projectEnd - (durationMs.get(id) ?? 0);
    if (edges.length > 0) {
      latest = Math.min(latest, ...edges.map((edge) => resolveLatestStart(edge.to) - edge.weightMs));
    }
    latestStart.set(id, latest);
    visiting.delete(id);
    return latest;
  }

  jobs.forEach((j) => resolveLatestStart(j.id));

  const slack = new Map<number, number>();
  jobs.forEach((j) => {
    const eff = effective.get(j.id);
    const latest = latestStart.get(j.id);
    if (eff && latest !== undefined) slack.set(j.id, Math.max(0, latest - eff.start));
  });
  return slack;
}

export function computeCriticalPath(jobs: ScheduleInput[], effective: Map<number, EffectiveSchedule>, toleranceMs = 60_000): Set<number> {
  const slack = computeScheduleSlack(jobs, effective);
  const critical = new Set<number>();
  slack.forEach((value, id) => {
    if (value <= toleranceMs) critical.add(id);
  });
  return critical;
}

export function jobsToScheduleInput(jobs: Job[]): ScheduleInput[] {
  return jobs
    .filter((j) => j.start && j.end)
    .map((j) => ({ id: j.id, start: j.start, end: j.end, dependencies: j.dependencies }));
}

/** Formats a Date as the "datetime-local" string every Job.start/end uses (local time, no timezone suffix). */
export function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Given a job that just moved to newStart/newEnd, walks every dependent
 * (successor) job transitively and returns the new start/end each one needs
 * so its FS/SS/FF/SF link is respected. Built on the same working-hours-aware
 * addWorkingTime() used by computeEffectiveSchedule, so a drag-driven cascade
 * always agrees with the CPM-resolved schedule shown elsewhere (unlike a
 * naive millisecond-only cascade, which can push a job onto a weekend that
 * computeEffectiveSchedule would have skipped).
 */
export function cascadeDependents(
  updatedJobId: number,
  newStart: string,
  newEnd: string,
  jobs: ScheduleInput[],
  options: SchedulingOptions = {},
): Map<number, { start: string; end: string }> {
  const byId = new Map(jobs.map((job) => [job.id, { start: job.start, end: job.end }]));
  const moved = byId.get(updatedJobId);
  if (moved) {
    moved.start = newStart;
    moved.end = newEnd;
  }

  const pending = new Map<number, { start: string; end: string }>();
  const seen = new Set<number>();

  function collect(parentId: number) {
    if (seen.has(parentId)) return;
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return;
    const parentStart = new Date(parent.start).getTime();
    const parentEnd = new Date(parent.end).getTime();
    const children = jobs.filter((job) => job.dependencies?.some((dependency) => dependency.jobId === parentId));

    for (const child of children) {
      const dependency = child.dependencies!.find((item) => item.jobId === parentId)!;
      const lagMs = (dependency.lagHours || 0) * 3_600_000;
      const current = byId.get(child.id)!;
      const childStart = new Date(current.start).getTime();
      const childEnd = new Date(current.end).getTime();
      const duration = childEnd - childStart;
      let nextStart = childStart;

      if (dependency.type === 'FS') nextStart = Math.max(childStart, addWorkingTime(parentEnd, lagMs, options));
      else if (dependency.type === 'SS') nextStart = Math.max(childStart, addWorkingTime(parentStart, lagMs, options));
      else if (dependency.type === 'FF') nextStart = Math.max(childStart, addWorkingTime(parentEnd, lagMs, options) - duration);
      else nextStart = Math.max(childStart, addWorkingTime(parentStart, lagMs, options) - duration);

      if (nextStart === childStart) continue;
      const nextStartString = toLocalDateTimeString(new Date(nextStart));
      const nextEndString = toLocalDateTimeString(new Date(nextStart + duration));
      byId.set(child.id, { start: nextStartString, end: nextEndString });
      pending.set(child.id, { start: nextStartString, end: nextEndString });
      collect(child.id);
    }
  }

  collect(updatedJobId);
  return pending;
}

export interface JobConflicts {
  machineOverlap?: { otherOrder: string };
  operatorOverlap?: { otherOrder: string };
  unqualified?: { message: string };
  shiftOutside?: { message: string };
  hoursExceeded?: { message: string };
  restViolation?: { message: string };
  absent?: { message: string };
}

interface WorkerRecord {
  id?: number;
  firstName?: string;
  lastName?: string;
  roleName?: string;
  status?: string;
  qualifications?: string[];
}

interface AbsenceRecord {
  workerId: number;
  startDate: string;
  endDate: string;
}

function loadWorkerRecords(): WorkerRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('dravaint-workers-v2') || '[]');
    return Array.isArray(parsed) ? (parsed as WorkerRecord[]) : [];
  } catch {
    return [];
  }
}

function loadAbsences(): AbsenceRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('dravaint-absences-v1') || '[]');
    return Array.isArray(parsed) ? (parsed as AbsenceRecord[]) : [];
  } catch {
    return [];
  }
}

function findWorker(workers: WorkerRecord[], name: string): WorkerRecord | undefined {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return undefined;
  return workers.find((worker) => `${worker.firstName ?? ''} ${worker.lastName ?? ''}`.trim().toLowerCase() === normalized);
}

/**
 * Splits a job's `machine` field — which may be a routing chain like "Tokarilica-1 → CNC-2" — into
 * its individual machine names. Normalises on the '→' arrow regardless of surrounding whitespace, so
 * both "A → B" and "A→B" yield ["A","B"]. The app previously used two different separators ('→' here,
 * ' → ' in capacity.ts / GanttChart.tsx); a chain typed without spaces silently double-counted as a
 * single phantom machine. This is the shared source of truth for that split.
 */
export function splitMachineChain(machine: string | undefined | null): string[] {
  return (machine || '').split('→').map((name) => name.trim()).filter(Boolean);
}

/**
 * Joins machine names back into the canonical routing-chain display string. The inverse of
 * {@link splitMachineChain} and the single source of truth for the ' → ' separator — the same
 * format WorkOrderCreator writes (`operations.map(op => op.machine).join(' → ')`), so a chain the
 * board regenerates after an operation's machine changes still round-trips through splitMachineChain.
 */
export function joinMachineChain(machines: string[]): string {
  return machines.map((name) => name.trim()).filter(Boolean).join(' → ');
}

interface MachineInterval {
  machine: string;
  start: number;
  end: number;
}

interface WorkInterval {
  operator: string;
  machine: string;
  start: number;
  end: number;
}

/**
 * Lays a routed job's operations out sequentially from the job start, yielding the machine, the
 * assigned worker, and the time window for each step. This is the same layout buildGanttTasks
 * renders, so operation-level conflict checks agree with what the Gantt shows. Mirrors
 * hierarchy.computeOperationSchedule (kept local to avoid a cpm <-> hierarchy import cycle).
 */
function operationIntervals(job: Job): WorkInterval[] {
  if (!job.operations?.length || !job.start) return [];
  let cursor = new Date(job.start).getTime();
  if (isNaN(cursor)) return [];
  const intervals: WorkInterval[] = [];
  for (const op of job.operations) {
    const start = cursor;
    const end = cursor + (op.hours || 0) * 3_600_000;
    cursor = end;
    intervals.push({
      machine: (op.machine || '').trim(),
      operator: (op.operator || '').trim(),
      start,
      end,
    });
  }
  return intervals;
}

/**
 * Every (machine, time-window) a job actually occupies. For routed jobs this is per-operation, so
 * "Tokarilica-1 → CNC-2" no longer hides behind a single opaque string; for a plain job whose
 * machine field is a chain, each machine in the chain is checked across the job window.
 */
function machineIntervals(job: Job): MachineInterval[] {
  if (job.operations?.length) {
    return operationIntervals(job).filter((i) => i.machine).map(({ machine, start, end }) => ({ machine, start, end }));
  }
  const machines = splitMachineChain(job.machine);
  if (!machines.length || !job.start || !job.end) return [];
  const start = new Date(job.start).getTime();
  const end = new Date(job.end).getTime();
  if (isNaN(start) || isNaN(end) || start >= end) return [];
  return machines.map((machine) => ({ machine, start, end }));
}

/**
 * Every (worker, time-window) work segment a job represents. Routed jobs are per-operation — the
 * top-level `operator` on a routing order is usually a product label, not a person, so keying
 * worker checks off it silently skips them (which it did before this was per-operation).
 */
function workerIntervals(job: Job): WorkInterval[] {
  if (job.operations?.length) {
    return operationIntervals(job).filter((i) => i.operator);
  }
  const operator = (job.operator || '').trim();
  if (!operator || !job.start || !job.end) return [];
  const start = new Date(job.start).getTime();
  const end = new Date(job.end).getTime();
  if (isNaN(start) || isNaN(end) || start >= end) return [];
  return [{ operator, machine: (job.machine || '').trim(), start, end }];
}

export function getMonday(d: Date): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  // Local-date formatting, not toISOString(): east of UTC, local Monday 00:00 is still Sunday in
  // UTC, so the ISO string named the wrong day and shifted the whole weekly-hours window.
  return toLocalDateTimeString(monday).slice(0, 10);
}

/**
 * Sums a worker's scheduled hours inside the given week across all jobs, counting per-operation
 * assignments on routed orders as well as plain single-operator jobs.
 */
function calculateWeeklyHours(operator: string, weekMondayStr: string, jobs: Job[]): number {
  if (!operator) return 0;
  // Parse as local midnight (a bare date string would parse as UTC and skew the window east of UTC).
  const targetMonday = new Date(`${weekMondayStr}T00:00:00`);
  const targetSundayEnd = new Date(targetMonday.getTime() + 7 * 24 * 60 * 60 * 1000);
  const normalizedOp = operator.trim().toLowerCase();

  let total = 0;
  for (const job of jobs) {
    for (const seg of workerIntervals(job)) {
      if (seg.operator.trim().toLowerCase() !== normalizedOp) continue;
      const overlapStart = Math.max(seg.start, targetMonday.getTime());
      const overlapEnd = Math.min(seg.end, targetSundayEnd.getTime());
      if (overlapStart < overlapEnd) total += (overlapEnd - overlapStart) / 3_600_000;
    }
  }
  return total;
}

/**
 * True when the worker is working outside the shift they are assigned to for that day. Requires a
 * generated shift schedule; when none exists yet (the default state) it returns false rather than
 * flagging every worker against a stale hardcoded roster.
 */
function checkShiftScheduleConflict(operator: string, startMs: number, endMs: number): boolean {
  if (!operator || isNaN(startMs) || isNaN(endMs) || startMs >= endMs) return false;

  try {
    const shiftData = JSON.parse(localStorage.getItem('dravaint-shifts-v2') || '{}') as {
      definitions?: Array<{ id: number; startTime: string; endTime: string }>;
      schedules?: Array<{ startDate: string; endDate: string; assignments: Array<{ workerId: number; shiftDefinitionId: number; date: string }> }>;
    };
    const workers = loadWorkerRecords();
    if (!shiftData.schedules?.length || !shiftData.definitions?.length) return false;

    const worker = findWorker(workers, operator);
    if (!worker || worker.id == null) return false;

    const date = toLocalDateTimeString(new Date(startMs)).slice(0, 10);
    const schedule = shiftData.schedules.find((item) => date >= item.startDate && date <= item.endDate);
    const assignment = schedule?.assignments.find((item) => item.workerId === worker.id && item.date === date);
    const definition = shiftData.definitions.find((item) => item.id === assignment?.shiftDefinitionId);
    if (!assignment || !definition) return true;

    const allowedStart = new Date(`${date}T${definition.startTime}:00`).getTime();
    const allowedEndDate = new Date(`${date}T${definition.endTime}:00`);
    if (definition.endTime <= definition.startTime) allowedEndDate.setDate(allowedEndDate.getDate() + 1);
    return startMs < allowedStart || endMs > allowedEndDate.getTime();
  } catch {
    return false;
  }
}

function intervalsOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function getJobConflicts(job: Job, allJobs: Job[]): JobConflicts {
  const conflicts: JobConflicts = {};

  if (!job.start || job.status === 'done') return conflicts;
  const jobStart = new Date(job.start).getTime();
  if (isNaN(jobStart)) return conflicts;
  // Routed orders carry a zero-duration parent window (the work lives in the operations), so only
  // bail on an empty window for plain, non-routed jobs — otherwise every routing order is skipped.
  if (!job.operations?.length) {
    const jobEnd = new Date(job.end).getTime();
    if (isNaN(jobEnd) || jobStart >= jobEnd) return conflicts;
  }

  const hasKids = (id: number) => allJobs.some((j) => j.parentId === id);
  const leafJobs = allJobs.filter((j) => !hasKids(j.id));
  const others = leafJobs.filter((o) => o.id !== job.id && o.status !== 'done');

  // --- Machine double-booking (bug: routing chains were compared by exact string) ---
  const myMachines = machineIntervals(job);
  for (const other of others) {
    if (conflicts.machineOverlap) break;
    const otherMachines = machineIntervals(other);
    const clash = myMachines.some((a) => otherMachines.some((b) => a.machine === b.machine && intervalsOverlap(a, b)));
    if (clash) conflicts.machineOverlap = { otherOrder: other.order };
  }

  // --- Operator double-booking (per-worker, per-operation) ---
  const myWork = workerIntervals(job);
  for (const other of others) {
    if (conflicts.operatorOverlap) break;
    const otherWork = workerIntervals(other);
    const clash = myWork.some((a) => otherWork.some((b) =>
      a.operator.trim().toLowerCase() === b.operator.trim().toLowerCase() && intervalsOverlap(a, b)));
    if (clash) conflicts.operatorOverlap = { otherOrder: other.order };
  }

  // --- Per-assigned-worker checks: qualification, absence, shift, hours, rest ---
  const workers = loadWorkerRecords();
  const absences = loadAbsences();
  const maxHoursLimit = parseFloat(localStorage.getItem('cfg-max-hours') || '48');

  const byOperator = new Map<string, WorkInterval[]>();
  for (const seg of myWork) {
    const key = seg.operator.trim();
    if (!key) continue;
    const list = byOperator.get(key);
    if (list) list.push(seg);
    else byOperator.set(key, [seg]);
  }

  for (const [operatorName, segs] of byOperator) {
    const worker = findWorker(workers, operatorName);
    // The operator isn't a real worker (e.g. a product/assembly label on a routing order): there is
    // nothing to verify about a person here, so skip rather than silently pass.
    if (!worker) continue;
    const quals = Array.isArray(worker.qualifications) ? worker.qualifications : [];
    const earliest = Math.min(...segs.map((s) => s.start));
    const dateStr = toLocalDateTimeString(new Date(earliest)).slice(0, 10);

    // Qualification: only when the worker has explicit qualifications recorded. An empty list means
    // "not verified", not "unqualified" — we don't guess from role.
    if (quals.length && !conflicts.unqualified) {
      const machinesForWorker = [...new Set(segs.map((s) => s.machine).filter(Boolean))];
      const missing = machinesForWorker.filter((m) => !quals.includes(m));
      if (missing.length) conflicts.unqualified = { message: `'${operatorName}' nije kvalificiran za: ${missing.join(', ')}` };
    }

    // Absence: live status or a date-ranged absence record covering the work day.
    if (!conflicts.absent) {
      const absentByStatus = (worker.status ?? '') === 'absent';
      const absentByRecord = worker.id != null && absences.some((a) => a.workerId === worker.id && a.startDate <= dateStr && a.endDate >= dateStr);
      if (absentByStatus || absentByRecord) {
        conflicts.absent = { message: `${operatorName} je nedostupan (${absentByStatus ? 'status: odsutan' : 'evidentirana odsutnost'}) — ${dateStr}` };
      }
    }

    // Shift schedule.
    if (!conflicts.shiftOutside && segs.some((s) => checkShiftScheduleConflict(operatorName, s.start, s.end))) {
      conflicts.shiftOutside = { message: 'Izvan dodijeljenog rasporeda smjena' };
    }

    // Weekly hours.
    if (!conflicts.hoursExceeded) {
      const weeklyHours = calculateWeeklyHours(operatorName, getMonday(new Date(earliest)), leafJobs);
      if (weeklyHours > maxHoursLimit) conflicts.hoursExceeded = { message: `${weeklyHours.toFixed(1)}h / limit ${maxHoursLimit}h` };
    }

    // Rest: < 12h since this worker's previous work segment ends.
    if (!conflicts.restViolation) {
      let prevEnd = -Infinity;
      let prevOrder = '';
      for (const other of leafJobs) {
        if (other.status === 'done') continue;
        for (const s of workerIntervals(other)) {
          if (s.operator.trim().toLowerCase() !== operatorName.trim().toLowerCase()) continue;
          if (other.id === job.id && s.start === earliest) continue;
          if (s.end <= earliest && s.end > prevEnd) {
            prevEnd = s.end;
            prevOrder = other.order;
          }
        }
      }
      if (prevEnd > -Infinity) {
        const restHours = (earliest - prevEnd) / 3_600_000;
        if (restHours < 12) conflicts.restViolation = { message: `${restHours.toFixed(1)}h odmora nakon ${prevOrder}` };
      }
    }
  }

  return conflicts;
}
