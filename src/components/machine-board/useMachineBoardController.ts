import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Job, DependencyType } from '../../scheduling/SchedulingContext';
import type { UpdateResult } from '../../scheduling/SchedulingContext';
import type { Machine } from '../../machines/MachinesContext';
import type { AppSettings } from '../../settings/SettingsContext';
import type { JobConflicts } from '../../scheduling/cpm';
import { findDependencyCycle, jobsToScheduleInput, cascadeDependents, toLocalDateTimeString, computeEffectiveSchedule, joinMachineChain } from '../../scheduling/cpm';
import { buildBoardLanes, classifyLinkCandidate, type BoardModel, type BoardLane, type LinkClassification } from '../../scheduling/boardData';
import type { OperationSlot } from '../../scheduling/operationSlots';
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

const MIN_OP_HOURS = 0.25;

/** A slot's key plus the descriptors an interaction needs to decide which write a gesture maps to. */
interface SlotRef {
  key: string;
  jobId: number;
  opId: number | null;
  opIndex: number | null;
  isOperation: boolean;
  isChainSegment: boolean;
  isFirstSlot: boolean;
  machine: string;
}

function slotRefOf(slot: OperationSlot): SlotRef {
  return {
    key: slot.key,
    jobId: slot.jobId,
    opId: slot.opId,
    opIndex: slot.opIndex,
    isOperation: slot.isOperation,
    isChainSegment: slot.isChainSegment,
    isFirstSlot: slot.isFirstSlot,
    machine: slot.machine,
  };
}

interface MoveInteraction {
  kind: 'move';
  ref: SlotRef;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  /** The dragged slot's own window — drives the live card position. */
  slotStartMs: number;
  slotEndMs: number;
  /** The owning job's window — what a time-move actually rewrites. */
  jobStartMs: number;
  jobEndMs: number;
  originMachine: string;
  liveDeltaXPx: number;
  liveDeltaYPx: number;
  targetMachine: string;
  moved: boolean;
}

interface ResizeInteraction {
  kind: 'resize-start' | 'resize-end';
  ref: SlotRef;
  pointerId: number;
  startClientX: number;
  slotStartMs: number;
  slotEndMs: number;
  jobStartMs: number;
  jobEndMs: number;
  originHours: number;
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
  key: string;
  jobId: number;
  slot: OperationSlot;
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
  sequentialRouteMessage: string;
  chainSegmentMessage: string;
}

const CLICK_THRESHOLD_PX = 4;
const HISTORY_LIMIT = 30;
const BOARD_VIEWS_KEY = 'dravaint-board-views';

export interface BoardView {
  id: string;
  name: string;
  zoom: ZoomPreset;
  sortBy: SortBy;
  statusFilter: Job['status'] | 'all';
}

function loadBoardViews(): BoardView[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(BOARD_VIEWS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function schedulingOptionsFrom(settings: AppSettings) {
  return { holidays: settings.holidays, workdayStart: settings.workdayStart, workdayEnd: settings.workdayEnd, skipWeekends: true };
}

/** Rewrites one operation's machine and regenerates the job's legacy display chain to match. */
function patchOperationMachine(job: Job, opIndex: number, newMachine: string): Partial<Job> {
  const operations = (job.operations ?? []).map((op, index) => (index === opIndex ? { ...op, machine: newMachine } : op));
  return { operations, machine: joinMachineChain(operations.map((op) => op.machine)) };
}

/** Edits one operation's hours (reflowing later ops) and keeps the job's parent window in step. */
function patchOperationHours(job: Job, opIndex: number, newHours: number): Partial<Job> {
  const operations = (job.operations ?? []).map((op, index) => (index === opIndex ? { ...op, hours: newHours } : op));
  const totalHours = operations.reduce((sum, op) => sum + (op.hours || 0), 0);
  const start = new Date(job.start).getTime();
  return { operations, end: toLocalDateTimeString(new Date(start + totalHours * 3_600_000)) };
}

export function useMachineBoardController(options: MachineBoardControllerOptions) {
  const { jobs, machines, updateJob, removeJob, restoreBackup, getJobConflicts, settings, locale, rejectedMessage, versionConflictMessage, sequentialRouteMessage, chainSegmentMessage } = options;

  const [zoom, setZoom] = useState<ZoomPreset>('day');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [statusFilter, setStatusFilter] = useState<Job['status'] | 'all'>('all');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
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
      const loadOf = (lane: BoardLane) => lane.slots.reduce((sum, item) => sum + (item.slot.endMs - item.slot.startMs), 0);
      return loadOf(b) - loadOf(a);
    });
    return lanes;
  }, [board.lanes, sortBy]);

  const { laneLayouts, cardLayouts, totalHeight } = useMemo(() => {
    const lanes: LaneLayout[] = [];
    const cards = new Map<string, CardLayout>();
    let cursorY = 0;
    laneOrder.forEach((lane) => {
      const laneHeight = LANE_HEADER_HEIGHT + lane.rowCount * CARD_ROW_HEIGHT + LANE_GAP;
      lanes.push({ machine: lane.machine, top: cursorY, height: laneHeight });
      lane.slots.forEach((boardSlot) => {
        const { slot } = boardSlot;
        const x = timeToX(slot.startMs, originMs, pixelsPerHour);
        const width = Math.max(MIN_CARD_WIDTH, timeToX(slot.endMs, originMs, pixelsPerHour) - x);
        const y = cursorY + LANE_HEADER_HEIGHT + boardSlot.row * CARD_ROW_HEIGHT + (CARD_ROW_HEIGHT - CARD_HEIGHT) / 2;
        cards.set(slot.key, { key: slot.key, jobId: slot.jobId, slot, x, y, width, height: CARD_HEIGHT, laneMachine: lane.machine });
      });
      cursorY += laneHeight;
    });
    return { laneLayouts: lanes, cardLayouts: cards, totalHeight: cursorY };
  }, [laneOrder, originMs, pixelsPerHour]);

  // First/last slot layout per job — dependency connectors anchor to the route's ends (edges are
  // job-level; op-to-op links inside a strictly sequential route would be meaningless).
  const jobAnchors = useMemo(() => {
    const anchors = new Map<number, { first: CardLayout; last: CardLayout }>();
    board.lanes.forEach((lane) => {
      lane.slots.forEach(({ slot }) => {
        const layout = cardLayouts.get(slot.key);
        if (!layout) return;
        const existing = anchors.get(slot.jobId);
        if (!existing) anchors.set(slot.jobId, { first: layout, last: layout });
        else {
          if (layout.slot.startMs < existing.first.slot.startMs) existing.first = layout;
          if (layout.slot.endMs > existing.last.slot.endMs) existing.last = layout;
        }
      });
    });
    return anchors;
  }, [board.lanes, cardLayouts]);

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

  const warn = useCallback((message: string) => setToast({ id: Date.now(), tone: 'warning', message }), []);

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

  const toggleSelect = useCallback((slotKey: string, additive: boolean) => {
    setSelectedKeys((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      if (next.has(slotKey) && additive) next.delete(slotKey);
      else next.add(slotKey);
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

  const beginMove = useCallback((event: ReactPointerEvent<HTMLElement>, slot: OperationSlot) => {
    const job = jobs.find((item) => item.id === slot.jobId);
    if (!job || !job.start) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const jobStartMs = new Date(job.start).getTime();
    const jobEndMs = job.end ? new Date(job.end).getTime() : jobStartMs;
    setInteractionBoth({
      kind: 'move',
      ref: slotRefOf(slot),
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      slotStartMs: slot.startMs,
      slotEndMs: slot.endMs,
      jobStartMs,
      jobEndMs,
      originMachine: slot.machine,
      liveDeltaXPx: 0,
      liveDeltaYPx: 0,
      targetMachine: slot.machine,
      moved: false,
    });
  }, [jobs, setInteractionBoth]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLElement>, slot: OperationSlot, edge: 'start' | 'end') => {
    const job = jobs.find((item) => item.id === slot.jobId);
    if (!job || !job.start) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const jobStartMs = new Date(job.start).getTime();
    const jobEndMs = job.end ? new Date(job.end).getTime() : jobStartMs;
    setInteractionBoth({
      kind: edge === 'start' ? 'resize-start' : 'resize-end',
      ref: slotRefOf(slot),
      pointerId: event.pointerId,
      startClientX: event.clientX,
      slotStartMs: slot.startMs,
      slotEndMs: slot.endMs,
      jobStartMs,
      jobEndMs,
      originHours: slot.hours,
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
    const { ref } = state;
    const machineChanged = Boolean(state.targetMachine) && state.targetMachine !== state.originMachine;
    const job = jobs.find((item) => item.id === ref.jobId);
    if (!job) return;

    // --- Lane move: dropping a card on a different machine's lane. ---
    if (machineChanged) {
      if (ref.isOperation && ref.opIndex !== null) {
        pushHistory();
        void updateJob(ref.jobId, patchOperationMachine(job, ref.opIndex, state.targetMachine)).then(showResult);
        return;
      }
      if (ref.isChainSegment) {
        warn(chainSegmentMessage);
        return;
      }
      // Synthetic single-machine job: reassign the machine (and honour any horizontal drag too).
      const deltaMs = (state.liveDeltaXPx / pixelsPerHour) * 3_600_000;
      const newStart = snapToShiftBoundary(state.jobStartMs + deltaMs, settings.workdayStart, settings.workdayEnd);
      const duration = state.jobEndMs - state.jobStartMs;
      const startStr = toLocalDateTimeString(new Date(newStart));
      const endStr = toLocalDateTimeString(new Date(newStart + duration));
      pushHistory();
      void updateJob(ref.jobId, { start: startStr, end: endStr, machine: state.targetMachine }).then(showResult);
      runCascade(ref.jobId, startStr, endStr);
      return;
    }

    // --- Horizontal (time) move. Only a route/chain's first slot — or a plain synthetic card —
    //     may move the job's start; a middle operation is strictly sequential, so it can't. ---
    if (!ref.isFirstSlot) {
      warn(sequentialRouteMessage);
      return;
    }
    const deltaMs = (state.liveDeltaXPx / pixelsPerHour) * 3_600_000;
    const newStart = snapToShiftBoundary(state.jobStartMs + deltaMs, settings.workdayStart, settings.workdayEnd);
    const duration = state.jobEndMs - state.jobStartMs;
    const newEnd = newStart + duration;
    const startStr = toLocalDateTimeString(new Date(newStart));
    const endStr = toLocalDateTimeString(new Date(newEnd));

    pushHistory();
    void updateJob(ref.jobId, { start: startStr, end: endStr }).then(showResult);
    runCascade(ref.jobId, startStr, endStr);

    // Group move: shift every other selected job that can move by time, by the same snapped delta.
    if (selectedKeys.has(ref.key)) {
      const snappedDelta = newStart - state.jobStartMs;
      const movedJobIds = new Set<number>([ref.jobId]);
      selectedKeys.forEach((otherKey) => {
        const layout = cardLayouts.get(otherKey);
        if (!layout || !layout.slot.isFirstSlot || movedJobIds.has(layout.jobId)) return;
        movedJobIds.add(layout.jobId);
        const other = jobs.find((item) => item.id === layout.jobId);
        if (!other || !other.start) return;
        const otherStart = new Date(other.start).getTime() + snappedDelta;
        const otherEnd = (other.end ? new Date(other.end).getTime() : new Date(other.start).getTime()) + snappedDelta;
        void updateJob(layout.jobId, { start: toLocalDateTimeString(new Date(otherStart)), end: toLocalDateTimeString(new Date(otherEnd)) }).then(showResult);
      });
    }
  }, [cardLayouts, chainSegmentMessage, jobs, pixelsPerHour, pushHistory, runCascade, selectedKeys, sequentialRouteMessage, settings.workdayEnd, settings.workdayStart, showResult, updateJob, warn]);

  const commitResize = useCallback((state: ResizeInteraction) => {
    const { ref } = state;
    const job = jobs.find((item) => item.id === ref.jobId);
    if (!job) return;
    const deltaMs = (state.liveDeltaXPx / pixelsPerHour) * 3_600_000;

    // --- Operation card: resize edits the operation's hours (reflowing the rest of the route). The
    //     op stays anchored at its start; dragging the end grows it, dragging the start shrinks it. ---
    if (ref.isOperation && ref.opIndex !== null) {
      const deltaHours = (state.kind === 'resize-end' ? deltaMs : -deltaMs) / 3_600_000;
      const newHours = Math.max(MIN_OP_HOURS, state.originHours + deltaHours);
      pushHistory();
      const patch = patchOperationHours(job, ref.opIndex, newHours);
      void updateJob(ref.jobId, patch).then(showResult);
      if (patch.end) runCascade(ref.jobId, job.start, patch.end);
      return;
    }
    if (ref.isChainSegment) {
      warn(chainSegmentMessage);
      return;
    }

    // --- Synthetic single-machine card: resize the job's own window (unchanged behaviour). ---
    let newStartMs = state.jobStartMs;
    let newEndMs = state.jobEndMs;
    if (state.kind === 'resize-start') newStartMs = Math.min(state.jobEndMs - 15 * 60_000, state.jobStartMs + deltaMs);
    else newEndMs = Math.max(state.jobStartMs + 15 * 60_000, state.jobEndMs + deltaMs);
    const startStr = toLocalDateTimeString(new Date(newStartMs));
    const endStr = toLocalDateTimeString(new Date(newEndMs));
    pushHistory();
    void updateJob(ref.jobId, { start: startStr, end: endStr }).then(showResult);
    runCascade(ref.jobId, startStr, endStr);
  }, [chainSegmentMessage, jobs, pixelsPerHour, pushHistory, runCascade, showResult, updateJob, warn]);

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
          toggleSelect(current.ref.key, event.shiftKey || event.ctrlKey || event.metaKey);
          if (connectMode) {
            const jobId = current.ref.jobId;
            if (connectSource == null) {
              setConnectSource(jobId);
            } else if (connectSource === jobId) {
              setConnectSource(null);
            } else {
              const classification = classifyLinkTarget(connectSource, jobId);
              if (classification === 'valid') {
                const successor = jobs.find((job) => job.id === jobId);
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
   *  greedy scheduler the Gantt page offers, so both pages resolve overlaps identically). Routed
   *  orders pack on their first machine's lane and shift `job.start` only — never reorder ops. */
  const autoSchedule = useCallback(async () => {
    pushHistory();
    const effective = computeEffectiveSchedule(jobsToScheduleInput(jobs), schedulingOptions);
    const machineEnd = new Map<string, number>();
    /** The lane a job first occupies: its first operation's machine, else its (possibly-chain) machine. */
    const packingKey = (job: Job): string => {
      if (job.operations?.length) return (job.operations.find((op) => op.machine.trim())?.machine ?? '').trim();
      return job.machine.trim();
    };
    for (const job of [...jobs].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())) {
      if (hasChildren(jobs, job.id) || !job.start || !job.end) continue;
      const duration = Math.max(0, new Date(job.end).getTime() - new Date(job.start).getTime());
      const dependencyStart = effective.get(job.id)?.start ?? new Date(job.start).getTime();
      const key = packingKey(job);
      const previousEnd = machineEnd.get(key) ?? 0;
      const start = Math.max(dependencyStart, previousEnd);
      machineEnd.set(key, start + duration);
      if (start !== new Date(job.start).getTime()) {
        await updateJob(job.id, { start: toLocalDateTimeString(new Date(start)), end: toLocalDateTimeString(new Date(start + duration)) }).then(showResult);
      }
    }
  }, [jobs, pushHistory, schedulingOptions, showResult, updateJob]);

  // Arrow-key nudge: moves every selected (movable) job by one zoom-sized step without pointer dragging.
  useEffect(() => {
    if (selectedKeys.size === 0) return;
    const stepHours = zoom === 'week' ? 24 : zoom === 'day' ? 8 : 1;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      event.preventDefault();
      const deltaMs = (event.key === 'ArrowLeft' ? -stepHours : stepHours) * 3_600_000;
      pushHistory();
      const movedJobIds = new Set<number>();
      selectedKeys.forEach((key) => {
        const layout = cardLayouts.get(key);
        if (!layout || !layout.slot.isFirstSlot || movedJobIds.has(layout.jobId)) return;
        movedJobIds.add(layout.jobId);
        const job = jobs.find((item) => item.id === layout.jobId);
        if (!job || !job.start) return;
        const start = new Date(job.start).getTime() + deltaMs;
        const end = (job.end ? new Date(job.end).getTime() : new Date(job.start).getTime()) + deltaMs;
        void updateJob(layout.jobId, { start: toLocalDateTimeString(new Date(start)), end: toLocalDateTimeString(new Date(end)) }).then(showResult);
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cardLayouts, jobs, pushHistory, selectedKeys, showResult, updateJob, zoom]);

  const exportCsv = useCallback(() => {
    const header = ['machine', 'order', 'operation', 'operator', 'start', 'end', 'status', 'progress'];
    const rows = board.slots.map((slot) =>
      [slot.machine, slot.job.order, slot.name ?? '', slot.operator ?? slot.job.operator, toLocalDateTimeString(new Date(slot.startMs)), toLocalDateTimeString(new Date(slot.endMs)), slot.job.status, String(slot.job.progress)]
        .map((value) => `"${(value ?? '').replace(/"/g, '""')}"`).join(','),
    );
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `dravaint-machine-schedule-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [board.slots]);

  const setZoomPreset = useCallback((next: ZoomPreset) => setZoom(next), []);
  const cycleZoom = useCallback((direction: 1 | -1) => {
    setZoom((current) => {
      const index = ZOOM_ORDER.indexOf(current);
      const nextIndex = Math.min(ZOOM_ORDER.length - 1, Math.max(0, index + direction));
      return ZOOM_ORDER[nextIndex];
    });
  }, []);

  /** Cycles the selection through every slot that currently has a conflict, scrolling it into view. */
  const conflictCursorRef = useRef(0);
  const jumpToConflict = useCallback(() => {
    const flagged = board.lanes.flatMap((lane) => lane.slots).filter(({ slot }) => Object.keys(getJobConflicts(slot.job)).length > 0);
    if (flagged.length === 0) return 0;
    const next = flagged[conflictCursorRef.current % flagged.length];
    conflictCursorRef.current += 1;
    setSelectedKeys(new Set([next.slot.key]));
    const layout = cardLayouts.get(next.slot.key);
    const container = scrollRef.current;
    if (layout && container) {
      container.scrollTo({ left: Math.max(0, layout.x - 200), top: Math.max(0, layout.y - 120), behavior: 'smooth' });
    }
    return flagged.length;
  }, [board.lanes, cardLayouts, getJobConflicts]);

  /** Chains the jobs of the currently selected cards Finish-to-Start in start-time order (skips
   *  edges that already exist or would close a cycle). */
  const chainSelected = useCallback(() => {
    const selectedJobIds = new Set<number>();
    selectedKeys.forEach((key) => {
      const layout = cardLayouts.get(key);
      if (layout) selectedJobIds.add(layout.jobId);
    });
    if (selectedJobIds.size < 2) return;
    const ordered = jobs
      .filter((job) => selectedJobIds.has(job.id) && job.start)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    if (ordered.length < 2) return;
    pushHistory();
    let working = jobs;
    for (let index = 1; index < ordered.length; index++) {
      const predecessor = ordered[index - 1];
      const successor = ordered[index];
      if (classifyLinkCandidate(working, predecessor.id, successor.id) !== 'valid') continue;
      const current = working.find((job) => job.id === successor.id)!;
      const nextDependencies = [...(current.dependencies ?? []), { jobId: predecessor.id, type: 'FS' as DependencyType, lagHours: 0 }];
      working = working.map((job) => (job.id === successor.id ? { ...job, dependencies: nextDependencies } : job));
      void updateJob(successor.id, { dependencies: nextDependencies }).then(showResult);
    }
  }, [cardLayouts, jobs, pushHistory, selectedKeys, showResult, updateJob]);

  const [views, setViews] = useState<BoardView[]>(loadBoardViews);
  const saveView = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setViews((current) => {
      const next = [...current.filter((view) => view.name !== trimmed), { id: `${Date.now()}`, name: trimmed, zoom, sortBy, statusFilter }];
      localStorage.setItem(BOARD_VIEWS_KEY, JSON.stringify(next));
      return next;
    });
  }, [sortBy, statusFilter, zoom]);
  const applyView = useCallback((id: string) => {
    const view = loadBoardViews().find((item) => item.id === id);
    if (!view) return;
    setZoom(view.zoom);
    setSortBy(view.sortBy);
    setStatusFilter(view.statusFilter);
  }, []);
  const deleteView = useCallback((id: string) => {
    setViews((current) => {
      const next = current.filter((view) => view.id !== id);
      localStorage.setItem(BOARD_VIEWS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /** A card's "×": on an operation card it deletes that operation (regenerating the display chain
   *  and parent window); on a plain/synthetic card it removes the whole order. */
  const removeSlot = useCallback((slot: OperationSlot) => {
    const job = jobs.find((item) => item.id === slot.jobId);
    if (!job) return;
    if (slot.isOperation && slot.opIndex !== null && job.operations && job.operations.length > 1) {
      const operations = job.operations.filter((_, index) => index !== slot.opIndex);
      const totalHours = operations.reduce((sum, op) => sum + (op.hours || 0), 0);
      const start = new Date(job.start).getTime();
      pushHistory();
      void updateJob(job.id, {
        operations,
        machine: joinMachineChain(operations.map((op) => op.machine)),
        end: toLocalDateTimeString(new Date(start + totalHours * 3_600_000)),
      }).then(showResult);
      return;
    }
    pushHistory();
    void removeJob(job.id);
  }, [jobs, pushHistory, removeJob, showResult, updateJob]);

  /** PNG snapshot of the whole board content for shift-handover printouts. */
  const exportPng = useCallback(async () => {
    if (!contentRef.current) return;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(contentRef.current, {
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim() || '#fff',
      scale: 1.5,
    });
    const link = document.createElement('a');
    link.download = `dravaint-machine-board-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  return {
    board,
    laneOrder,
    laneLayouts,
    cardLayouts,
    jobAnchors,
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
    exportPng,
    jumpToConflict,
    chainSelected,
    views,
    saveView,
    applyView,
    deleteView,
    historyDepth: history.length,
    futureDepth: future.length,
    originMs,
    pixelsPerHour,
    spanHours,
    locale,
    selectedKeys,
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
    removeSlot,
    toContentCoords,
  };
}
