import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GanttLane, GanttTask, GanttViewMode } from './types';
import { COLUMN_WIDTHS, buildHeaderCells, dateForX, findOverlaps, getGanttDateRange, seedDates, xForDate } from './timescale';
import './drava-gantt.css';

const NAME_COL_WIDTH = 210;
const LANE_HEADER_HEIGHT = 46;
const EMPTY_LANE_HEIGHT = 60;
const HEADER_HEIGHT = 50;
const MIN_DURATION_MS = 15 * 60 * 1000;
const DRAG_THRESHOLD_PX = 3;
const OVERSCAN_PX = 400;
/** Pixel radius within which a dragged edge magnetically locks onto a neighbour bar's edge. */
const MAGNET_PX = 8;
/** Fallback viewport height for environments without layout (tests). */
const FALLBACK_VIEWPORT = 800;

/** Arrow-key nudge per zoom level — the "snap unit" of that zoom (Shift+arrow is always 15 min). */
const NUDGE_MS: Record<GanttViewMode, number> = {
  hour: 15 * 60_000,
  shift: 60 * 60_000,
  day: 8 * 3_600_000,
  week: 24 * 3_600_000,
  month: 7 * 24 * 3_600_000,
};
const FINE_NUDGE_MS = 15 * 60_000;

export interface DravaGanttHandle {
  /** Smooth-scrolls the chart so the current time is centered horizontally. */
  scrollToNow(): void;
}

/** What the host knows about a drag proposal: why it conflicts and which dependents would move. */
export interface GanttDragPreview {
  /** Human-readable conflict reasons for the proposed times (empty = clean drop). */
  conflicts: string[];
  /** Dependent tasks that would cascade to new positions if this drop is committed. */
  cascades: { taskId: string; start: Date; end: Date }[];
}

export interface DravaGanttProps {
  lanes: GanttLane[];
  viewMode: GanttViewMode;
  locale: string;
  /** Full row height in px (settings.ganttRowHeight). */
  rowHeight: number;
  /** Bar height as a percentage of the row height (settings.ganttBarFill). */
  barFillPercent: number;
  emptyLaneLabel: string;
  taskCountLabel: (count: number) => string;
  onDateChange?: (task: GanttTask) => void;
  onProgressChange?: (task: GanttTask) => void;
  onDelete?: (task: GanttTask) => void;
  onDoubleClick?: (task: GanttTask) => void;
  onSelect?: (task: GanttTask, selected: boolean) => void;
  /** A move-drag dropped on a different lane; task carries the proposed times. */
  onLaneChange?: (task: GanttTask, laneId: string) => void;
  renderTooltip?: (task: GanttTask) => ReactNode;
  /** Live snap applied to the dragged edge while dragging (e.g. shift boundaries). */
  snapTime?: (ms: number) => number;
  /** Called continuously during a drag with the proposed times; drives the red conflict tint,
   *  the reasons in the drag tooltip, and the dashed cascade previews of dependent bars. */
  getDragPreview?: (task: GanttTask, start: Date, end: Date, laneId: string) => GanttDragPreview;
  /** Text for the floating multi-select pill ("3 selected · drag to move together…"). */
  selectionHint?: (count: number) => string;
  /**
   * Bump to discard optimistic drag positions (e.g. the database rejected the write); bars snap
   * back to the prop-driven schedule.
   */
  revertNonce?: number;
}

type DragMode = 'move' | 'resize-start' | 'resize-end' | 'progress';

interface DragState {
  task: GanttTask;
  mode: DragMode;
  pointerId: number;
  originClientX: number;
  laneIndex: number;
  /** Lane currently hovered by a cross-machine move; null while over the origin lane. */
  targetLaneIndex: number | null;
  origStart: Date;
  origEnd: Date;
  origProgress: number;
  origX1: number;
  origX2: number;
  /** Edge times of the other bars in the origin lane — magnetic snap targets. */
  magnetTimesMs: number[];
  /** Modifier key held at pointerdown → click toggles membership instead of replacing it. */
  additive: boolean;
  moved: boolean;
  lastClientX: number;
  lastClientY: number;
  start: Date;
  end: Date;
  progress: number;
}

/**
 * A committed-but-unconfirmed drag result: keeps the bar at its dropped position until the
 * data layer round-trips (Supabase write + refetch) and the task prop actually changes —
 * without this the bar would snap back for a moment on every drop.
 */
interface Override {
  start: Date;
  end: Date;
  progress: number;
  origStartMs: number;
  origEndMs: number;
  origProgress: number;
}

interface RowLayout {
  key: string;
  kind: 'lane' | 'task' | 'empty';
  laneIndex: number;
  task?: GanttTask;
  depth: number;
  y: number;
  height: number;
  stripe: boolean;
}

interface BarGeometry {
  x1: number;
  x2: number;
  y: number;
  height: number;
  centerY: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export const DravaGantt = forwardRef<DravaGanttHandle, DravaGanttProps>(function DravaGantt(
  {
    lanes,
    viewMode,
    locale,
    rowHeight,
    barFillPercent,
    emptyLaneLabel,
    taskCountLabel,
    onDateChange,
    onProgressChange,
    onDelete,
    onDoubleClick,
    onSelect,
    onLaneChange,
    renderTooltip,
    snapTime,
    getDragPreview,
    selectionHint,
    revertNonce = 0,
  }: DravaGanttProps,
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [, setDragTick] = useState(0);
  const [overrides, setOverrides] = useState<Map<string, Override>>(() => new Map());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  /** Last-selected id — the task keyboard nudges apply to. */
  const primaryIdRef = useRef<string | null>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ task: GanttTask; x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, clientHeight: FALLBACK_VIEWPORT });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState('');

  // --- timescale --------------------------------------------------------

  const allTasks = useMemo(() => lanes.flatMap((lane) => lane.tasks), [lanes]);
  const columnWidth = COLUMN_WIDTHS[viewMode];
  const [rangeStart, rangeEnd] = useMemo(() => getGanttDateRange(allTasks, viewMode), [allTasks, viewMode]);
  const dates = useMemo(() => seedDates(rangeStart, rangeEnd, viewMode), [rangeStart, rangeEnd, viewMode]);
  const chartWidth = Math.max(0, (dates.length - 1) * columnWidth);
  const header = useMemo(() => buildHeaderCells(dates, columnWidth, viewMode, locale), [dates, columnWidth, viewMode, locale]);

  const timescaleRef = useRef({ dates, columnWidth });
  timescaleRef.current = { dates, columnWidth };
  const snapTimeRef = useRef(snapTime);
  snapTimeRef.current = snapTime;
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;

  // --- row layout -------------------------------------------------------

  const barHeight = Math.max(8, Math.round((rowHeight * barFillPercent) / 100));

  const rows = useMemo<RowLayout[]>(() => {
    const out: RowLayout[] = [];
    let y = 0;
    lanes.forEach((lane, laneIndex) => {
      out.push({ key: `lane:${lane.id}`, kind: 'lane', laneIndex, depth: 0, y, height: LANE_HEADER_HEIGHT, stripe: false });
      y += LANE_HEADER_HEIGHT;
      if (lane.tasks.length === 0) {
        out.push({ key: `empty:${lane.id}`, kind: 'empty', laneIndex, depth: 0, y, height: EMPTY_LANE_HEIGHT, stripe: false });
        y += EMPTY_LANE_HEIGHT;
        return;
      }
      const depthById = new Map<string, number>();
      lane.tasks.forEach((task, index) => {
        const depth = task.project ? (depthById.get(task.project) ?? 0) + 1 : 0;
        depthById.set(task.id, depth);
        out.push({ key: `${lane.id}:${task.id}`, kind: 'task', laneIndex, task, depth, y, height: rowHeight, stripe: index % 2 === 1 });
        y += rowHeight;
      });
    });
    return out;
  }, [lanes, rowHeight]);

  const bodyHeight = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].height : 0;

  /** Full vertical span of each lane (header + task/empty rows) — cross-machine drop targets. */
  const laneBounds = useMemo(() => {
    const bounds: { top: number; bottom: number }[] = lanes.map(() => ({ top: Infinity, bottom: -Infinity }));
    for (const row of rows) {
      const bound = bounds[row.laneIndex];
      if (!bound) continue;
      if (row.y < bound.top) bound.top = row.y;
      if (row.y + row.height > bound.bottom) bound.bottom = row.y + row.height;
    }
    return bounds;
  }, [lanes, rows]);
  const laneBoundsRef = useRef(laneBounds);
  laneBoundsRef.current = laneBounds;

  const taskById = useMemo(() => {
    const map = new Map<string, GanttTask>();
    for (const task of allTasks) if (!map.has(task.id)) map.set(task.id, task);
    return map;
  }, [allTasks]);
  const taskByIdRef = useRef(taskById);
  taskByIdRef.current = taskById;

  // --- optimistic overrides ---------------------------------------------

  useEffect(() => {
    setOverrides((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const [id, ov] of prev) {
        const task = taskById.get(id);
        if (!task || task.start.getTime() !== ov.origStartMs || task.end.getTime() !== ov.origEndMs || task.progress !== ov.origProgress) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [taskById]);

  const lastRevertNonce = useRef(revertNonce);
  useEffect(() => {
    if (revertNonce !== lastRevertNonce.current) {
      lastRevertNonce.current = revertNonce;
      setOverrides(new Map());
    }
  }, [revertNonce]);

  const getTimes = useCallback(
    (task: GanttTask): { start: Date; end: Date; progress: number } => {
      const drag = dragRef.current;
      if (drag && drag.task.id === task.id) return { start: drag.start, end: drag.end, progress: drag.progress };
      const ov = overrides.get(task.id);
      const base = ov ?? { start: task.start, end: task.end, progress: task.progress };
      // Group move: co-selected bars shift live by the same delta as the dragged bar.
      if (
        drag && drag.moved && drag.mode === 'move' &&
        selectedIds.has(task.id) && selectedIds.has(drag.task.id) &&
        task.type !== 'project'
      ) {
        const delta = drag.start.getTime() - drag.origStart.getTime();
        return { start: new Date(base.start.getTime() + delta), end: new Date(base.end.getTime() + delta), progress: base.progress };
      }
      return { start: base.start, end: base.end, progress: base.progress };
    },
    [overrides, selectedIds],
  );

  // --- geometry ---------------------------------------------------------

  const geometryFor = useCallback(
    (task: GanttTask, row: RowLayout): BarGeometry => {
      const times = getTimes(task);
      const height = task.type === 'project' ? Math.max(8, Math.round(barHeight * 0.55)) : barHeight;
      const y = row.y + (row.height - height) / 2;
      if (task.type === 'milestone') {
        const x = xForDate(times.start, dates, columnWidth);
        const half = height / 2;
        return { x1: x - half, x2: x + half, y, height, centerY: y + half };
      }
      const x1 = xForDate(times.start, dates, columnWidth);
      const x2 = Math.max(x1 + 2, xForDate(times.end, dates, columnWidth));
      return { x1, x2, y, height, centerY: y + height / 2 };
    },
    [getTimes, barHeight, dates, columnWidth],
  );

  // --- selection --------------------------------------------------------

  /** Replaces the selection, notifying onSelect for every task whose membership changed. */
  const applySelection = useCallback(
    (next: Set<string>) => {
      const prev = selectedIdsRef.current;
      for (const id of prev) {
        if (!next.has(id)) {
          const task = taskByIdRef.current.get(id);
          if (task) onSelect?.(task, false);
        }
      }
      for (const id of next) {
        if (!prev.has(id)) {
          const task = taskByIdRef.current.get(id);
          if (task) onSelect?.(task, true);
        }
      }
      selectedIdsRef.current = next;
      setSelectedIds(next);
    },
    [onSelect],
  );

  const toggleSelect = useCallback(
    (task: GanttTask, additive: boolean) => {
      const current = selectedIdsRef.current;
      if (additive) {
        const next = new Set(current);
        if (next.has(task.id)) {
          next.delete(task.id);
          if (primaryIdRef.current === task.id) primaryIdRef.current = [...next].pop() ?? null;
        } else {
          next.add(task.id);
          primaryIdRef.current = task.id;
        }
        applySelection(next);
        return;
      }
      if (current.size === 1 && current.has(task.id)) {
        primaryIdRef.current = null;
        applySelection(new Set());
        return;
      }
      primaryIdRef.current = task.id;
      applySelection(new Set([task.id]));
    },
    [applySelection],
  );

  // --- drag -------------------------------------------------------------

  /** Live conflict/cascade preview for the current drag, memoized per proposed position. */
  const dragPreviewCacheRef = useRef<{ key: string; value: GanttDragPreview } | null>(null);
  const getDragPreviewRef = useRef(getDragPreview);
  getDragPreviewRef.current = getDragPreview;
  const onLaneChangeRef = useRef(onLaneChange);
  onLaneChangeRef.current = onLaneChange;

  const finishDragListeners = useRef<() => void>(() => undefined);

  const handleWindowPointerMove = useCallback((event: PointerEvent) => {
    const st = dragRef.current;
    if (!st || event.pointerId !== st.pointerId) return;
    const dx = event.clientX - st.originClientX;
    st.lastClientX = event.clientX;
    st.lastClientY = event.clientY;
    if (!st.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    st.moved = true;
    document.documentElement.dataset.ganttDragging = 'true';
    const { dates: liveDates, columnWidth: liveColumnWidth } = timescaleRef.current;
    const snap = snapTimeRef.current;

    /** Nearest magnetic neighbour-edge time for `ms`, or null when none is within MAGNET_PX. */
    const magnetFor = (ms: number): number | null => {
      let best: number | null = null;
      let bestPx = MAGNET_PX;
      const x = xForDate(new Date(ms), liveDates, liveColumnWidth);
      for (const candidate of st.magnetTimesMs) {
        const px = Math.abs(xForDate(new Date(candidate), liveDates, liveColumnWidth) - x);
        if (px <= bestPx) {
          bestPx = px;
          best = candidate;
        }
      }
      return best;
    };

    if (st.mode === 'move') {
      const duration = st.origEnd.getTime() - st.origStart.getTime();
      let nextStart = dateForX(st.origX1 + dx, liveDates, liveColumnWidth).getTime();
      if (snap) nextStart = snap(nextStart);
      // Magnetic pull: leading edge onto a neighbour edge, or trailing edge onto one.
      const startMagnet = magnetFor(nextStart);
      const endMagnet = magnetFor(nextStart + duration);
      if (startMagnet !== null) nextStart = startMagnet;
      else if (endMagnet !== null) nextStart = endMagnet - duration;
      st.start = new Date(nextStart);
      st.end = new Date(nextStart + duration);

      // Cross-machine: track which lane the pointer is over (only for lane-changeable tasks).
      if (st.task.laneChangeable && onLaneChangeRef.current) {
        const el = scrollRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const y = event.clientY - rect.top + el.scrollTop - HEADER_HEIGHT;
          const index = laneBoundsRef.current.findIndex((bound) => y >= bound.top && y < bound.bottom);
          st.targetLaneIndex = index >= 0 && index !== st.laneIndex ? index : null;
        }
      }
    } else if (st.mode === 'resize-end') {
      let nextEnd = dateForX(st.origX2 + dx, liveDates, liveColumnWidth).getTime();
      if (snap) nextEnd = snap(nextEnd);
      const magnet = magnetFor(nextEnd);
      if (magnet !== null) nextEnd = magnet;
      st.end = new Date(Math.max(nextEnd, st.origStart.getTime() + MIN_DURATION_MS));
    } else if (st.mode === 'resize-start') {
      let nextStart = dateForX(st.origX1 + dx, liveDates, liveColumnWidth).getTime();
      if (snap) nextStart = snap(nextStart);
      const magnet = magnetFor(nextStart);
      if (magnet !== null) nextStart = magnet;
      st.start = new Date(Math.min(nextStart, st.origEnd.getTime() - MIN_DURATION_MS));
    } else {
      const width = Math.max(1, st.origX2 - st.origX1);
      st.progress = Math.min(100, Math.max(0, st.origProgress + (dx / width) * 100));
    }
    setTooltip(null);
    setDragTick((tick) => tick + 1);
    event.preventDefault();
  }, []);

  const handleWindowPointerUp = useCallback((event: PointerEvent) => {
    const st = dragRef.current;
    if (!st || event.pointerId !== st.pointerId) return;
    finishDragListeners.current();
    dragRef.current = null;
    dragPreviewCacheRef.current = null;
    document.documentElement.dataset.ganttDragging = 'false';
    if (!st.moved) {
      setDragTick((tick) => tick + 1);
      toggleSelect(st.task, st.additive);
      return;
    }
    const task = st.task;
    const selection = selectedIdsRef.current;
    const groupMove = st.mode === 'move' && selection.has(task.id) && selection.size > 1;
    const deltaMs = st.start.getTime() - st.origStart.getTime();
    setOverrides((prev) => {
      const next = new Map(prev);
      const record = (target: GanttTask, start: Date, end: Date, progress: number) => {
        next.set(target.id, {
          start,
          end,
          progress,
          origStartMs: target.start.getTime(),
          origEndMs: target.end.getTime(),
          origProgress: target.progress,
        });
      };
      record(task, st.start, st.end, st.progress);
      if (groupMove) {
        for (const id of selection) {
          if (id === task.id) continue;
          const other = taskByIdRef.current.get(id);
          if (!other || other.type === 'project') continue;
          const base = prev.get(id) ?? { start: other.start, end: other.end, progress: other.progress };
          record(other, new Date(base.start.getTime() + deltaMs), new Date(base.end.getTime() + deltaMs), base.progress);
        }
      }
      return next;
    });
    if (st.mode === 'progress') {
      onProgressChange?.({ ...task, progress: st.progress });
    } else if (st.mode === 'move' && st.targetLaneIndex !== null && onLaneChangeRef.current) {
      const targetLane = lanesRef.current[st.targetLaneIndex];
      if (targetLane) onLaneChangeRef.current({ ...task, start: st.start, end: st.end }, targetLane.id);
      else onDateChange?.({ ...task, start: st.start, end: st.end });
    } else {
      onDateChange?.({ ...task, start: st.start, end: st.end });
    }
  }, [onDateChange, onProgressChange, toggleSelect]);

  const handleDragKeydown = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !dragRef.current) return;
    finishDragListeners.current();
    dragRef.current = null;
    dragPreviewCacheRef.current = null;
    document.documentElement.dataset.ganttDragging = 'false';
    setDragTick((tick) => tick + 1);
  }, []);

  finishDragListeners.current = () => {
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('keydown', handleDragKeydown, true);
  };

  useEffect(() => () => {
    finishDragListeners.current();
    if (dragRef.current) {
      dragRef.current = null;
      document.documentElement.dataset.ganttDragging = 'false';
    }
  }, []);

  const beginDrag = useCallback(
    (event: React.PointerEvent, task: GanttTask, mode: DragMode, laneIndex: number) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (dragRef.current) return;
      event.stopPropagation();
      const times = getTimes(task);
      const { dates: liveDates, columnWidth: liveColumnWidth } = timescaleRef.current;
      // Magnetic targets: edges of the other task bars in this lane (excluding co-selected
      // bars, which move together with the dragged one).
      const selection = selectedIdsRef.current;
      const excluded = (other: GanttTask) =>
        other.id === task.id || other.type !== 'task' || (selection.has(task.id) && selection.has(other.id));
      const magnetTimesMs: number[] = [];
      for (const other of lanesRef.current[laneIndex]?.tasks ?? []) {
        if (excluded(other)) continue;
        magnetTimesMs.push(other.start.getTime(), other.end.getTime());
      }
      dragRef.current = {
        task,
        mode,
        pointerId: event.pointerId,
        originClientX: event.clientX,
        laneIndex,
        targetLaneIndex: null,
        origStart: times.start,
        origEnd: times.end,
        origProgress: times.progress,
        origX1: xForDate(times.start, liveDates, liveColumnWidth),
        origX2: xForDate(times.end, liveDates, liveColumnWidth),
        magnetTimesMs,
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
        moved: false,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        start: times.start,
        end: times.end,
        progress: times.progress,
      };
      try {
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      } catch {
        // jsdom / older browsers — window listeners below cover the drag anyway
      }
      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerUp);
      window.addEventListener('keydown', handleDragKeydown, true);
    },
    [getTimes, handleWindowPointerMove, handleWindowPointerUp, handleDragKeydown],
  );

  // --- keyboard scheduling ----------------------------------------------

  const formatRange = useCallback((start: Date, end: Date): string => {
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' };
    return `${start.toLocaleString(locale, opts)} – ${end.toLocaleString(locale, opts)}`;
  }, [locale]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || dragRef.current) return;
      const selection = selectedIdsRef.current;
      if (selection.size === 0) return;

      if (event.key === 'Escape') {
        primaryIdRef.current = null;
        applySelection(new Set());
        return;
      }
      // Delete stays a single-task action (matches the old library); a bulk delete on one
      // keypress would be too destructive by accident.
      if (event.key === 'Delete' && selection.size === 1) {
        const task = taskById.get([...selection][0]);
        if (!task) return;
        onDelete?.(task);
        primaryIdRef.current = null;
        applySelection(new Set());
        return;
      }

      const primaryId = primaryIdRef.current && selection.has(primaryIdRef.current)
        ? primaryIdRef.current
        : [...selection].pop() ?? null;
      const task = primaryId ? taskById.get(primaryId) : null;
      if (!task || task.isDisabled || task.type === 'project') return;

      if (event.key === 'Enter') {
        event.preventDefault();
        onDoubleClick?.(task);
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const delta = direction * (event.shiftKey ? FINE_NUDGE_MS : NUDGE_MS[viewMode]);
      const ov = overrides.get(task.id);
      const current = { start: ov?.start ?? task.start, end: ov?.end ?? task.end };
      let nextStart = current.start;
      let nextEnd = current.end;
      if (event.altKey) {
        // Alt+arrows resize: the end edge grows/shrinks, clamped to the minimum duration.
        nextEnd = new Date(Math.max(current.end.getTime() + delta, current.start.getTime() + MIN_DURATION_MS));
      } else {
        nextStart = new Date(current.start.getTime() + delta);
        nextEnd = new Date(current.end.getTime() + delta);
      }
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(task.id, {
          start: nextStart,
          end: nextEnd,
          progress: ov?.progress ?? task.progress,
          origStartMs: task.start.getTime(),
          origEndMs: task.end.getTime(),
          origProgress: task.progress,
        });
        return next;
      });
      setAnnouncement(`${task.name}: ${formatRange(nextStart, nextEnd)}`);
      onDateChange?.({ ...task, start: nextStart, end: nextEnd });
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [applySelection, formatRange, onDateChange, onDelete, onDoubleClick, overrides, taskById, viewMode]);

  // --- scrolling / virtualization --------------------------------------

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewport({ scrollTop: el.scrollTop, clientHeight: el.clientHeight || FALLBACK_VIEWPORT });
  }, []);

  useEffect(() => {
    handleScroll();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(handleScroll);
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleScroll]);

  const windowTop = viewport.scrollTop - HEADER_HEIGHT - OVERSCAN_PX;
  const windowBottom = viewport.scrollTop - HEADER_HEIGHT + viewport.clientHeight + OVERSCAN_PX;
  let firstVisible = rows.length;
  let lastVisible = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.y + row.height < windowTop || row.y > windowBottom) continue;
    if (i < firstVisible) firstVisible = i;
    lastVisible = i;
  }
  const visibleRows = lastVisible >= firstVisible ? rows.slice(firstVisible, lastVisible + 1) : [];
  const spacerTop = visibleRows.length ? rows[firstVisible].y : 0;
  const spacerBottom = visibleRows.length ? bodyHeight - (rows[lastVisible].y + rows[lastVisible].height) : bodyHeight;

  useImperativeHandle(ref, () => ({
    scrollToNow() {
      const el = scrollRef.current;
      if (!el) return;
      const x = xForDate(new Date(), timescaleRef.current.dates, timescaleRef.current.columnWidth);
      el.scrollTo({ left: NAME_COL_WIDTH + x - el.clientWidth / 2, behavior: 'smooth' });
    },
  }), []);

  // Keep the exact now-line fresh without any data changing.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // --- live drag preview -------------------------------------------------

  const drag = dragRef.current;
  const dragging = Boolean(drag?.moved);
  let dragPreview: GanttDragPreview | null = null;
  if (drag && dragging && getDragPreviewRef.current && drag.mode !== 'progress') {
    const laneId = (drag.targetLaneIndex !== null ? lanes[drag.targetLaneIndex] : lanes[drag.laneIndex])?.id ?? '';
    const key = `${drag.task.id}|${drag.start.getTime()}|${drag.end.getTime()}|${laneId}`;
    if (dragPreviewCacheRef.current?.key === key) {
      dragPreview = dragPreviewCacheRef.current.value;
    } else {
      dragPreview = getDragPreviewRef.current(drag.task, drag.start, drag.end, laneId);
      dragPreviewCacheRef.current = { key, value: dragPreview };
    }
  }
  const dragConflicts = dragPreview?.conflicts ?? [];
  const dragTargetLane = drag && drag.targetLaneIndex !== null ? lanes[drag.targetLaneIndex] : null;

  // --- underlay (grid, weekend bands, overlaps, ghosts, arrows) ---------

  const laneExtents = useMemo(() => {
    const extents = new Map<number, { top: number; bottom: number }>();
    for (const row of rows) {
      if (row.kind !== 'task') continue;
      const current = extents.get(row.laneIndex);
      if (!current) extents.set(row.laneIndex, { top: row.y, bottom: row.y + row.height });
      else current.bottom = row.y + row.height;
    }
    return extents;
  }, [rows]);

  const underlay: ReactNode[] = [];
  if (dates.length >= 2 && bodyHeight > 0) {
    // Alternating row stripes.
    rows.forEach((row) => {
      if (row.kind === 'task' && row.stripe) {
        underlay.push(<rect key={`stripe-${row.key}`} className="dg-row-stripe" x={0} y={row.y} width={chartWidth} height={row.height} />);
      }
    });
    // Weekend shading (meaningful only at day-scale and finer).
    if (viewMode === 'hour' || viewMode === 'shift' || viewMode === 'day') {
      for (let index = 0; index < dates.length - 1; index++) {
        const day = dates[index].getDay();
        if (day !== 0 && day !== 6) continue;
        underlay.push(<rect key={`weekend-${index}`} className="dg-weekend-band" x={index * columnWidth} y={0} width={columnWidth} height={bodyHeight} />);
      }
    }
    // Current column highlight + exact now line.
    const nowDate = new Date(nowMs);
    if (nowDate >= dates[0] && nowDate <= dates[dates.length - 1]) {
      for (let index = 0; index < dates.length - 1; index++) {
        if (nowDate >= dates[index] && nowDate < dates[index + 1]) {
          underlay.push(<rect key="today-band" className="dg-today-band" x={index * columnWidth} y={0} width={columnWidth} height={bodyHeight} />);
          break;
        }
      }
    }
    // Machine over-allocation bands, per lane.
    lanes.forEach((lane, laneIndex) => {
      const extent = laneExtents.get(laneIndex);
      if (!extent) return;
      findOverlaps(lane.tasks).forEach((period, overlapIndex) => {
        const x1 = xForDate(period.start, dates, columnWidth);
        const x2 = xForDate(period.end, dates, columnWidth);
        underlay.push(
          <rect
            key={`overlap-${lane.id}-${overlapIndex}`}
            className="dg-overlap-band"
            x={x1}
            y={extent.top}
            width={Math.max(2, x2 - x1)}
            height={extent.bottom - extent.top}
          />,
        );
      });
    });
    // Column grid lines.
    for (let index = 1; index < dates.length; index++) {
      underlay.push(<line key={`col-${index}`} className="dg-grid-column-line" x1={index * columnWidth} x2={index * columnWidth} y1={0} y2={bodyHeight} />);
    }
    // Baseline ghosts.
    rows.forEach((row) => {
      const task = row.task;
      if (row.kind !== 'task' || !task?.baseline) return;
      const geom = geometryFor(task, row);
      const x1 = xForDate(task.baseline.start, dates, columnWidth);
      const x2 = xForDate(task.baseline.end, dates, columnWidth);
      underlay.push(
        <rect key={`ghost-${row.key}`} className="dg-baseline-ghost" x={x1} y={geom.y} width={Math.max(2, x2 - x1)} height={geom.height} rx={4} />,
      );
    });
    // Dependency arrows (within each lane, same as the per-machine charts drew them).
    lanes.forEach((lane, laneIndex) => {
      const rowByTask = new Map<string, RowLayout>();
      for (const row of rows) {
        if (row.kind === 'task' && row.laneIndex === laneIndex && row.task) rowByTask.set(row.task.id, row);
      }
      lane.tasks.forEach((task) => {
        (task.dependencies ?? []).forEach((predecessorId) => {
          const fromRow = rowByTask.get(predecessorId);
          const toRow = rowByTask.get(task.id);
          if (!fromRow?.task || !toRow?.task) return;
          const from = geometryFor(fromRow.task, fromRow);
          const to = geometryFor(toRow.task, toRow);
          const type = task.dependencyTypes?.[predecessorId] ?? 'FS';
          const sourceX = type === 'SS' || type === 'SF' ? from.x1 : from.x2;
          const targetX = type === 'FF' || type === 'SF' ? to.x2 : to.x1;
          const bend = Math.max(18, Math.abs(targetX - sourceX) * 0.35);
          const related = hoveredTaskId === predecessorId || hoveredTaskId === task.id;
          underlay.push(
            <path
              key={`dep-${lane.id}-${predecessorId}-${task.id}`}
              className={`dg-connector${related ? ' is-related' : ''}`}
              d={`M ${sourceX} ${from.centerY} C ${sourceX + bend} ${from.centerY}, ${targetX - bend} ${to.centerY}, ${targetX} ${to.centerY}`}
              strokeDasharray={type === 'SS' || type === 'SF' ? '5 4' : undefined}
            />,
          );
        });
      });
    });

    // --- live drag layer: origin ghost, snap guide, cascade previews, lane target ---
    if (drag && dragging && drag.mode !== 'progress') {
      // Cross-machine target lane tint.
      if (dragTargetLane && drag.targetLaneIndex !== null) {
        const bound = laneBounds[drag.targetLaneIndex];
        if (bound && Number.isFinite(bound.top)) {
          underlay.push(
            <rect
              key="lane-target"
              className={`dg-lane-target${dragConflicts.length ? ' dg-lane-target--conflict' : ''}`}
              x={0}
              y={bound.top}
              width={chartWidth}
              height={bound.bottom - bound.top}
            />,
          );
        }
      }
      // Ghost of the original position on the origin row.
      const originRow = rows.find((row) => row.kind === 'task' && row.task?.id === drag.task.id && row.laneIndex === drag.laneIndex);
      if (originRow) {
        const height = drag.task.type === 'project' ? Math.max(8, Math.round(barHeight * 0.55)) : barHeight;
        const gy = originRow.y + (originRow.height - height) / 2;
        const gx1 = xForDate(drag.origStart, dates, columnWidth);
        const gx2 = Math.max(gx1 + 2, xForDate(drag.origEnd, dates, columnWidth));
        underlay.push(
          <rect key="drag-ghost" className="dg-drag-ghost" x={gx1} y={gy} width={gx2 - gx1} height={height} rx={4} />,
        );
      }
      // Snap guide at the leading (dragged) edge.
      const guideDate = drag.mode === 'resize-end' ? drag.end : drag.start;
      const guideX = xForDate(guideDate, dates, columnWidth);
      underlay.push(
        <line
          key="snap-guide"
          className={`dg-snap-guide${dragConflicts.length ? ' dg-snap-guide--conflict' : ''}`}
          x1={guideX}
          x2={guideX}
          y1={0}
          y2={bodyHeight}
        />,
      );
      // Cascade previews: dependents outlined at the positions they would take after the drop.
      if (dragPreview?.cascades.length) {
        const height = barHeight;
        rows.forEach((row) => {
          if (row.kind !== 'task' || !row.task) return;
          const cascade = dragPreview!.cascades.find((entry) => entry.taskId === row.task!.id);
          if (!cascade) return;
          const cy = row.y + (row.height - height) / 2;
          const cx1 = xForDate(cascade.start, dates, columnWidth);
          const cx2 = Math.max(cx1 + 2, xForDate(cascade.end, dates, columnWidth));
          underlay.push(
            <rect key={`cascade-${row.key}`} className="dg-cascade-preview" x={cx1} y={cy} width={cx2 - cx1} height={height} rx={4} />,
          );
        });
      }
    }

    // Exact "now" line above everything else in the underlay.
    if (nowDate >= dates[0] && nowDate <= dates[dates.length - 1]) {
      const nowX = xForDate(nowDate, dates, columnWidth);
      underlay.push(<line key="now-line" className="dg-now-line" x1={nowX} x2={nowX} y1={0} y2={bodyHeight} />);
      underlay.push(
        <text key="now-clock" className="dg-now-clock" x={nowX + 5} y={13}>
          {nowDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
        </text>,
      );
    }
  }

  // --- rendering --------------------------------------------------------

  const renderBar = (task: GanttTask, row: RowLayout): ReactNode => {
    const geom = geometryFor(task, row);
    const times = getTimes(task);
    const isDragging = drag?.task.id === task.id && dragging;
    const isSelected = selectedIds.has(task.id);
    const color = (isSelected && task.styles?.backgroundSelectedColor) || task.styles?.backgroundColor || '#64748b';
    const interactive = !task.isDisabled && task.type !== 'project';
    const barWidth = geom.x2 - geom.x1;
    const labelFitsInside = task.type !== 'milestone' && barWidth >= task.name.length * 6.8 + 14;

    return (
      <div
        key={task.id}
        className={[
          'dg-bar',
          task.type === 'project' ? 'dg-bar--project' : '',
          task.type === 'milestone' ? 'dg-bar--milestone' : '',
          interactive ? '' : 'dg-bar--disabled',
          isSelected ? 'dg-bar--selected' : '',
          isDragging ? 'dg-bar--dragging' : '',
          isDragging && dragConflicts.length ? 'dg-bar--conflict' : '',
        ].filter(Boolean).join(' ')}
        style={{
          left: NAME_COL_WIDTH + geom.x1,
          top: geom.y - row.y,
          width: task.type === 'milestone' ? geom.height : barWidth,
          height: geom.height,
          background: color,
        }}
        data-task-bar={task.id}
        onPointerDown={interactive ? (event) => beginDrag(event, task, 'move', row.laneIndex) : undefined}
        onClick={interactive ? undefined : (event) => toggleSelect(task, event.ctrlKey || event.metaKey || event.shiftKey)}
        onPointerEnter={() => setHoveredTaskId(task.id)}
        onPointerLeave={() => {
          setHoveredTaskId((current) => (current === task.id ? null : current));
          setTooltip(null);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current && renderTooltip) setTooltip({ task, x: event.clientX, y: event.clientY });
        }}
        onDoubleClick={() => onDoubleClick?.(task)}
      >
        {task.type !== 'milestone' && times.progress > 0 && (
          <span className="dg-progress-fill" style={{ width: `${Math.min(100, Math.max(0, times.progress))}%` }} />
        )}
        {task.texture && <span className="dg-texture" />}
        {task.setupRatio ? (
          <span
            className="dg-setup-stripe"
            style={{ width: Math.max(3, barWidth * Math.min(1, task.setupRatio)) }}
            title={task.setupLabel}
          />
        ) : null}
        {task.warning && <span className="dg-warning-badge" title={task.warning} />}
        {task.type !== 'milestone' && (
          <span className={`dg-bar-label${labelFitsInside ? '' : ' dg-bar-label--outside'}`}>{task.name}</span>
        )}
        {interactive && task.type !== 'milestone' && (
          <>
            <span className="dg-resize-handle dg-resize-handle--start" onPointerDown={(event) => beginDrag(event, task, 'resize-start', row.laneIndex)} />
            <span className="dg-resize-handle dg-resize-handle--end" onPointerDown={(event) => beginDrag(event, task, 'resize-end', row.laneIndex)} />
            <span
              className="dg-progress-handle"
              style={{ left: `${Math.min(100, Math.max(0, times.progress))}%` }}
              onPointerDown={(event) => beginDrag(event, task, 'progress', row.laneIndex)}
            />
          </>
        )}
      </div>
    );
  };

  const renderRow = (row: RowLayout): ReactNode => {
    if (row.kind === 'lane') {
      const lane = lanes[row.laneIndex];
      const count = lane.tasks.filter((task) => task.type === 'task').length;
      const isDropTarget = dragging && drag?.targetLaneIndex === row.laneIndex;
      return (
        <div key={row.key} className={`dg-lane-row${isDropTarget ? ' dg-lane-row--target' : ''}`} style={{ height: row.height }} data-lane={lane.id}>
          <div className="dg-lane-inner">
            <strong>{lane.label}</strong>
            <span>{taskCountLabel(count)}</span>
            {lane.efficiency !== undefined && (
              <span className="dg-efficiency" aria-label={`${lane.efficiency}%`}>
                <span style={{ width: `${lane.efficiency}%` }} />
                <b>{lane.efficiency}%</b>
              </span>
            )}
          </div>
        </div>
      );
    }
    if (row.kind === 'empty') {
      return (
        <div key={row.key} className="dg-empty-row" style={{ height: row.height }}>
          <div className="dg-empty-inner">{emptyLaneLabel}</div>
        </div>
      );
    }
    const task = row.task!;
    const times = getTimes(task);
    return (
      <div key={row.key} className={`dg-row dg-row--${task.type}${row.stripe ? ' dg-row--stripe' : ''}`} style={{ height: row.height }}>
        {renderBar(task, row)}
        <div className="dg-name-cell" style={{ width: NAME_COL_WIDTH, paddingLeft: 12 + row.depth * 14 }}>
          <span className="dg-name-title">{task.name}</span>
          <span className="dg-name-dates">{formatRange(times.start, times.end)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="dg-root">
      <div className="dg-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="dg-canvas" style={{ width: NAME_COL_WIDTH + chartWidth }}>
          <div className="dg-header" style={{ height: HEADER_HEIGHT }}>
            <div className="dg-header-corner" style={{ width: NAME_COL_WIDTH }} />
            <div className="dg-header-cells" style={{ width: chartWidth, height: HEADER_HEIGHT }}>
              {header.top.map((cell, index) => (
                <div key={`top-${index}`} className="dg-header-top" style={{ left: cell.x, width: cell.width }}>{cell.label}</div>
              ))}
              {header.bottom.map((cell, index) => (
                <div key={`tick-${index}`} className="dg-header-tick" style={{ left: cell.x, width: cell.width }}>{cell.label}</div>
              ))}
            </div>
          </div>
          <div className="dg-body" style={{ height: bodyHeight }}>
            <svg className="dg-underlay" style={{ left: NAME_COL_WIDTH }} width={chartWidth} height={bodyHeight} aria-hidden="true">
              {underlay}
            </svg>
            <div className="dg-rows">
              {spacerTop > 0 && <div style={{ height: spacerTop }} aria-hidden="true" />}
              {visibleRows.map(renderRow)}
              {spacerBottom > 0 && <div style={{ height: spacerBottom }} aria-hidden="true" />}
            </div>
          </div>
        </div>
      </div>
      {tooltip && renderTooltip && !dragging && (
        <div
          className="dg-tooltip"
          style={{
            left: Math.min(tooltip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280),
            top: tooltip.y + 14,
          }}
        >
          {renderTooltip(tooltip.task)}
        </div>
      )}
      {drag && dragging && drag.mode !== 'progress' && (
        <div
          className={`dg-drag-tooltip${dragConflicts.length ? ' dg-drag-tooltip--conflict' : ''}`}
          style={{
            left: Math.min(drag.lastClientX + 16, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 300),
            top: drag.lastClientY + 18,
          }}
          role="status"
        >
          <strong>{formatRange(drag.start, drag.end)}</strong>
          {dragTargetLane && <span className="dg-drag-tooltip-lane">→ {dragTargetLane.label}</span>}
          {dragConflicts.map((message, index) => (
            <em key={index}>⚠ {message}</em>
          ))}
          {dragPreview && dragPreview.cascades.length > 0 && (
            <span className="dg-drag-tooltip-cascade">↳ +{dragPreview.cascades.length}</span>
          )}
        </div>
      )}
      {selectionHint && selectedIds.size > 1 && (
        <div className="dg-selection-pill" role="status">{selectionHint(selectedIds.size)}</div>
      )}
      <div className="dg-sr-only" role="status" aria-live="polite">{announcement}</div>
    </div>
  );
});
