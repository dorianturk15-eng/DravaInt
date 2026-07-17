import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Job, DependencyType } from '../../scheduling/SchedulingContext';
import type { UpdateResult } from '../../scheduling/SchedulingContext';
import type { Machine } from '../../machines/MachinesContext';
import type { AppSettings } from '../../settings/SettingsContext';
import type { JobConflicts } from '../../scheduling/cpm';
import { findDependencyCycle, jobsToScheduleInput, cascadeDependents, toLocalDateTimeString, computeEffectiveSchedule } from '../../scheduling/cpm';
import { buildBoardLanes, classifyLinkCandidate, type BoardModel, type BoardLane, type LinkClassification } from '../../scheduling/boardData';
import { hasChildren } from '../../scheduling/hierarchy';
import {
  ZOOM_PRESETS,
  ZOOM_ORDER,
  ZOOM_SPAN_DAYS,
  CARD_ROW_HEIGHT,
  CARD_HEIGHT,
  LANE_HEADER_HEIGHT,
  LANE_GAP,
  MIN_CARD_WIDTH,
  timeToX,
  snapToShiftBoundary,
  inferDependencyType,
  type ZoomPreset,
  type CardEdge,
} from '../../scheduling/boardGeometry';

export type SortBy = 'name' | 'load';
export type { LinkClassification } from '../../scheduling/boardData';

interface MoveInteraction {
  kind: 'move';
  jobId: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originStartMs: number;
  originEndMs: number;
  originMachine: string;
  liveDeltaXPx: number;
  liveDeltaYPx: number;
  targetMachine: string;
  moved: boolean;
}

interface ResizeInteraction {
  kind: 'resize-start' | 'resize-end';
  jobId: number;
  pointerId: number;
  startClientX: number;
  originStartMs: number;
  originEndMs: number;
  liveDeltaXPx: number;
}

interface LinkInteraction {
  kind: 'link';
  sourceJobId: number;
  sourceEdge: CardEdge;
  pointerId: number;
  pointerX: number;
  pointerY: number;
  candidateTargetId: number | null;
  candidateEdge: CardEdge | null;
  classification: LinkClassification | null;
}

type Interaction = MoveInteraction | ResizeInteraction | LinkInteraction;

export interface CardLayout {
  jobId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  laneMachine: string;
}

export interface LaneLayout {
  machine: string;
  top: number;
  height: number;
}

export interface Toast {
  id: number;
  tone: 'warning' | 'error';
  message: string;
}

export interface MachineBoardControllerOptions {
  jobs: Job[];
  machines: Machine[];
  updateJob: (id: number, patch: Partial<Job>) => Promise<UpdateResult>;
  removeJob: (id: number) => Promise<void>;
  restoreBackup: (jobs: Job[]) => Promise<void>;
  getJobConflicts: (job: Job) => JobConflicts;
  settings: AppSettings;
  locale: string;
  rejectedMessage: string;
  versionConflictMessage: string;
}

const CLICK_THRESHOLD_PX = 4;
const HISTORY_LIMIT = 30;

function schedulingOptionsFrom(settings: AppSettings) {
  return { holidays: settings.holidays, workdayStart: settings.workdayStart, workdayEnd: settings.workdayEnd, skipWeekends: true };
}

export function useMachineBoardController(options: MachineBoardControllerOptions) {
  const { jobs, machines, updateJob, removeJob, restoreBackup, getJobConflicts, settings, locale, rejectedMessage, versionConflictMessage } = options;

  const [zoom, setZoom] = useState<ZoomPreset>('day');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [statusFilter, setStatusFilter] = useState<Job['status'] | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [history, setHistory] = useState<Job[][]>([]);
  const [future, setFuture] = useState<Job[][]>([]);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<number | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<{ successorId: number; predecessorId: number } | null>(null);
  const [editingConnection, setEditingConnection] = useState<{ successorId: number; predecessorId: number; type: DependencyType; lagHours: number } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dependencyTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  // Mirrors `interaction` state for synchronous reads inside pointer handlers. React does not
  // guarantee a functional setState updater runs before the next line of the calling handler, so
  // pointerup/pointermove read the *ref* (always current) rather than relying on setState timing.
  const interactionRef = useRef<Interaction | null>(null);
  const setInteractionBoth = useCallback((next: Interaction | null) => {
    interactionRef.current = next;
    setInteraction(next);
  }, []);
  const [originMs] = useState(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    return start.getTime();
  });

  const pixelsPerHour = ZOOM_PRESETS[zoom];
  const spanHours = ZOOM_SPAN_DAYS[zoom] * 24;
  const contentWidth = spanHours * pixelsPerHour;

  const schedulingOptions = useMemo(() => schedulingOptionsFrom(settings), [settings]);
  const filteredJobs = useMemo(
    () => (statusFilter === 'all' ? jobs : jobs.filter((job) => job.status === statusFilter || hasChildren(jobs, job.id))),
    [jobs, statusFilter],
  );
  const board: BoardModel = useMemo(() => buildBoardLanes(filteredJobs, machines, schedulingOptions), [filteredJobs, machines, schedulingOptions]);

  const laneOrder = useMemo(() => {
    const lanes = [...board.lanes];
    if (sortBy === 'name') lanes.sort((a, b) => a.machine.localeCompare(b.machine));
    else lanes.sort((a, b) => {
      const loadOf = (lane: BoardLane) => lane.jobs.reduce((sum, item) => sum + (item.effectiveEnd - item.effectiveStart), 0);
      return loadOf(b) - loadOf(a);
    });
    return lanes;
  }, [board.lanes, sortBy]);

  const { laneLayouts, cardLayouts, totalHeight } = useMemo(() => {
    const lanes: LaneLayout[] = [];
    const cards = new Map<number, CardLayout>();
    let cursorY = 0;
    laneOrder.forEach((lane) => {
      const laneHeight = LANE_HEADER_HEIGHT + lane.rowCount * CARD_ROW_HEIGHT + LANE_GAP;
      lanes.push({ machine: lane.machine, top: cursorY, height: laneHeight });
      lane.jobs.forEach((boardJob) => {
        const x = timeToX(boardJob.effectiveStart, originMs, pixelsPerHour);
        const width = Math.max(MIN_CARD_WIDTH, timeToX(boardJob.effectiveEnd, originMs, pixelsPerHour) - x);
        const y = cursorY + LANE_HEADER_HEIGHT + boardJob.row * CARD_ROW_HEIGHT + (CARD_ROW_HEIGHT - CARD_HEIGHT) / 2;
        cards.set(boardJob.job.id, { jobId: boardJob.job.id, x, y, width, height: CARD_HEIGHT, laneMachine: lane.machine });
      });
      cursorY += laneHeight;
    });
    return { laneLayouts: lanes, cardLayouts: cards, totalHeight: cursorY };
  }, [laneOrder, originMs, pixelsPerHour]);

  useEffect(() => {
    document.documentElement.dataset.ganttDragging = interaction ? 'true' : 'false';
    return () => {
      document.documentElement.dataset.ganttDragging = 'false';
    };
  }, [interaction]);

  useEffect(() => {
    if (!toast) return;
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4500);
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, [toast]);

  const showResult = useCallback((result: UpdateResult) => {
    if (result.ok) return;
    if (result.reason === 'rejected') setToast({ id: Date.now(), tone: 'error', message: result.message || rejectedMessage });
    else if (result.reason === 'version-conflict') setToast({ id: Date.now(), tone: 'warning', message: versionConflictMessage });
  }, [rejectedMessage, versionConflictMessage]);

  const pushHistory = useCallback(() => {
    setHistory((current) => [...current.slice(-(HISTORY_LIMIT - 1)), structuredClone(jobs)]);
    setFuture([]);
  }, [jobs]);

  const undo = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setFuture((current) => [structuredClone(jobs), ...current].slice(0, HISTORY_LIMIT));
    setHistory((current) => current.slice(0, -1));
    void restoreBackup(previous);
  }, [history, jobs, restoreBackup]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setHistory((current) => [...current, structuredClone(jobs)].slice(-HISTORY_LIMIT));
    setFuture((current) => current.slice(1));
    void restoreBackup(next);
  }, [future, jobs, restoreBackup]);

  const runCascade = useCallback((jobId: number, startStr: string, endStr: string) => {
    const pending = cascadeDependents(jobId, startStr, endStr, jobsToScheduleInput(jobs), schedulingOptions);
    if (dependencyTimerRef.current !== null) window.clearTimeout(dependencyTimerRef.current);
    dependencyTimerRef.current = window.setTimeout(() => {
      void Promise.all([...pending].map(([id, patch]) => updateJob(id, patch)));
      dependencyTimerRef.current = null;
    }, 120);
  }, [jobs, schedulingOptions, updateJob]);

  const toContentCoords = useCallback((clientX: number, clientY: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const toggleSelect = useCallback((jobId: number, additive: boolean) => {
    setSelectedIds((current) => {
      const next = additive ? new Set(current) : new Set<number>();
      if (next.has(jobId) && additive) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const classifyLinkTarget = useCallback(
    (sourceJobId: number, targetJobId: number): LinkClassification => classifyLinkCandidate(jobs, sourceJobId, targetJobId),
    [jobs],
  );

  const findCardAt = useCallback((x: number, y: number, excludeJobId?: number) => {
    for (const layout of cardLayouts.values()) {
      if (layout.jobId === excludeJobId) continue;
      if (x >= layout.x && x <= layout.x + layout.width && y >= layout.y && y <= layout.y + layout.height) return layout;
    }
    return null;
  }, [cardLayouts]);

  const findLaneAt = useCallback((y: number) => laneLayouts.find((lane) => y >= lane.top && y < lane.top + lane.height) ?? null, [laneLayouts]);

  const beginMove = useCallback((event: ReactPointerEvent<HTMLElement>, jobId: number) => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || !job.start || !job.end) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteractionBoth({
      kind: 'move',
      jobId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originStartMs: new Date(job.start).getTime(),
      originEndMs: new Date(job.end).getTime(),
      originMachine: job.machine,
      liveDeltaXPx: 0,
      liveDeltaYPx: 0,
      targetMachine: job.machine,
      moved: false,
    });
  }, [jobs, setInteractionBoth]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLElement>, jobId: number, edge: 'start' | 'end') => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || !job.start || !job.end) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteractionBoth({
      kind: edge === 'start' ? 'resize-start' : 'resize-end',
      jobId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      originStartMs: new Date(job.start).getTime(),
      originEndMs: new Date(job.end).getTime(),
      liveDeltaXPx: 0,
    });
  }, [jobs, setInteractionBoth]);

  const beginLink = useCallback((event: ReactPointerEvent<HTMLElement>, jobId: number, edge: CardEdge) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toContentCoords(event.clientX, event.clientY);
    setInteractionBoth({
      kind: 'link',
      sourceJobId: jobId,
      sourceEdge: edge,
      pointerId: event.pointerId,
      pointerX: point.x,
      pointerY: point.y,
      candidateTargetId: null,
      candidateEdge: null,
      classification: null,
    });
  }, [setInteractionBoth, toContentCoords]);

  // Conflicts (machine/operator overlap, qualification, shift, hours, rest) are surfaced via the
  // card's badge after commit but never block a drop here — advisory-only, matching how the rest
  // of the app (edit modal, add-job form) already treats getJobConflicts.
  const commitMove = useCallback((state: MoveInteraction) => {
    const deltaMs = (state.liveDeltaXPx / pixelsPerHour) * 3_600_000;
    const rawStart = state.originStartMs + deltaMs;
    const newStart = snapToShiftBoundary(rawStart, settings.workdayStart, settings.workdayEnd);
    const duration = state.originEndMs - state.originStartMs;
    const newEnd = newStart + duration;
    const startStr = toLocalDateTimeString(new Date(newStart));
    const endStr = toLocalDateTimeString(new Date(newEnd));
    const machineChanged = state.targetMachine && state.targetMachine !== state.originMachine;

    pushHistory();
    void updateJob(state.jobId, { start: startStr, end: endStr, ...(machineChanged ? { machine: state.targetMachine } : {}) }).then(showResult);
    runCascade(state.jobId, startStr, endStr);

    if (selectedIds.has(state.jobId)) {
      const snappedDelta = newStart - state.originStartMs;
      selectedIds.forEach((otherId) => {
        if (otherId === state.jobId) return;
        const other = jobs.find((job) => job.id === otherId);
        if (!other || !other.start || !other.end) return;
        const otherStart = new Date(other.start).getTime() + snappedDelta;
        const otherEnd = new Date(other.end).getTime() + snappedDelta;
        void updateJob(otherId, { start: toLocalDateTimeString(new Date(otherStart)), end: toLocalDateTimeString(new Date(otherEnd)) }).then(showResult);
      });
    }
  }, [jobs, pixelsPerHour, pushHistory, runCascade, selectedIds, settings.workdayEnd, settings.workdayStart, showResult, updateJob]);

  const commitResize = useCallback((state: ResizeInteraction) => {
    const deltaMs = (state.liveDeltaXPx / pixelsPerHour) * 3_600_000;
    let newStartMs = state.originStartMs;
    let newEndMs = state.originEndMs;
    if (state.kind === 'resize-start') newStartMs = Math.min(state.originEndMs - 15 * 60_000, state.originStartMs + deltaMs);
    else newEndMs = Math.max(state.originStartMs + 15 * 60_000, state.originEndMs + deltaMs);
    const startStr = toLocalDateTimeString(new Date(newStartMs));
    const endStr = toLocalDateTimeString(new Date(newEndMs));
    pushHistory();
    void updateJob(state.jobId, { start: startStr, end: endStr }).then(showResult);
    runCascade(state.jobId, startStr, endStr);
  }, [pixelsPerHour, pushHistory, runCascade, showResult, updateJob]);

  // Cycle/self/duplicate checks are the only hard blocks (classification !== 'valid'); this is the
  // single write every other page's dependency view (Gantt connectors, capacity, conflict badges)
  // already reads from, so no extra propagation step is needed once this commits.
  const commitLink = useCallback((state: LinkInteraction) => {
    if (state.classification !== 'valid' || state.candidateTargetId == null || state.candidateEdge == null) return;
    const successor = jobs.find((job) => job.id === state.candidateTargetId);
    if (!successor) return;
    const type = inferDependencyType(state.sourceEdge, state.candidateEdge);
    pushHistory();
    void updateJob(successor.id, { dependencies: [...(successor.dependencies ?? []), { jobId: state.sourceJobId, type, lagHours: 0 }] }).then(showResult);
  }, [jobs, pushHistory, showResult, updateJob]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = interactionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    switch (current.kind) {
      case 'move': {
        const deltaX = event.clientX - current.startClientX;
        const deltaY = event.clientY - current.startClientY;
        const point = toContentCoords(event.clientX, event.clientY);
        const lane = findLaneAt(point.y);
        const moved = current.moved || Math.abs(deltaX) > CLICK_THRESHOLD_PX || Math.abs(deltaY) > CLICK_THRESHOLD_PX;
        setInteractionBoth({ ...current, liveDeltaXPx: deltaX, liveDeltaYPx: deltaY, targetMachine: lane?.machine ?? current.targetMachine, moved });
        return;
      }
      case 'resize-start':
      case 'resize-end': {
        const deltaX = event.clientX - current.startClientX;
        setInteractionBoth({ ...current, liveDeltaXPx: deltaX });
        return;
      }
      case 'link': {
        const point = toContentCoords(event.clientX, event.clientY);
        const target = findCardAt(point.x, point.y, current.sourceJobId);
        const candidateEdge: CardEdge | null = target ? (point.x < target.x + target.width / 2 ? 'start' : 'end') : null;
        const classification = target ? classifyLinkTarget(current.sourceJobId, target.jobId) : null;
        setInteractionBoth({ ...current, pointerX: point.x, pointerY: point.y, candidateTargetId: target?.jobId ?? null, candidateEdge, classification });
        return;
      }
    }
  }, [classifyLinkTarget, findCardAt, findLaneAt, setInteractionBoth, toContentCoords]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = interactionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setInteractionBoth(null);

    switch (current.kind) {
      case 'move': {
        if (!current.moved) {
          toggleSelect(current.jobId, event.shiftKey || event.ctrlKey || event.metaKey);
          if (connectMode) {
            if (connectSource == null) {
              setConnectSource(current.jobId);
            } else if (connectSource === current.jobId) {
              setConnectSource(null);
            } else {
              const classification = classifyLinkTarget(connectSource, current.jobId);
              if (classification === 'valid') {
                const successor = jobs.find((job) => job.id === current.jobId);
                if (successor) {
                  pushHistory();
                  void updateJob(successor.id, { dependencies: [...(successor.dependencies ?? []), { jobId: connectSource, type: 'FS', lagHours: 0 }] }).then(showResult);
                }
              }
              setConnectSource(null);
            }
          }
        } else {
          commitMove(current);
        }
        return;
      }
      case 'resize-start':
      case 'resize-end':
        commitResize(current);
        return;
      case 'link':
        commitLink(current);
        return;
    }
  }, [classifyLinkTarget, commitLink, commitMove, commitResize, connectMode, connectSource, jobs, pushHistory, setInteractionBoth, showResult, toggleSelect, updateJob]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (interactionRef.current?.pointerId === event.pointerId) setInteractionBoth(null);
  }, [setInteractionBoth]);

  useEffect(() => {
    if (!interaction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInteractionBoth(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [interaction, setInteractionBoth]);

  const deleteConnection = useCallback((successorId: number, predecessorId: number) => {
    const successor = jobs.find((job) => job.id === successorId);
    if (!successor) return;
    pushHistory();
    void updateJob(successorId, { dependencies: (successor.dependencies ?? []).filter((dependency) => dependency.jobId !== predecessorId) }).then(showResult);
    setSelectedConnection(null);
  }, [jobs, pushHistory, showResult, updateJob]);

  const saveConnectionEdit = useCallback(() => {
    if (!editingConnection) return;
    const successor = jobs.find((job) => job.id === editingConnection.successorId);
    if (!successor) return;
    pushHistory();
    void updateJob(successor.id, {
      dependencies: (successor.dependencies ?? []).map((dependency) =>
        dependency.jobId === editingConnection.predecessorId
          ? { ...dependency, type: editingConnection.type, lagHours: editingConnection.lagHours }
          : dependency,
      ),
    }).then(showResult);
    setEditingConnection(null);
  }, [editingConnection, jobs, pushHistory, showResult, updateJob]);

  const cycle = useMemo(() => findDependencyCycle(jobsToScheduleInput(jobs)), [jobs]);

  const scrollToToday = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ left: Math.max(0, timeToX(Date.now(), originMs, pixelsPerHour) - 160), behavior: 'smooth' });
  }, [originMs, pixelsPerHour]);

  /** Packs every leaf job onto its machine back-to-back, respecting dependency starts (same
   *  greedy scheduler the Gantt page offers, so both pages resolve overlaps identically). */
  const autoSchedule = useCallback(async () => {
    pushHistory();
    const effective = computeEffectiveSchedule(jobsToScheduleInput(jobs), schedulingOptions);
    const machineEnd = new Map<string, number>();
    for (const job of [...jobs].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())) {
      if (hasChildren(jobs, job.id) || !job.start || !job.end) continue;
      const duration = Math.max(0, new Date(job.end).getTime() - new Date(job.start).getTime());
      const dependencyStart = effective.get(job.id)?.start ?? new Date(job.start).getTime();
      const previousEnd = machineEnd.get(job.machine) ?? 0;
      const start = Math.max(dependencyStart, previousEnd);
      machineEnd.set(job.machine, start + duration);
      if (start !== new Date(job.start).getTime()) {
        await updateJob(job.id, { start: toLocalDateTimeString(new Date(start)), end: toLocalDateTimeString(new Date(start + duration)) }).then(showResult);
      }
    }
  }, [jobs, pushHistory, schedulingOptions, showResult, updateJob]);

  // Arrow-key nudge: moves every selected card by one zoom-sized step without pointer dragging.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const stepHours = zoom === 'week' ? 24 : zoom === 'day' ? 8 : 1;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      event.preventDefault();
      const deltaMs = (event.key === 'ArrowLeft' ? -stepHours : stepHours) * 3_600_000;
      pushHistory();
      selectedIds.forEach((id) => {
        const job = jobs.find((item) => item.id === id);
        if (!job || !job.start || !job.end) return;
        const start = new Date(job.start).getTime() + deltaMs;
        const end = new Date(job.end).getTime() + deltaMs;
        void updateJob(id, { start: toLocalDateTimeString(new Date(start)), end: toLocalDateTimeString(new Date(end)) }).then(showResult);
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [jobs, pushHistory, selectedIds, showResult, updateJob, zoom]);

  const exportCsv = useCallback(() => {
    const header = ['machine', 'order', 'operator', 'start', 'end', 'status', 'progress'];
    const rows = board.lanes.flatMap((lane) => lane.jobs.map(({ job }) =>
      [job.machine, job.order, job.operator, job.start, job.end, job.status, String(job.progress)]
        .map((value) => `"${(value ?? '').replace(/"/g, '""')}"`).join(','),
    ));
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `dravaint-machine-schedule-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [board.lanes]);

  const setZoomPreset = useCallback((next: ZoomPreset) => setZoom(next), []);
  const cycleZoom = useCallback((direction: 1 | -1) => {
    setZoom((current) => {
      const index = ZOOM_ORDER.indexOf(current);
      const nextIndex = Math.min(ZOOM_ORDER.length - 1, Math.max(0, index + direction));
      return ZOOM_ORDER[nextIndex];
    });
  }, []);

  return {
    board,
    laneOrder,
    laneLayouts,
    cardLayouts,
    totalHeight,
    contentWidth,
    zoom,
    setZoom: setZoomPreset,
    cycleZoom,
    sortBy,
    setSortBy,
    statusFilter,
    setStatusFilter,
    autoSchedule,
    exportCsv,
    historyDepth: history.length,
    futureDepth: future.length,
    originMs,
    pixelsPerHour,
    spanHours,
    locale,
    selectedIds,
    toggleSelect,
    interaction,
    connectMode,
    setConnectMode,
    connectSource,
    selectedConnection,
    setSelectedConnection,
    editingConnection,
    setEditingConnection,
    saveConnectionEdit,
    deleteConnection,
    toast,
    dismissToast: () => setToast(null),
    beginMove,
    beginResize,
    beginLink,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
    contentRef,
    scrollRef,
    scrollToToday,
    cycle,
    getJobConflicts,
    removeJob,
    toContentCoords,
  };
}

export type MachineBoardController = ReturnType<typeof useMachineBoardController>;
