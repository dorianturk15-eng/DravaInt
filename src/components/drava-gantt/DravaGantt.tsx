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
/** Fallback viewport height for environments without layout (tests). */
const FALLBACK_VIEWPORT = 800;

export interface DravaGanttHandle {
  /** Smooth-scrolls the chart so the current time is centered horizontally. */
  scrollToNow(): void;
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
  renderTooltip?: (task: GanttTask) => ReactNode;
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
  origStart: Date;
  origEnd: Date;
  origProgress: number;
  origX1: number;
  origX2: number;
  moved: boolean;
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
    renderTooltip,
    revertNonce = 0,
  }: DravaGanttProps,
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [, setDragTick] = useState(0);
  const [overrides, setOverrides] = useState<Map<string, Override>>(() => new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ task: GanttTask; x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, clientHeight: FALLBACK_VIEWPORT });
  const [nowMs, setNowMs] = useState(() => Date.now());

  // --- timescale --------------------------------------------------------

  const allTasks = useMemo(() => lanes.flatMap((lane) => lane.tasks), [lanes]);
  const columnWidth = COLUMN_WIDTHS[viewMode];
  const [rangeStart, rangeEnd] = useMemo(() => getGanttDateRange(allTasks, viewMode), [allTasks, viewMode]);
  const dates = useMemo(() => seedDates(rangeStart, rangeEnd, viewMode), [rangeStart, rangeEnd, viewMode]);
  const chartWidth = Math.max(0, (dates.length - 1) * columnWidth);
  const header = useMemo(() => buildHeaderCells(dates, columnWidth, viewMode, locale), [dates, columnWidth, viewMode, locale]);

  const timescaleRef = useRef({ dates, columnWidth });
  timescaleRef.current = { dates, columnWidth };

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

  const taskById = useMemo(() => {
    const map = new Map<string, GanttTask>();
    for (const task of allTasks) if (!map.has(task.id)) map.set(task.id, task);
    return map;
  }, [allTasks]);

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
      if (ov) return { start: ov.start, end: ov.end, progress: ov.progress };
      return { start: task.start, end: task.end, progress: task.progress };
    },
    [overrides],
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

  // --- drag & selection -------------------------------------------------

  const toggleSelect = useCallback(
    (task: GanttTask) => {
      const current = selectedIdRef.current;
      if (current === task.id) {
        setSelectedId(null);
        onSelect?.(task, false);
        return;
      }
      if (current) {
        const prev = taskById.get(current);
        if (prev) onSelect?.(prev, false);
      }
      setSelectedId(task.id);
      onSelect?.(task, true);
    },
    [onSelect, taskById],
  );

  const finishDragListeners = useRef<() => void>(() => undefined);

  const handleWindowPointerMove = useCallback((event: PointerEvent) => {
    const st = dragRef.current;
    if (!st || event.pointerId !== st.pointerId) return;
    const dx = event.clientX - st.originClientX;
    if (!st.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    st.moved = true;
    document.documentElement.dataset.ganttDragging = 'true';
    const { dates: liveDates, columnWidth: liveColumnWidth } = timescaleRef.current;
    if (st.mode === 'move') {
      const duration = st.origEnd.getTime() - st.origStart.getTime();
      const nextStart = dateForX(st.origX1 + dx, liveDates, liveColumnWidth);
      st.start = nextStart;
      st.end = new Date(nextStart.getTime() + duration);
    } else if (st.mode === 'resize-end') {
      const nextEnd = Math.max(
        dateForX(st.origX2 + dx, liveDates, liveColumnWidth).getTime(),
        st.origStart.getTime() + MIN_DURATION_MS,
      );
      st.end = new Date(nextEnd);
    } else if (st.mode === 'resize-start') {
      const nextStart = Math.min(
        dateForX(st.origX1 + dx, liveDates, liveColumnWidth).getTime(),
        st.origEnd.getTime() - MIN_DURATION_MS,
      );
      st.start = new Date(nextStart);
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
    document.documentElement.dataset.ganttDragging = 'false';
    if (!st.moved) {
      setDragTick((tick) => tick + 1);
      toggleSelect(st.task);
      return;
    }
    const task = st.task;
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(task.id, {
        start: st.start,
        end: st.end,
        progress: st.progress,
        origStartMs: task.start.getTime(),
        origEndMs: task.end.getTime(),
        origProgress: task.progress,
      });
      return next;
    });
    if (st.mode === 'progress') {
      onProgressChange?.({ ...task, progress: st.progress });
    } else {
      onDateChange?.({ ...task, start: st.start, end: st.end });
    }
  }, [onDateChange, onProgressChange, toggleSelect]);

  const handleDragKeydown = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !dragRef.current) return;
    finishDragListeners.current();
    dragRef.current = null;
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
    (event: React.PointerEvent, task: GanttTask, mode: DragMode) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (dragRef.current) return;
      event.stopPropagation();
      const times = getTimes(task);
      const { dates: liveDates, columnWidth: liveColumnWidth } = timescaleRef.current;
      dragRef.current = {
        task,
        mode,
        pointerId: event.pointerId,
        originClientX: event.clientX,
        origStart: times.start,
        origEnd: times.end,
        origProgress: times.progress,
        origX1: xForDate(times.start, liveDates, liveColumnWidth),
        origX2: xForDate(times.end, liveDates, liveColumnWidth),
        moved: false,
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

  // Delete key removes the selected task (matches the old library's behavior).
  useEffect(() => {
    if (!selectedId) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || isEditableTarget(event.target)) return;
      const task = taskById.get(selectedId);
      if (!task) return;
      onDelete?.(task);
      setSelectedId(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedId, taskById, onDelete]);

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
    // Exact "now" line above everything else in the underlay.
    if (nowDate >= dates[0] && nowDate <= dates[dates.length - 1]) {
      const nowX = xForDate(nowDate, dates, columnWidth);
      underlay.push(<line key="now-line" className="dg-now-line" x1={nowX} x2={nowX} y1={0} y2={bodyHeight} />);
    }
  }

  // --- rendering --------------------------------------------------------

  const formatCellDates = (start: Date, end: Date): string => {
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' };
    return `${start.toLocaleString(locale, opts)} – ${end.toLocaleString(locale, opts)}`;
  };

  const renderBar = (task: GanttTask, row: RowLayout): ReactNode => {
    const geom = geometryFor(task, row);
    const times = getTimes(task);
    const drag = dragRef.current;
    const isDragging = drag?.task.id === task.id && drag.moved;
    const isSelected = selectedId === task.id;
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
        ].filter(Boolean).join(' ')}
        style={{
          left: NAME_COL_WIDTH + geom.x1,
          top: geom.y - row.y,
          width: task.type === 'milestone' ? geom.height : barWidth,
          height: geom.height,
          background: color,
        }}
        data-task-bar={task.id}
        onPointerDown={interactive ? (event) => beginDrag(event, task, 'move') : undefined}
        onClick={interactive ? undefined : () => toggleSelect(task)}
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
            <span className="dg-resize-handle dg-resize-handle--start" onPointerDown={(event) => beginDrag(event, task, 'resize-start')} />
            <span className="dg-resize-handle dg-resize-handle--end" onPointerDown={(event) => beginDrag(event, task, 'resize-end')} />
            <span
              className="dg-progress-handle"
              style={{ left: `${Math.min(100, Math.max(0, times.progress))}%` }}
              onPointerDown={(event) => beginDrag(event, task, 'progress')}
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
      return (
        <div key={row.key} className="dg-lane-row" style={{ height: row.height }} data-lane={lane.id}>
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
          <span className="dg-name-dates">{formatCellDates(times.start, times.end)}</span>
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
      {tooltip && renderTooltip && (
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
    </div>
  );
});
