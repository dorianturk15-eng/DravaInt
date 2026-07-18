import type { GanttTask, GanttViewMode } from './types';

/** Column widths per zoom preset — same values the gantt-task-react setup used. */
export const COLUMN_WIDTHS: Record<GanttViewMode, number> = {
  hour: 65,
  shift: 100,
  day: 65,
  week: 250,
  month: 300,
};

function addToDate(date: Date, quantity: number, scale: 'year' | 'month' | 'day' | 'hour' | 'minute'): Date {
  return new Date(
    date.getFullYear() + (scale === 'year' ? quantity : 0),
    date.getMonth() + (scale === 'month' ? quantity : 0),
    date.getDate() + (scale === 'day' ? quantity : 0),
    date.getHours() + (scale === 'hour' ? quantity : 0),
    date.getMinutes() + (scale === 'minute' ? quantity : 0),
  );
}

function startOfDate(date: Date, scale: 'hour' | 'day' | 'month' | 'year'): Date {
  const scores = ['hour', 'day', 'month', 'year'];
  const shouldReset = (unit: string) => scores.indexOf(unit) <= scores.indexOf(scale);
  return new Date(
    date.getFullYear(),
    shouldReset('year') ? 0 : date.getMonth(),
    shouldReset('month') ? 1 : date.getDate(),
    shouldReset('day') ? 0 : date.getHours(),
    shouldReset('hour') ? 0 : date.getMinutes(),
  );
}

function getMonday(date: Date): Date {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(new Date(date).setDate(diff));
}

/**
 * The chart's overall [start, end] window for a task set at a zoom level — a direct port of the
 * padding rules the old gantt-task-react setup used, so the visible horizon doesn't change.
 */
export function getGanttDateRange(tasks: GanttTask[], viewMode: GanttViewMode): [Date, Date] {
  if (tasks.length === 0) return [new Date(), new Date()];

  let newStartDate = new Date(tasks[0].start);
  let newEndDate = new Date(tasks[0].end);
  for (const task of tasks) {
    if (task.start < newStartDate) newStartDate = new Date(task.start);
    if (task.end > newEndDate) newEndDate = new Date(task.end);
  }

  switch (viewMode) {
    case 'month':
      newStartDate = startOfDate(addToDate(newStartDate, -1, 'month'), 'month');
      newEndDate = startOfDate(addToDate(newEndDate, 1, 'year'), 'year');
      break;
    case 'week':
      newStartDate = addToDate(getMonday(startOfDate(newStartDate, 'day')), -7, 'day');
      newEndDate = addToDate(startOfDate(newEndDate, 'day'), 1, 'month');
      break;
    case 'day':
      newStartDate = addToDate(startOfDate(newStartDate, 'day'), -1, 'day');
      newEndDate = addToDate(startOfDate(newEndDate, 'day'), 19, 'day');
      break;
    case 'shift':
      newStartDate = addToDate(startOfDate(newStartDate, 'day'), -1, 'day');
      newEndDate = addToDate(startOfDate(newEndDate, 'day'), 108, 'hour');
      break;
    case 'hour':
      newStartDate = addToDate(startOfDate(newStartDate, 'hour'), -1, 'hour');
      newEndDate = addToDate(startOfDate(newEndDate, 'day'), 1, 'day');
      break;
  }
  return [newStartDate, newEndDate];
}

/** Column boundary dates from start to end (inclusive of the first boundary past end). */
export function seedDates(startDate: Date, endDate: Date, viewMode: GanttViewMode): Date[] {
  let currentDate = new Date(startDate);
  const dates = [currentDate];
  while (currentDate < endDate) {
    switch (viewMode) {
      case 'month':
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, currentDate.getDate(), currentDate.getHours());
        break;
      case 'week':
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 7, currentDate.getHours());
        break;
      case 'day':
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1, currentDate.getHours());
        break;
      case 'shift':
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), currentDate.getHours() + 12);
        break;
      case 'hour':
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), currentDate.getHours() + 1);
        break;
    }
    dates.push(currentDate);
  }
  return dates;
}

/** time → x pixel offset within the chart, interpolating inside (possibly non-uniform) columns. */
export function xForDate(date: Date, dates: Date[], columnWidth: number): number {
  if (dates.length < 2) return 0;
  const time = date.getTime();
  const index = dates.findIndex((d) => d.getTime() >= time) - 1;
  if (index < 0 || index >= dates.length - 1) {
    if (time <= dates[0].getTime()) return 0;
    return (dates.length - 1) * columnWidth;
  }
  const remainderMillis = time - dates[index].getTime();
  const intervalMillis = dates[index + 1].getTime() - dates[index].getTime();
  return index * columnWidth + (remainderMillis / intervalMillis) * columnWidth;
}

/** x pixel offset → time; the inverse of xForDate, clamped to the chart range. */
export function dateForX(x: number, dates: Date[], columnWidth: number): Date {
  if (dates.length < 2) return new Date(dates[0] ?? Date.now());
  if (x <= 0) return new Date(dates[0]);
  const maxX = (dates.length - 1) * columnWidth;
  if (x >= maxX) return new Date(dates[dates.length - 1]);
  const index = Math.min(Math.floor(x / columnWidth), dates.length - 2);
  const frac = x / columnWidth - index;
  const intervalMillis = dates[index + 1].getTime() - dates[index].getTime();
  return new Date(dates[index].getTime() + frac * intervalMillis);
}

export interface HeaderCell {
  x: number;
  width: number;
  label: string;
}

/**
 * Two-row time header: a bottom tick label per column plus a grouped top row (day for sub-day
 * zooms, month for day/week, year for month zoom).
 */
export function buildHeaderCells(
  dates: Date[],
  columnWidth: number,
  viewMode: GanttViewMode,
  locale: string,
): { top: HeaderCell[]; bottom: HeaderCell[] } {
  const bottom: HeaderCell[] = [];
  const top: HeaderCell[] = [];
  if (dates.length < 2) return { top, bottom };

  const bottomLabel = (date: Date): string => {
    switch (viewMode) {
      case 'month':
        return date.toLocaleDateString(locale, { month: 'long' });
      case 'week':
        return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
      case 'day':
        return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' });
      case 'shift':
      case 'hour':
        return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
  };

  const groupKey = (date: Date): string => {
    switch (viewMode) {
      case 'month':
        return String(date.getFullYear());
      case 'week':
      case 'day':
        return `${date.getFullYear()}-${date.getMonth()}`;
      case 'shift':
      case 'hour':
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    }
  };

  const groupLabel = (date: Date): string => {
    switch (viewMode) {
      case 'month':
        return String(date.getFullYear());
      case 'week':
      case 'day':
        return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
      case 'shift':
      case 'hour':
        return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    }
  };

  let currentKey: string | null = null;
  for (let index = 0; index < dates.length - 1; index++) {
    const date = dates[index];
    bottom.push({ x: index * columnWidth, width: columnWidth, label: bottomLabel(date) });
    const key = groupKey(date);
    if (key !== currentKey) {
      currentKey = key;
      top.push({ x: index * columnWidth, width: columnWidth, label: groupLabel(date) });
    } else {
      top[top.length - 1].width += columnWidth;
    }
  }
  return { top, bottom };
}

export interface OverlapPeriod {
  start: Date;
  end: Date;
}

/**
 * Time windows where two or more 'task' bars run at once — a machine over-allocation. Merged
 * into non-overlapping periods. Ported unchanged from the old DOM-injection layer.
 */
export function findOverlaps(tasks: GanttTask[]): OverlapPeriod[] {
  const actualTasks = tasks.filter((t) => t.type === 'task');
  if (actualTasks.length <= 1) return [];

  const events: { time: number; isStart: boolean }[] = [];
  actualTasks.forEach((t) => {
    events.push({ time: t.start.getTime(), isStart: true });
    events.push({ time: t.end.getTime(), isStart: false });
  });

  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.isStart ? 1 : -1;
  });

  const overlaps: OverlapPeriod[] = [];
  let activeCount = 0;
  let periodStart: number | null = null;

  for (const event of events) {
    if (event.isStart) {
      activeCount++;
      if (activeCount === 2) periodStart = event.time;
    } else {
      if (activeCount === 2 && periodStart !== null) {
        if (event.time > periodStart) overlaps.push({ start: new Date(periodStart), end: new Date(event.time) });
        periodStart = null;
      }
      activeCount--;
      if (activeCount === 1 && periodStart !== null) {
        if (event.time > periodStart) overlaps.push({ start: new Date(periodStart), end: new Date(event.time) });
        periodStart = null;
      }
    }
  }

  if (overlaps.length <= 1) return overlaps;

  overlaps.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: OverlapPeriod[] = [{ start: overlaps[0].start, end: overlaps[0].end }];
  for (let i = 1; i < overlaps.length; i++) {
    const last = merged[merged.length - 1];
    const curr = overlaps[i];
    if (curr.start.getTime() <= last.end.getTime()) {
      if (curr.end.getTime() > last.end.getTime()) last.end = curr.end;
    } else {
      merged.push({ start: curr.start, end: curr.end });
    }
  }
  return merged;
}
