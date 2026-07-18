import { describe, expect, it } from 'vitest';
import type { Job } from '../../scheduling/SchedulingContext';
import {
  buildMobileGanttModel,
  matchesSpotlight,
  isSpotlightActive,
  stepZoom,
  nearestZoomPreset,
  proposeTimes,
  MOBILE_ZOOM_PX_PER_HOUR,
  type SpotlightFilter,
} from './ganttMobileData';

function makeJob(overrides: Partial<Job> & { id: number }): Job {
  return {
    machine: 'CNC-1',
    order: `RN-${overrides.id}`,
    operator: '',
    start: '2026-07-13T06:00',
    end: '2026-07-13T14:00',
    status: 'planned',
    progress: 0,
    color: '#123456',
    ...overrides,
  };
}

describe('buildMobileGanttModel', () => {
  it('groups leaf jobs into machine sections sorted by start', () => {
    const jobs = [
      makeJob({ id: 1, machine: 'CNC-1', start: '2026-07-14T06:00', end: '2026-07-14T14:00' }),
      makeJob({ id: 2, machine: 'CNC-1', start: '2026-07-13T06:00', end: '2026-07-13T14:00' }),
      makeJob({ id: 3, machine: 'CNC-2' }),
    ];
    const model = buildMobileGanttModel(jobs, []);
    const cnc1 = model.sections.find((section) => section.machine === 'CNC-1')!;
    expect(cnc1.items.map((item) => item.job.id)).toEqual([2, 1]);
    expect(model.sections.find((section) => section.machine === 'CNC-2')!.items).toHaveLength(1);
  });

  it('excludes parent/container jobs but keeps their children', () => {
    const jobs = [
      makeJob({ id: 10 }),
      makeJob({ id: 11, parentId: 10 }),
    ];
    const model = buildMobileGanttModel(jobs, []);
    const ids = model.sections.flatMap((section) => section.items.map((item) => item.job.id));
    expect(ids).toEqual([11]);
  });

  it('places a machine-chain job in every machine of its chain', () => {
    const jobs = [makeJob({ id: 1, machine: 'Tokarilica-1 → CNC-2' })];
    const model = buildMobileGanttModel(jobs, []);
    expect(model.sections.map((section) => section.machine).sort()).toEqual(['CNC-2', 'Tokarilica-1']);
    model.sections.forEach((section) => expect(section.items).toHaveLength(1));
  });

  it('stacks time-overlapping jobs on separate rows', () => {
    const jobs = [
      makeJob({ id: 1, start: '2026-07-13T06:00', end: '2026-07-13T14:00' }),
      makeJob({ id: 2, start: '2026-07-13T10:00', end: '2026-07-13T18:00' }),
    ];
    const model = buildMobileGanttModel(jobs, []);
    const section = model.sections.find((item) => item.machine === 'CNC-1')!;
    expect(section.rowCount).toBe(2);
    expect(new Set(section.items.map((item) => item.row)).size).toBe(2);
  });

  it('pads the horizon around the schedule and handles the empty case', () => {
    const jobs = [makeJob({ id: 1 })];
    const model = buildMobileGanttModel(jobs, []);
    expect(model.originMs).toBeLessThan(new Date('2026-07-13T06:00').getTime());
    expect(model.horizonEndMs).toBeGreaterThan(new Date('2026-07-13T14:00').getTime());

    const empty = buildMobileGanttModel([], []);
    expect(empty.sections.map((section) => section.machine)).toEqual(['General / Unassigned']);
    expect(empty.horizonEndMs).toBeGreaterThan(empty.originMs);
  });

  it('derives routed-order windows from the operation route per machine', () => {
    const jobs = [makeJob({
      id: 1,
      machine: '',
      start: '2026-07-13T06:00',
      end: '2026-07-13T06:00', // routing orders often store end == start
      operations: [
        { id: 1, name: 'Turning', machine: 'Tokarilica-1', hours: 4 },
        { id: 2, name: 'Milling', machine: 'CNC-2', hours: 6 },
      ],
    })];
    const model = buildMobileGanttModel(jobs, []);
    const lathe = model.sections.find((section) => section.machine === 'Tokarilica-1')!.items[0];
    const mill = model.sections.find((section) => section.machine === 'CNC-2')!.items[0];
    expect(lathe.routed).toBe(true);
    expect(lathe.effectiveStart).toBe(new Date('2026-07-13T06:00').getTime());
    expect(lathe.effectiveEnd).toBe(new Date('2026-07-13T10:00').getTime());
    expect(mill.effectiveStart).toBe(new Date('2026-07-13T10:00').getTime());
    expect(mill.effectiveEnd).toBe(new Date('2026-07-13T16:00').getTime());
  });

  it('marks dependency-linked jobs and counts links', () => {
    const jobs = [
      makeJob({ id: 1 }),
      makeJob({ id: 2, machine: 'CNC-2', start: '2026-07-13T14:00', end: '2026-07-13T18:00', dependencies: [{ jobId: 1, type: 'FS', lagHours: 0 }] }),
    ];
    const model = buildMobileGanttModel(jobs, []);
    const successor = model.sections.flatMap((section) => section.items).find((item) => item.job.id === 2)!;
    expect(successor.dependencyCount).toBe(1);
    expect(model.criticalIds.size).toBeGreaterThan(0);
  });
});

describe('matchesSpotlight', () => {
  const item = {
    job: makeJob({ id: 1, order: 'RN-2041', operator: 'Ivan', status: 'delayed', materialStatus: 'waiting' }),
    effectiveStart: 0,
    effectiveEnd: 1,
    row: 0,
    routed: false,
    critical: false,
    slackMs: 0,
    dependencyCount: 0,
  };

  const filter = (search: string, ...chips: SpotlightFilter['chips'] extends Set<infer C> ? C[] : never): SpotlightFilter => ({
    search,
    chips: new Set(chips),
  });

  it('matches on search text across order/operator/machine', () => {
    expect(matchesSpotlight(item, filter('2041'))).toBe(true);
    expect(matchesSpotlight(item, filter('ivan'))).toBe(true);
    expect(matchesSpotlight(item, filter('nope'))).toBe(false);
  });

  it('applies chips: critical, delayed, material', () => {
    expect(matchesSpotlight(item, filter('', 'critical'))).toBe(false);
    expect(matchesSpotlight({ ...item, critical: true }, filter('', 'critical'))).toBe(true);
    expect(matchesSpotlight(item, filter('', 'delayed'))).toBe(true);
    expect(matchesSpotlight(item, filter('', 'material'))).toBe(true);
    expect(matchesSpotlight({ ...item, job: { ...item.job, materialStatus: 'ready' } }, filter('', 'material'))).toBe(false);
  });

  it('reports whether a spotlight is active', () => {
    expect(isSpotlightActive(filter(''))).toBe(false);
    expect(isSpotlightActive(filter(' x '))).toBe(true);
    expect(isSpotlightActive(filter('', 'delayed'))).toBe(true);
  });
});

describe('zoom stepping', () => {
  it('steps out and in through the presets', () => {
    expect(stepZoom(MOBILE_ZOOM_PX_PER_HOUR.day, 1)).toBe(MOBILE_ZOOM_PX_PER_HOUR.week);
    expect(stepZoom(MOBILE_ZOOM_PX_PER_HOUR.day, -1)).toBe(MOBILE_ZOOM_PX_PER_HOUR.shift);
    expect(stepZoom(MOBILE_ZOOM_PX_PER_HOUR.month, 1)).toBe(MOBILE_ZOOM_PX_PER_HOUR.month);
    expect(stepZoom(MOBILE_ZOOM_PX_PER_HOUR.hour, -1)).toBe(MOBILE_ZOOM_PX_PER_HOUR.hour);
  });

  it('steps from in-between pinch values to the next preset', () => {
    expect(stepZoom(20, 1)).toBe(MOBILE_ZOOM_PX_PER_HOUR.day);
    expect(stepZoom(20, -1)).toBe(MOBILE_ZOOM_PX_PER_HOUR.shift);
  });

  it('names the nearest preset', () => {
    expect(nearestZoomPreset(MOBILE_ZOOM_PX_PER_HOUR.shift)).toBe('shift');
    expect(nearestZoomPreset(17)).toBe('day');
  });
});

describe('proposeTimes', () => {
  const job = { start: '2026-07-13T06:00', end: '2026-07-13T14:00' };
  const options = { snap: true, workdayStart: 6, workdayEnd: 22 };

  it('moves preserving duration and snapping to shift boundaries', () => {
    const proposed = proposeTimes(job, 'move', 7.6 * 3_600_000, options);
    expect(proposed.start).toBe('2026-07-13T14:00');
    expect(proposed.end).toBe('2026-07-13T22:00');
  });

  it('skips snapping when disabled (hour zoom)', () => {
    const proposed = proposeTimes(job, 'move', 30 * 60_000, { ...options, snap: false });
    expect(proposed.start).toBe('2026-07-13T06:30');
    expect(proposed.end).toBe('2026-07-13T14:30');
  });

  it('resizes a single edge and enforces a minimum duration', () => {
    const end = proposeTimes(job, 'resize-end', -2 * 3_600_000, { ...options, snap: false });
    expect(end.start).toBe('2026-07-13T06:00');
    expect(end.end).toBe('2026-07-13T12:00');

    const collapsed = proposeTimes(job, 'resize-end', -9 * 3_600_000, { ...options, snap: false });
    expect(collapsed.endMs - collapsed.startMs).toBe(15 * 60_000);

    const start = proposeTimes(job, 'resize-start', 60 * 60_000, { ...options, snap: false });
    expect(start.start).toBe('2026-07-13T07:00');
    expect(start.end).toBe('2026-07-13T14:00');
  });
});
