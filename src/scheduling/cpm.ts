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
}

export function getWorkerRole(operatorName: string): string | null {
  if (!operatorName) return null;
  const normalized = operatorName.trim().toLowerCase();

  try {
    const modernRaw = localStorage.getItem('dravaint-workers-v2');
    if (modernRaw) {
      const workers = JSON.parse(modernRaw) as Array<{ firstName: string; lastName: string; roleName: string }>;
      const found = workers.find((worker) => `${worker.firstName} ${worker.lastName}`.trim().toLowerCase() === normalized);
      if (found) return found.roleName;
    }
    const raw = localStorage.getItem('dravaint-workers-list');
    if (raw) {
      const workers = JSON.parse(raw);
      if (Array.isArray(workers)) {
        const found = workers.find((w) => w.name && w.name.trim().toLowerCase() === normalized);
        if (found) return found.role;
      }
    }
  } catch {}

  const DEFAULT_WORKERS = [
    { name: 'Goran Ć.', role: 'workers' },
    { name: 'Alen M.', role: 'workers' },
    { name: 'Damir M.', role: 'workers' },
    { name: 'Krunoslav S.', role: 'workers' },
    { name: 'Dorian T.', role: 'boss' },
    { name: 'Božidar B.', role: 'managers' },
  ];
  const found = DEFAULT_WORKERS.find((w) => w.name.trim().toLowerCase() === normalized);
  return found ? found.role : null;
}

export function getWorkerQualifications(operatorName: string): string[] {
  try {
    const workers = JSON.parse(localStorage.getItem('dravaint-workers-v2') || '[]') as Array<{ firstName: string; lastName: string; qualifications?: string[] }>;
    const normalized = operatorName.trim().toLowerCase();
    return workers.find((worker) => `${worker.firstName} ${worker.lastName}`.trim().toLowerCase() === normalized)?.qualifications ?? [];
  } catch {
    return [];
  }
}

export function isWorkerQualified(role: string, machine: string): boolean {
  const m = machine.toLowerCase();
  if (m.includes('cnc')) {
    return ['admin', 'boss', 'managers'].includes(role);
  }
  if (m.includes('drill') || m.includes('drilling') || m.includes('bušilic') || m.includes('pila')) {
    return ['workers'].includes(role);
  }
  return true;
}

export function getMonday(d: Date): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

export function calculateWeeklyHours(operator: string, weekMondayStr: string, jobs: Job[]): number {
  if (!operator) return 0;
  const targetMonday = new Date(weekMondayStr);
  const targetSundayEnd = new Date(targetMonday.getTime() + 7 * 24 * 60 * 60 * 1000);

  let total = 0;
  const normalizedOp = operator.trim().toLowerCase();

  for (const job of jobs) {
    if (!job.operator || job.operator.trim() === '' || !job.start || !job.end) continue;
    if (job.operator.trim().toLowerCase() !== normalizedOp) continue;

    const start = new Date(job.start).getTime();
    const end = new Date(job.end).getTime();
    if (isNaN(start) || isNaN(end) || start >= end) continue;

    const overlapStart = Math.max(start, targetMonday.getTime());
    const overlapEnd = Math.min(end, targetSundayEnd.getTime());

    if (overlapStart < overlapEnd) {
      total += (overlapEnd - overlapStart) / 3600000;
    }
  }
  return total;
}

export function checkShiftScheduleConflict(job: Job): boolean {
  if (!job.operator || !job.start || !job.end) return false;

  const start = new Date(job.start).getTime();
  const end = new Date(job.end).getTime();
  if (isNaN(start) || isNaN(end) || start >= end) return false;

  try {
    const shiftData = JSON.parse(localStorage.getItem('dravaint-shifts-v2') || '{}') as {
      definitions?: Array<{ id: number; startTime: string; endTime: string }>;
      schedules?: Array<{ startDate: string; endDate: string; assignments: Array<{ workerId: number; shiftDefinitionId: number; date: string }> }>;
    };
    const workers = JSON.parse(localStorage.getItem('dravaint-workers-v2') || '[]') as Array<{ id: number; firstName: string; lastName: string }>;
    if (shiftData.schedules?.length && shiftData.definitions?.length) {
      const worker = workers.find((item) => `${item.firstName} ${item.lastName}`.trim().toLowerCase() === job.operator.trim().toLowerCase());
      if (!worker) return true;
      const date = job.start.slice(0, 10);
      const schedule = shiftData.schedules.find((item) => date >= item.startDate && date <= item.endDate);
      const assignment = schedule?.assignments.find((item) => item.workerId === worker.id && item.date === date);
      const definition = shiftData.definitions.find((item) => item.id === assignment?.shiftDefinitionId);
      if (!assignment || !definition) return true;
      const allowedStart = new Date(`${date}T${definition.startTime}:00`).getTime();
      const allowedEndDate = new Date(`${date}T${definition.endTime}:00`);
      if (definition.endTime <= definition.startTime) allowedEndDate.setDate(allowedEndDate.getDate() + 1);
      return start < allowedStart || end > allowedEndDate.getTime();
    }
  } catch {
    // Continue with the legacy schedule cache below when migration data is unavailable.
  }

  const raw = localStorage.getItem('dravaint-shift-schedule');
  let weeks: any[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      weeks = parsed.weeks || [];
    } catch {}
  }

  if (weeks.length === 0) {
    const base = 'Božidar B.\nPerica B.\nNenad S.\nToni P.\nIvica B.';
    const always1 = 'Goran Ć.\nAlen M.\nDamir M.\nKrunoslav S.\nDorian T.';
    const g1 = 'Matej B.\nAnthony Đ.';
    const g2 = 'Tihomir M.\nDarko N.\nMatej P.';
    const startWeek = 29;
    const weekCount = 6;
    const startDate = '2026-07-13';

    const rotatingBase = base.split('\n').map((n) => n.trim()).filter((n) => n);
    const alwaysFirst = always1.split('\n').map((n) => n.trim()).filter((n) => n);
    const group1 = g1.split('\n').map((n) => n.trim()).filter((n) => n);
    const group2 = g2.split('\n').map((n) => n.trim()).filter((n) => n);
    const baseWorkersList = [...rotatingBase, ...alwaysFirst];

    let currentDate = new Date(startDate);
    for (let i = 0; i < weekCount; i++) {
      const ind2ShiftWorker = rotatingBase.length ? rotatingBase[i % rotatingBase.length] : '';
      const isGroup1In2nd = i % 2 === 0;

      const pad = (n: number) => (n < 10 ? '0' + n : String(n));
      const dateString = `${pad(currentDate.getDate())}.${pad(currentDate.getMonth() + 1)}.${currentDate.getFullYear()}.`;

      weeks.push({
        weekLabel: startWeek + i,
        dateLabel: dateString,
        firstShift: baseWorkersList.filter((w) => w !== ind2ShiftWorker),
        firstShiftExtra: isGroup1In2nd ? group2 : group1,
        secondShiftWorker: ind2ShiftWorker,
        secondShiftExtra: isGroup1In2nd ? group1 : group2,
      });
      currentDate.setDate(currentDate.getDate() + 7);
    }
  }

  const shiftHours = parseInt(localStorage.getItem('cfg-shift-hours') || '8');
  const normalizedOp = job.operator.trim().toLowerCase();

  let current = new Date(start);
  while (current.getTime() < end) {
    const dayStart = new Date(current);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const overlapStart = Math.max(start, dayStart.getTime());
    const overlapEnd = Math.min(end, dayEnd.getTime());
    if (overlapStart >= overlapEnd) {
      current = dayEnd;
      continue;
    }

    const dayDate = new Date(overlapStart);
    let foundWeek: any = null;

    for (const w of weeks) {
      const match = w.dateLabel.match(/(\d+)\.(\d+)\.(\d+)/);
      if (match) {
        const d = parseInt(match[1]);
        const m = parseInt(match[2]) - 1;
        const y = parseInt(match[3]);
        const weekStart = new Date(y, m, d, 0, 0, 0);
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (dayDate >= weekStart && dayDate < weekEnd) {
          foundWeek = w;
          break;
        }
      }
    }

    if (!foundWeek) {
      return true;
    }

    let shift: 1 | 2 | null = null;
    if (
      foundWeek.firstShift.some((w: string) => w.trim().toLowerCase() === normalizedOp) ||
      foundWeek.firstShiftExtra.some((w: string) => w.trim().toLowerCase() === normalizedOp)
    ) {
      shift = 1;
    } else if (
      (foundWeek.secondShiftWorker && foundWeek.secondShiftWorker.trim().toLowerCase() === normalizedOp) ||
      foundWeek.secondShiftExtra.some((w: string) => w.trim().toLowerCase() === normalizedOp)
    ) {
      shift = 2;
    }

    if (shift === null) {
      return true;
    }

    const dayOfWeek = dayDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return true;
    }

    let shiftStart: number;
    let shiftEnd: number;
    if (shift === 1) {
      shiftStart = dayStart.getTime() + 6 * 3600000;
      shiftEnd = shiftStart + shiftHours * 3600000;
    } else {
      shiftStart = dayStart.getTime() + (6 + shiftHours) * 3600000;
      shiftEnd = shiftStart + shiftHours * 3600000;
    }

    if (overlapStart < shiftStart || overlapEnd > shiftEnd) {
      return true;
    }

    current = dayEnd;
  }

  return false;
}

export function getJobConflicts(job: Job, allJobs: Job[]): JobConflicts {
  const conflicts: JobConflicts = {};

  if (!job.start || !job.end || job.status === 'done') return conflicts;
  const currentStart = new Date(job.start).getTime();
  const currentEnd = new Date(job.end).getTime();
  if (isNaN(currentStart) || isNaN(currentEnd) || currentStart >= currentEnd) return conflicts;

  const hasChildren = (id: number) => allJobs.some((j) => j.parentId === id);
  const leafJobs = allJobs.filter((j) => !hasChildren(j.id));

  for (const other of leafJobs) {
    if (other.id === job.id || other.status === 'done' || !other.start || !other.end) continue;
    const otherStart = new Date(other.start).getTime();
    const otherEnd = new Date(other.end).getTime();
    if (isNaN(otherStart) || isNaN(otherEnd) || otherStart >= otherEnd) continue;

    const overlaps = currentStart < otherEnd && otherStart < currentEnd;
    if (overlaps) {
      if (job.machine && other.machine && job.machine === other.machine) {
        conflicts.machineOverlap = { otherOrder: other.order };
      }
      if (
        job.operator &&
        other.operator &&
        job.operator.trim() !== '' &&
        job.operator.trim().toLowerCase() === other.operator.trim().toLowerCase()
      ) {
        conflicts.operatorOverlap = { otherOrder: other.order };
      }
    }
  }

  if (job.operator && job.operator.trim() !== '') {
    const role = getWorkerRole(job.operator);
    if (role) {
      const qualifications = getWorkerQualifications(job.operator);
      const qualified = qualifications.length ? job.machine.split('→').map((part) => part.trim()).every((machine) => qualifications.includes(machine) || machine.toLowerCase().includes('kontrola')) : isWorkerQualified(role, job.machine);
      if (!qualified) {
        conflicts.unqualified = { message: `Role '${role}' is not qualified for machine '${job.machine}'` };
      }
    }

    if (checkShiftScheduleConflict(job)) {
      conflicts.shiftOutside = { message: `Outside assigned shift schedule` };
    }

    const maxHoursLimit = parseFloat(localStorage.getItem('cfg-max-hours') || '48');
    const mondayStr = getMonday(new Date(job.start));
    const weeklyHours = calculateWeeklyHours(job.operator, mondayStr, leafJobs);
    if (weeklyHours > maxHoursLimit) {
      conflicts.hoursExceeded = { message: `${weeklyHours.toFixed(1)}h / limit ${maxHoursLimit}h` };
    }

    const nearestPrevious = leafJobs
      .filter((other) => other.id !== job.id && other.operator.trim().toLowerCase() === job.operator.trim().toLowerCase() && other.end && new Date(other.end).getTime() <= currentStart)
      .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())[0];
    if (nearestPrevious) {
      const restHours = (currentStart - new Date(nearestPrevious.end).getTime()) / 3_600_000;
      if (restHours < 12) conflicts.restViolation = { message: `${restHours.toFixed(1)}h rest after ${nearestPrevious.order}` };
    }
  }

  return conflicts;
}
