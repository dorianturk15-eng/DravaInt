import { describe, expect, it } from 'vitest';
import type { DependencyType } from './SchedulingContext';
import {
  timeToX,
  xToTime,
  snapToShiftBoundary,
  buildConnectorPath,
  inferDependencyType,
  edgesForDependencyType,
  pointInRect,
  cardEdgeAnchor,
  buildTimeBands,
  clippedHours,
} from './boardGeometry';

const ALL_DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

describe('board time-axis geometry', () => {
  it('round-trips timeToX/xToTime', () => {
    const origin = new Date('2026-07-13T00:00:00').getTime();
    const ms = new Date('2026-07-14T09:30:00').getTime();
    const x = timeToX(ms, origin, 24);
    expect(xToTime(x, origin, 24)).toBe(ms);
  });

  it('snaps to the nearest of workdayStart, workdayStart+8, or workdayEnd on the same day', () => {
    const base = new Date('2026-07-13T00:00:00').getTime();
    const near16 = base + 16 * 3_600_000;
    const snapped = new Date(snapToShiftBoundary(near16, 6, 22));
    // candidates are 6, 14, 22 — 16 is closest to 14
    expect(snapped.getHours()).toBe(14);
    expect(snapped.getDate()).toBe(13);
  });
});

describe('time bands + clipped load', () => {
  it('emits two off-shift bands per working day and one full band per weekend day', () => {
    // Monday 00:00 origin, one working day (Mon) + shading; workday 06:00–22:00.
    const origin = new Date('2026-07-13T00:00:00').getTime(); // 2026-07-13 is a Monday
    const bands = buildTimeBands(origin, 24, 24, 6, 22, []);
    const offshift = bands.filter((b) => b.kind === 'offshift');
    expect(offshift).toHaveLength(2); // pre-06:00 and post-22:00
  });

  it('shades a whole weekend day and honours holidays', () => {
    const saturday = new Date('2026-07-18T00:00:00').getTime(); // Saturday
    const bands = buildTimeBands(saturday, 24, 24, 6, 22, []);
    expect(bands.some((b) => b.kind === 'weekend')).toBe(true);
    const workday = new Date('2026-07-13T00:00:00').getTime();
    const withHoliday = buildTimeBands(workday, 24, 24, 6, 22, ['2026-07-13']);
    expect(withHoliday.some((b) => b.kind === 'holiday')).toBe(true);
  });

  it('clips hours to a window (the window-aware load basis)', () => {
    const H = 3_600_000;
    const win = { start: 0, end: 10 * H };
    // one slot fully inside (4h), one straddling the end (only 2h count).
    const hours = clippedHours([{ startMs: 0, endMs: 4 * H }, { startMs: 8 * H, endMs: 14 * H }], win.start, win.end);
    expect(hours).toBe(6);
  });
});

describe('connector geometry', () => {
  it('builds a cubic-bezier path anchored at the given points', () => {
    const path = buildConnectorPath({ x: 0, y: 10 }, { x: 100, y: 50 });
    expect(path.startsWith('M 0 10 C')).toBe(true);
    expect(path.endsWith('100 50')).toBe(true);
  });

  it('is the exact inverse of edgesForDependencyType for every dependency type', () => {
    for (const type of ALL_DEPENDENCY_TYPES) {
      const { sourceEdge, targetEdge } = edgesForDependencyType(type);
      expect(inferDependencyType(sourceEdge, targetEdge)).toBe(type);
    }
  });

  it('anchors a card edge at its left or right center', () => {
    const rect = { x: 10, y: 20, width: 100, height: 40 };
    expect(cardEdgeAnchor(rect, 'start')).toEqual({ x: 10, y: 40 });
    expect(cardEdgeAnchor(rect, 'end')).toEqual({ x: 110, y: 40 });
  });

  it('hit-tests a point against a rect with optional tolerance', () => {
    const rect = { x: 0, y: 0, width: 50, height: 20 };
    expect(pointInRect(60, 10, rect)).toBe(false);
    expect(pointInRect(60, 10, rect, 15)).toBe(true);
  });
});
