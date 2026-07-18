import { describe, expect, it } from 'vitest';
import type { GanttTask } from './types';
import {
  COLUMN_WIDTHS,
  buildHeaderCells,
  dateForX,
  findOverlaps,
  getGanttDateRange,
  seedDates,
  xForDate,
} from './timescale';

function task(id: string, start: string, end: string, type: GanttTask['type'] = 'task'): GanttTask {
  return { id, type, name: id, start: new Date(start), end: new Date(end), progress: 0 };
}

describe('getGanttDateRange', () => {
  it('pads a day-mode range one day before the earliest start and 19 days past the latest end', () => {
    const [start, end] = getGanttDateRange(
      [task('a', '2026-07-14T08:00', '2026-07-15T16:00'), task('b', '2026-07-16T06:00', '2026-07-17T14:00')],
      'day',
    );
    expect(start).toEqual(new Date('2026-07-13T00:00'));
    expect(end).toEqual(new Date('2026-08-05T00:00'));
  });

  it('starts week mode on the Monday a week before the earliest task', () => {
    const [start] = getGanttDateRange([task('a', '2026-07-16T08:00', '2026-07-17T16:00')], 'week');
    expect(start).toEqual(new Date('2026-07-06T00:00'));
    expect(start.getDay()).toBe(1);
  });

  it('returns an empty range for no tasks', () => {
    const [start, end] = getGanttDateRange([], 'day');
    expect(end.getTime() - start.getTime()).toBeLessThan(1000);
  });
});

describe('seedDates', () => {
  it('steps one day at a time in day mode', () => {
    const dates = seedDates(new Date('2026-07-13T00:00'), new Date('2026-07-16T00:00'), 'day');
    expect(dates).toHaveLength(4);
    expect(dates[1]).toEqual(new Date('2026-07-14T00:00'));
  });

  it('steps twelve hours in shift mode', () => {
    const dates = seedDates(new Date('2026-07-13T00:00'), new Date('2026-07-14T00:00'), 'shift');
    expect(dates.map((d) => d.getHours())).toEqual([0, 12, 0]);
  });

  it('steps whole months in month mode', () => {
    const dates = seedDates(new Date('2026-06-01T00:00'), new Date('2026-09-01T00:00'), 'month');
    expect(dates).toHaveLength(4);
    expect(dates[2]).toEqual(new Date('2026-08-01T00:00'));
  });
});

describe('xForDate / dateForX', () => {
  const dates = seedDates(new Date('2026-07-13T00:00'), new Date('2026-07-20T00:00'), 'day');
  const cw = COLUMN_WIDTHS.day;

  it('places a date proportionally inside its column', () => {
    expect(xForDate(new Date('2026-07-13T00:00'), dates, cw)).toBe(0);
    expect(xForDate(new Date('2026-07-14T12:00'), dates, cw)).toBeCloseTo(cw * 1.5);
  });

  it('clamps dates outside the range', () => {
    expect(xForDate(new Date('2026-07-01T00:00'), dates, cw)).toBe(0);
    expect(xForDate(new Date('2026-08-01T00:00'), dates, cw)).toBe((dates.length - 1) * cw);
  });

  it('is the inverse of xForDate within the range', () => {
    const original = new Date('2026-07-15T09:30');
    const x = xForDate(original, dates, cw);
    expect(dateForX(x, dates, cw).getTime()).toBeCloseTo(original.getTime(), -3);
  });

  it('clamps x outside the chart', () => {
    expect(dateForX(-50, dates, cw)).toEqual(dates[0]);
    expect(dateForX(1e9, dates, cw)).toEqual(dates[dates.length - 1]);
  });
});

describe('buildHeaderCells', () => {
  it('emits one bottom tick per column and groups the top row by month in day mode', () => {
    const dates = seedDates(new Date('2026-07-30T00:00'), new Date('2026-08-03T00:00'), 'day');
    const { top, bottom } = buildHeaderCells(dates, 65, 'day', 'en-US');
    expect(bottom).toHaveLength(dates.length - 1);
    expect(top).toHaveLength(2); // July + August
    expect(top[0].label).toMatch(/July/);
    expect(top[0].width + top[1].width).toBe((dates.length - 1) * 65);
  });

  it('groups by day for hour mode', () => {
    const dates = seedDates(new Date('2026-07-14T22:00'), new Date('2026-07-15T02:00'), 'hour');
    const { top } = buildHeaderCells(dates, 65, 'hour', 'en-US');
    expect(top).toHaveLength(2);
  });
});

describe('findOverlaps', () => {
  it('detects and merges overlapping task windows', () => {
    const overlaps = findOverlaps([
      task('a', '2026-07-14T08:00', '2026-07-14T12:00'),
      task('b', '2026-07-14T10:00', '2026-07-14T14:00'),
      task('c', '2026-07-14T13:00', '2026-07-14T16:00'),
    ]);
    expect(overlaps).toHaveLength(2);
    expect(overlaps[0].start).toEqual(new Date('2026-07-14T10:00'));
    expect(overlaps[0].end).toEqual(new Date('2026-07-14T12:00'));
    expect(overlaps[1].start).toEqual(new Date('2026-07-14T13:00'));
  });

  it('ignores project and milestone rows', () => {
    const overlaps = findOverlaps([
      task('a', '2026-07-14T08:00', '2026-07-14T12:00'),
      task('p', '2026-07-14T08:00', '2026-07-14T12:00', 'project'),
    ]);
    expect(overlaps).toHaveLength(0);
  });

  it('returns nothing when tasks touch but do not overlap', () => {
    const overlaps = findOverlaps([
      task('a', '2026-07-14T08:00', '2026-07-14T12:00'),
      task('b', '2026-07-14T12:00', '2026-07-14T16:00'),
    ]);
    expect(overlaps).toHaveLength(0);
  });
});
