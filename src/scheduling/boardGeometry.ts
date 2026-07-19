import type { DependencyType } from './SchedulingContext';

export type ZoomPreset = 'hour' | 'shift' | 'day' | 'week';

/** Pixels representing one hour of the timeline, per zoom preset. */
export const ZOOM_PRESETS: Record<ZoomPreset, number> = {
  hour: 120,
  shift: 48,
  day: 24,
  week: 7,
};

export const ZOOM_ORDER: ZoomPreset[] = ['hour', 'shift', 'day', 'week'];

/** How many days of horizontal scroll canvas to render at each zoom preset. */
export const ZOOM_SPAN_DAYS: Record<ZoomPreset, number> = {
  hour: 3,
  shift: 7,
  day: 14,
  week: 60,
};

export const CARD_ROW_HEIGHT = 56;
export const CARD_HEIGHT = 44;
export const LANE_HEADER_HEIGHT = 36;
export const LANE_GAP = 12;
export const MIN_CARD_WIDTH = 28;

/** Converts an epoch-ms timestamp to an X pixel offset from the board's time origin. */
export function timeToX(ms: number, originMs: number, pixelsPerHour: number): number {
  return ((ms - originMs) / 3_600_000) * pixelsPerHour;
}

/** Converts an X pixel offset from the board's time origin back to an epoch-ms timestamp. */
export function xToTime(px: number, originMs: number, pixelsPerHour: number): number {
  return originMs + (px / pixelsPerHour) * 3_600_000;
}

/**
 * Snaps a timestamp to the nearest of [workdayStart, workdayStart+8, workdayEnd] on the same
 * calendar day — mirrors the shift-boundary snap already used by the Gantt chart's drag handler,
 * so a job dragged on either page lands on the same natural stopping points.
 */
export function snapToShiftBoundary(ms: number, workdayStart: number, workdayEnd: number): number {
  const date = new Date(ms);
  const hours = date.getHours() + date.getMinutes() / 60;
  const candidates = [workdayStart, workdayStart + 8, workdayEnd];
  const best = candidates.reduce((closest, candidate) => (Math.abs(candidate - hours) < Math.abs(closest - hours) ? candidate : closest));
  date.setHours(Math.trunc(best), Math.round((best % 1) * 60), 0, 0);
  return date.getTime();
}

export interface Point {
  x: number;
  y: number;
}

/** Cubic-bezier connector path, matching the bend formula the Gantt chart already uses so a live
 *  in-progress connector visually matches the committed one. */
export function buildConnectorPath(source: Point, target: Point): string {
  const bend = Math.max(18, Math.abs(target.x - source.x) * 0.35);
  return `M ${source.x} ${source.y} C ${source.x + bend} ${source.y}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`;
}

export type CardEdge = 'start' | 'end';

/** Infers FS/SS/FF/SF from which edge of the source card and which edge of the target card a
 *  connection was drawn between — the same edge convention the Gantt chart's connector renderer
 *  already uses (end->start = FS, start->start = SS, end->end = FF, start->end = SF). */
export function inferDependencyType(sourceEdge: CardEdge, targetEdge: CardEdge): DependencyType {
  if (sourceEdge === 'end' && targetEdge === 'start') return 'FS';
  if (sourceEdge === 'start' && targetEdge === 'start') return 'SS';
  if (sourceEdge === 'end' && targetEdge === 'end') return 'FF';
  return 'SF';
}

/** Inverse of inferDependencyType: which edges a committed dependency's connector should anchor to. */
export function edgesForDependencyType(type: DependencyType): { sourceEdge: CardEdge; targetEdge: CardEdge } {
  switch (type) {
    case 'FS':
      return { sourceEdge: 'end', targetEdge: 'start' };
    case 'SS':
      return { sourceEdge: 'start', targetEdge: 'start' };
    case 'FF':
      return { sourceEdge: 'end', targetEdge: 'end' };
    case 'SF':
      return { sourceEdge: 'start', targetEdge: 'end' };
  }
}

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function cardEdgeAnchor(rect: CardRect, edge: CardEdge): Point {
  return { x: edge === 'start' ? rect.x : rect.x + rect.width, y: rect.y + rect.height / 2 };
}

export function pointInRect(x: number, y: number, rect: CardRect, tolerance = 0): boolean {
  return (
    x >= rect.x - tolerance &&
    x <= rect.x + rect.width + tolerance &&
    y >= rect.y - tolerance &&
    y <= rect.y + rect.height + tolerance
  );
}

export type TimeBandKind = 'weekend' | 'offshift' | 'holiday';

export interface TimeBand {
  key: string;
  x: number;
  width: number;
  kind: TimeBandKind;
}

function isHoliday(date: Date, holidays: string[]): boolean {
  if (holidays.length === 0) return false;
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return holidays.includes(iso);
}

/**
 * Absolutely-positioned background bands that orient the eye inside the lanes, mirroring DravaGantt:
 * whole-day weekend/holiday shading, and the off-shift hours (before workdayStart / after workdayEnd)
 * on working days. These are the "why did my drop snap there" explanation made visible. Computed once
 * per (origin, span, zoom, shift) and rendered behind the lanes.
 */
export function buildTimeBands(
  originMs: number,
  spanHours: number,
  pixelsPerHour: number,
  workdayStart: number,
  workdayEnd: number,
  holidays: string[] = [],
): TimeBand[] {
  const bands: TimeBand[] = [];
  const dayStart = new Date(originMs);
  dayStart.setHours(0, 0, 0, 0);
  const spanMs = spanHours * 3_600_000;
  const endMs = originMs + spanMs;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  for (let ms = dayStart.getTime(); ms < endMs; ms += DAY) {
    const date = new Date(ms);
    const dow = date.getDay();
    const weekend = dow === 0 || dow === 6;
    const holiday = isHoliday(date, holidays);
    if (weekend || holiday) {
      bands.push({
        key: `full-${ms}`,
        x: timeToX(ms, originMs, pixelsPerHour),
        width: (DAY / HOUR) * pixelsPerHour,
        kind: holiday ? 'holiday' : 'weekend',
      });
      continue;
    }
    // Working day: shade the two off-shift stretches [00:00 … workdayStart] and [workdayEnd … 24:00].
    const beforeStartMs = ms;
    const shiftStartMs = ms + workdayStart * HOUR;
    if (shiftStartMs > beforeStartMs) {
      bands.push({ key: `pre-${ms}`, x: timeToX(beforeStartMs, originMs, pixelsPerHour), width: workdayStart * pixelsPerHour, kind: 'offshift' });
    }
    const shiftEndMs = ms + workdayEnd * HOUR;
    const nextDayMs = ms + DAY;
    if (nextDayMs > shiftEndMs) {
      bands.push({ key: `post-${ms}`, x: timeToX(shiftEndMs, originMs, pixelsPerHour), width: (24 - workdayEnd) * pixelsPerHour, kind: 'offshift' });
    }
  }
  return bands;
}

/** Hours of the given windows that fall inside [winStart, winEnd] — the basis for window-aware load. */
export function clippedHours(windows: Array<{ startMs: number; endMs: number }>, winStart: number, winEnd: number): number {
  let hours = 0;
  for (const w of windows) {
    const start = Math.max(w.startMs, winStart);
    const end = Math.min(w.endMs, winEnd);
    if (end > start) hours += (end - start) / 3_600_000;
  }
  return hours;
}

export interface TimeTick {
  ms: number;
  x: number;
  label: string;
  isDayStart: boolean;
}

export function buildTimeTicks(originMs: number, spanHours: number, pixelsPerHour: number, zoom: ZoomPreset, locale: string): TimeTick[] {
  const stepHours = zoom === 'hour' ? 1 : zoom === 'shift' ? 4 : 24;
  const origin = new Date(originMs);
  origin.setMinutes(0, 0, 0);
  if (stepHours >= 24) origin.setHours(0);
  const ticks: TimeTick[] = [];
  for (let hour = 0; hour <= spanHours; hour += stepHours) {
    const ms = origin.getTime() + hour * 3_600_000;
    const date = new Date(ms);
    const isDayStart = date.getHours() === 0;
    const label = stepHours < 24
      ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    ticks.push({ ms, x: timeToX(ms, originMs, pixelsPerHour), label, isDayStart });
  }
  return ticks;
}
