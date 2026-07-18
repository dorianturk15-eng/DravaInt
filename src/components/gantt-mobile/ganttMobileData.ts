import type { Job } from '../../scheduling/SchedulingContext';
import type { Machine } from '../../machines/MachinesContext';
import {
  computeCriticalPath,
  computeEffectiveSchedule,
  computeScheduleSlack,
  jobsToScheduleInput,
  splitMachineChain,
  toLocalDateTimeString,
  type SchedulingOptions,
} from '../../scheduling/cpm';
import { computeOperationSchedule, hasChildren } from '../../scheduling/hierarchy';
import { snapToShiftBoundary } from '../../scheduling/boardGeometry';

/* ---------------------------------------------------------------- model --- */

export interface MobileJobItem {
  job: Job;
  effectiveStart: number;
  effectiveEnd: number;
  /** Sub-row inside the machine lane so time-overlapping bars stack instead of occluding. */
  row: number;
  /** True for multi-operation routing orders: their duration comes from the operation route, and
   *  the item's times are the window of this machine's operations within that route. */
  routed: boolean;
  critical: boolean;
  slackMs: number;
  dependencyCount: number;
}

export interface MobileMachineSection {
  machine: string;
  items: MobileJobItem[];
  rowCount: number;
  /** Busy hours ÷ section span, same definition as the desktop lane efficiency meter. */
  loadPercent: number;
}

export interface MobileGanttModel {
  sections: MobileMachineSection[];
  criticalIds: Set<number>;
  /** Overall horizon of the schedule (padded), for the timeline canvas + date scrubber. */
  originMs: number;
  horizonEndMs: number;
}

/** Greedy interval-graph row assignment (same approach as the machine board). */
function assignRows(items: Array<{ effectiveStart: number; effectiveEnd: number }>): number[] {
  const rowEndTimes: number[] = [];
  return items.map((item) => {
    let row = rowEndTimes.findIndex((endTime) => endTime <= item.effectiveStart);
    if (row === -1) {
      row = rowEndTimes.length;
      rowEndTimes.push(item.effectiveEnd);
    } else {
      rowEndTimes[row] = item.effectiveEnd;
    }
    return row;
  });
}

function jobBelongsToMachine(job: Job, machineName: string): boolean {
  if (job.machine && splitMachineChain(job.machine).includes(machineName)) return true;
  return job.operations?.some((op) => op.machine.trim() === machineName) ?? false;
}

const DAY_MS = 86_400_000;

/**
 * Shapes jobs into per-machine sections for the phone agenda and compact timeline.
 * Only leaf schedulable jobs are listed (container/parent orders group their children in the
 * desktop hierarchy view; on a phone the planner wants the concrete runnable work).
 */
export function buildMobileGanttModel(
  jobs: Job[],
  machines: Machine[],
  options: SchedulingOptions & { criticalToleranceMs?: number } = {},
): MobileGanttModel {
  const leafJobs = jobs.filter((job) => job.start && job.end && !hasChildren(jobs, job.id));
  const input = jobsToScheduleInput(leafJobs);
  const effective = computeEffectiveSchedule(input, options);
  const slack = computeScheduleSlack(input, effective);
  const criticalIds = computeCriticalPath(input, effective, options.criticalToleranceMs);

  const names = new Set<string>();
  machines.forEach((machine) => names.add(machine.name));
  leafJobs.forEach((job) => {
    splitMachineChain(job.machine).forEach((name) => names.add(name));
    job.operations?.forEach((op) => {
      if (op.machine.trim()) names.add(op.machine.trim());
    });
  });
  if (names.size === 0) names.add('General / Unassigned');

  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;

  const sections: MobileMachineSection[] = Array.from(names).map((machine) => {
    const laneItems = leafJobs
      .filter((job) => jobBelongsToMachine(job, machine))
      .map((job) => {
        const eff = effective.get(job.id);
        let effectiveStart = eff?.start ?? new Date(job.start).getTime();
        let effectiveEnd = eff?.end ?? new Date(job.end).getTime();
        const routed = Boolean(job.operations && job.operations.length > 0);
        if (routed) {
          // Routing orders often store end == start; the route (ops chained from job.start,
          // same as the desktop's computeOperationSchedule) is the real duration. When this
          // machine runs specific operations, show that window rather than the whole route.
          const schedule = computeOperationSchedule(job);
          effectiveEnd = Math.max(effectiveEnd, schedule[schedule.length - 1].end.getTime());
          const mine = schedule.filter((entry) => entry.op.machine.trim() === machine);
          if (mine.length > 0) {
            effectiveStart = mine[0].start.getTime();
            effectiveEnd = mine[mine.length - 1].end.getTime();
          }
        }
        return {
          job,
          effectiveStart,
          effectiveEnd,
          row: 0,
          routed,
          critical: criticalIds.has(job.id),
          slackMs: slack.get(job.id) ?? 0,
          dependencyCount: job.dependencies?.length ?? 0,
        };
      })
      .sort((a, b) => a.effectiveStart - b.effectiveStart);

    const rows = assignRows(laneItems);
    laneItems.forEach((item, index) => {
      item.row = rows[index];
      if (item.effectiveStart < minStart) minStart = item.effectiveStart;
      if (item.effectiveEnd > maxEnd) maxEnd = item.effectiveEnd;
    });

    let loadPercent = 0;
    if (laneItems.length > 0) {
      const spanStart = Math.min(...laneItems.map((item) => item.effectiveStart));
      const spanEnd = Math.max(...laneItems.map((item) => item.effectiveEnd));
      const busy = laneItems.reduce((sum, item) => sum + Math.max(0, item.effectiveEnd - item.effectiveStart), 0);
      loadPercent = spanEnd > spanStart ? Math.min(100, Math.round((busy / (spanEnd - spanStart)) * 100)) : 0;
    }

    return {
      machine,
      items: laneItems,
      rowCount: Math.max(1, ...rows.map((row) => row + 1)),
      loadPercent,
    };
  });

  if (!Number.isFinite(minStart)) {
    const now = Date.now();
    minStart = now;
    maxEnd = now + DAY_MS;
  }

  // Pad the horizon to whole days so bars never sit flush against the canvas edge.
  const origin = new Date(minStart - DAY_MS);
  origin.setHours(0, 0, 0, 0);
  const horizonEnd = new Date(maxEnd + DAY_MS);
  horizonEnd.setHours(23, 59, 59, 0);

  return { sections, criticalIds, originMs: origin.getTime(), horizonEndMs: horizonEnd.getTime() };
}

/* --------------------------------------------------- quick-filter spotlight --- */

export type SpotlightChip = 'critical' | 'delayed' | 'material';

export interface SpotlightFilter {
  search: string;
  chips: Set<SpotlightChip>;
}

/** Spotlight semantics: matching items render normally, non-matching are dimmed in place. */
export function matchesSpotlight(item: MobileJobItem, filter: SpotlightFilter): boolean {
  const { job } = item;
  const search = filter.search.trim().toLowerCase();
  if (search && !`${job.order} ${job.operator} ${job.product ?? ''} ${job.machine}`.toLowerCase().includes(search)) {
    return false;
  }
  if (filter.chips.has('critical') && !item.critical) return false;
  if (filter.chips.has('delayed') && job.status !== 'delayed') return false;
  if (filter.chips.has('material') && (job.materialStatus ?? 'ready') === 'ready') return false;
  return true;
}

export function isSpotlightActive(filter: SpotlightFilter): boolean {
  return filter.search.trim().length > 0 || filter.chips.size > 0;
}

/* ----------------------------------------------------------------- zoom --- */

export type MobileZoom = 'hour' | 'shift' | 'day' | 'week' | 'month';

export const MOBILE_ZOOM_ORDER: MobileZoom[] = ['hour', 'shift', 'day', 'week', 'month'];

/** Pixels per hour of timeline at each step-zoom preset. */
export const MOBILE_ZOOM_PX_PER_HOUR: Record<MobileZoom, number> = {
  hour: 96,
  shift: 40,
  day: 15,
  week: 5,
  month: 1.5,
};

export const MIN_PX_PER_HOUR = 1;
export const MAX_PX_PER_HOUR = 140;

/** Steps the [−]/[+] zoom buttons: direction +1 zooms out (coarser), −1 zooms in (finer). */
export function stepZoom(pxPerHour: number, direction: 1 | -1): number {
  if (direction === 1) {
    for (const zoom of MOBILE_ZOOM_ORDER) {
      const preset = MOBILE_ZOOM_PX_PER_HOUR[zoom];
      if (preset < pxPerHour - 0.01) return preset;
    }
    return MOBILE_ZOOM_PX_PER_HOUR.month;
  }
  for (const zoom of [...MOBILE_ZOOM_ORDER].reverse()) {
    const preset = MOBILE_ZOOM_PX_PER_HOUR[zoom];
    if (preset > pxPerHour + 0.01) return preset;
  }
  return MOBILE_ZOOM_PX_PER_HOUR.hour;
}

/** Names the nearest preset for the zoom label (pinch produces in-between values). */
export function nearestZoomPreset(pxPerHour: number): MobileZoom {
  let best: MobileZoom = 'day';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const zoom of MOBILE_ZOOM_ORDER) {
    const distance = Math.abs(Math.log(MOBILE_ZOOM_PX_PER_HOUR[zoom]) - Math.log(pxPerHour));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = zoom;
    }
  }
  return best;
}

/* ------------------------------------------------------- drag proposals --- */

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export interface ProposedTimes {
  start: string;
  end: string;
  startMs: number;
  endMs: number;
}

const MIN_DURATION_MS = 15 * 60_000;

/**
 * Turns a live drag delta into proposed job times. Snapping to shift boundaries mirrors the
 * desktop drop behaviour (and boardGeometry.snapToShiftBoundary), but is skipped at hour zoom
 * where the planner is deliberately working fine-grained — same rule as the desktop chart.
 */
export function proposeTimes(
  job: Pick<Job, 'start' | 'end'>,
  mode: DragMode,
  deltaMs: number,
  options: { snap: boolean; workdayStart: number; workdayEnd: number },
): ProposedTimes {
  const startMs = new Date(job.start).getTime();
  const endMs = new Date(job.end).getTime();
  const snap = (ms: number) => (options.snap ? snapToShiftBoundary(ms, options.workdayStart, options.workdayEnd) : ms);

  let nextStart = startMs;
  let nextEnd = endMs;
  if (mode === 'move') {
    nextStart = snap(startMs + deltaMs);
    nextEnd = nextStart + (endMs - startMs);
  } else if (mode === 'resize-start') {
    nextStart = Math.min(snap(startMs + deltaMs), endMs - MIN_DURATION_MS);
  } else {
    nextEnd = Math.max(snap(endMs + deltaMs), startMs + MIN_DURATION_MS);
  }

  return {
    start: toLocalDateTimeString(new Date(nextStart)),
    end: toLocalDateTimeString(new Date(nextEnd)),
    startMs: nextStart,
    endMs: nextEnd,
  };
}

export function formatTimeRange(startMs: number, endMs: number, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
  return `${new Date(startMs).toLocaleString(locale, opts)} → ${new Date(endMs).toLocaleString(locale, opts)}`;
}
