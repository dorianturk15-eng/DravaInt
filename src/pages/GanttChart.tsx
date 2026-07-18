import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { DravaGantt, type DravaGanttHandle, type GanttDragPreview } from '../components/drava-gantt/DravaGantt';
import type { GanttLane, GanttTask, GanttViewMode } from '../components/drava-gantt/types';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus } from '../components/Icons';
import { useScheduling, type DependencyType, type UpdateResult } from '../scheduling/SchedulingContext';
import { buildGanttTasks, jobIdFromTaskId, hasChildren, computeOperationSchedule } from '../scheduling/hierarchy';
import { findDependencyCycle, jobsToScheduleInput, computeEffectiveSchedule, computeScheduleSlack, cascadeDependents, toLocalDateTimeString, splitMachineChain, type JobConflicts } from '../scheduling/cpm';
import { snapToShiftBoundary } from '../scheduling/boardGeometry';
import { useSettings } from '../settings/SettingsContext';
import { useMachines } from '../machines/MachinesContext';
import type { Job } from '../scheduling/SchedulingContext';
import { useAuth } from '../auth/AuthContext';

const DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

interface GanttViewPreset {
  id: string;
  name: string;
  search: string;
  machineSort: 'name' | 'jobs' | 'load';
  highlightCritical: boolean;
  viewMode: GanttViewMode;
}

/** Maps view modes persisted by the old gantt-task-react implementation onto DravaGantt's. */
const LEGACY_VIEW_MODES: Record<string, GanttViewMode> = {
  'Hour': 'hour',
  'Quarter Day': 'shift',
  'Half Day': 'shift',
  'Day': 'day',
  'Week': 'week',
  'Month': 'month',
  hour: 'hour',
  shift: 'shift',
  day: 'day',
  week: 'week',
  month: 'month',
};

function normalizeViewMode(value: unknown): GanttViewMode {
  return LEGACY_VIEW_MODES[String(value)] ?? 'day';
}

/** Flattens the conflict object into short human-readable reasons for the drag tooltip. */
function summarizeConflicts(conflicts: JobConflicts, hr: boolean): string[] {
  const overlap = (label: string, other?: { otherOrder: string }) => (other ? `${label} ${other.otherOrder}` : undefined);
  return [
    overlap(hr ? 'Preklapanje:' : 'Overlaps', conflicts.machineOverlap),
    overlap(hr ? 'Operater zauzet:' : 'Operator busy:', conflicts.operatorOverlap),
    conflicts.unqualified?.message,
    conflicts.shiftOutside?.message,
    conflicts.hoursExceeded?.message,
    conflicts.restViolation?.message,
    conflicts.absent?.message,
  ].filter(Boolean) as string[];
}

export default function GanttChart() {
  const { t, lang } = useLanguage();
  const { jobs, loading, addJob, updateJob, removeJob, restoreBackup, getJobConflicts } = useScheduling();
  const { settings } = useSettings();
  const { machines } = useMachines();
  const { username } = useAuth();
  const presetStorageKey = `gantt-view-presets-${username || 'local'}`;

  const [form, setForm] = useState({ name: '', start: '', end: '' });
  const [depForm, setDepForm] = useState({ jobId: '', predecessorId: '', type: 'FS' as DependencyType, lagHours: '0' });
  const [depError, setDepError] = useState('');
  const [writeWarning, setWriteWarning] = useState('');
  const writeWarningTimerRef = useRef<number | null>(null);
  const [undoToast, setUndoToast] = useState('');
  const undoToastTimerRef = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<GanttViewMode>('day');
  const [search, setSearch] = useState('');
  const [highlightCritical, setHighlightCritical] = useState(true);
  const [machineSort, setMachineSort] = useState<'name' | 'jobs' | 'load'>('name');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editingJobId, setEditingJobId] = useState<number | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('gantt-collapsed') || '[]') as number[]); } catch { return new Set(); }
  });
  const [history, setHistory] = useState<Job[][]>([]);
  const [future, setFuture] = useState<Job[][]>([]);
  const [editingDependency, setEditingDependency] = useState<{ jobId: number; predecessorId: number; type: DependencyType; lagHours: number } | null>(null);
  const [draggedOperation, setDraggedOperation] = useState<{ jobId: number; operationId: number } | null>(null);
  const [planningToolsOpen, setPlanningToolsOpen] = useState(() => localStorage.getItem('gantt-planning-tools-open') === 'true');
  const [viewPresets, setViewPresets] = useState<GanttViewPreset[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(presetStorageKey) || '[]') as GanttViewPreset[];
      // Presets saved by the old gantt-task-react build stored its ViewMode strings ("Half Day"…).
      return parsed.map((preset) => ({ ...preset, viewMode: normalizeViewMode(preset.viewMode) }));
    } catch { return []; }
  });
  const [activePresetId, setActivePresetId] = useState('');
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  const pageContainerRef = useRef<HTMLDivElement>(null);
  const dependencyUpdateTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (dependencyUpdateTimerRef.current !== null) window.clearTimeout(dependencyUpdateTimerRef.current);
    if (writeWarningTimerRef.current !== null) window.clearTimeout(writeWarningTimerRef.current);
    if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current);
  }, []);

  /** One-tap Undo toast after a drop — the touch-friendly complement to Ctrl+Z. */
  const showUndoToast = useCallback((message: string) => {
    setUndoToast(message);
    if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current);
    undoToastTimerRef.current = window.setTimeout(() => setUndoToast(''), 6000);
  }, []);

  const viewModeOptions = useMemo((): { label: string; value: GanttViewMode }[] => [
    { label: lang === 'hr' ? 'Sat' : 'Hour', value: 'hour' },
    { label: lang === 'hr' ? 'Smjena' : 'Shift', value: 'shift' },
    { label: lang === 'hr' ? 'Dan' : 'Day', value: 'day' },
    { label: lang === 'hr' ? 'Tjedan' : 'Week', value: 'week' },
    { label: lang === 'hr' ? 'Mjesec' : 'Month', value: 'month' },
  ], [lang]);

  // Baseline schedule tracking state
  const [baseline, setBaseline] = useState<Record<number, { start: string; end: string }>>(() => {
    try {
      const raw = localStorage.getItem('gantt-baseline');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [showBaseline, setShowBaseline] = useState(false);

  const validJobs = useMemo(() => jobs.filter((j) => j.start), [jobs]);
  const hasAnyDependency = validJobs.some((j) => (j.dependencies?.length ?? 0) > 0);
  const dependencyCount = validJobs.reduce((sum, job) => sum + (job.dependencies?.length ?? 0), 0);
  const schedulableJobs = useMemo(() => validJobs.filter((j) => !hasChildren(jobs, j.id)), [jobs, validJobs]);

  // Machine names extraction helper
  const machinesList = useMemo(() => {
    const list = new Set<string>();
    machines.forEach((machine) => list.add(machine.name));
    jobs.forEach((j) => {
      if (j.machine) {
        splitMachineChain(j.machine).forEach((m) => list.add(m));
      }
      if (j.operations) {
        j.operations.forEach((op) => {
          if (op.machine.trim()) list.add(op.machine.trim());
        });
      }
    });
    if (list.size === 0) list.add('General / Unassigned');
    const values = Array.from(list);
    const workload = (machine: string) => jobs.filter((job) => splitMachineChain(job.machine).includes(machine) || job.operations?.some((operation) => operation.machine === machine)).reduce((hours, job) => hours + Math.max(0, (new Date(job.end).getTime() - new Date(job.start).getTime()) / 3_600_000), 0);
    return values.sort((a, b) => machineSort === 'name' ? a.localeCompare(b) : machineSort === 'jobs' ? jobs.filter((job) => job.machine.includes(b)).length - jobs.filter((job) => job.machine.includes(a)).length : workload(b) - workload(a));
  }, [jobs, machineSort, machines]);

  const cycle = useMemo(() => findDependencyCycle(jobsToScheduleInput(validJobs)), [validJobs]);
  const cycleLabel = cycle?.map((id) => jobs.find((job) => job.id === id)?.order || `#${id}`).join(' → ');
  const effectiveSchedule = useMemo(() => computeEffectiveSchedule(jobsToScheduleInput(validJobs), {
    holidays: settings.holidays,
    workdayStart: settings.workdayStart,
    workdayEnd: settings.workdayEnd,
    skipWeekends: true,
  }), [settings.holidays, settings.workdayEnd, settings.workdayStart, validJobs]);
  const scheduleSlack = useMemo(() => computeScheduleSlack(jobsToScheduleInput(validJobs), effectiveSchedule), [effectiveSchedule, validJobs]);
  const renderGanttTooltip = useCallback((task: GanttTask) => {
    const jobId = jobIdFromTaskId(task.id);
    const job = jobs.find((item) => item.id === jobId);
    const durationHours = Math.max(0, (task.end.getTime() - task.start.getTime()) / 3_600_000);
    const slackHours = jobId ? (scheduleSlack.get(jobId) ?? 0) / 3_600_000 : 0;
    return <div className="gantt-premium-tooltip">
      <strong>{task.name}</strong>
      <span>{task.start.toLocaleString(lang === 'hr' ? 'hr-HR' : 'en-US')} → {task.end.toLocaleString(lang === 'hr' ? 'hr-HR' : 'en-US')}</span>
      <span>{lang === 'hr' ? 'Trajanje' : 'Duration'}: {durationHours.toFixed(1)}h</span>
      <span>{lang === 'hr' ? 'Operater' : 'Operator'}: {job?.operator || '—'}</span>
      <span>{lang === 'hr' ? 'Rezerva' : 'Slack'}: {slackHours.toFixed(1)}h</span>
      {job?.setupHours ? <span>{lang === 'hr' ? 'Priprema' : 'Setup'}: {job.setupHours}h</span> : null}
      {job?.materialStatus && job.materialStatus !== 'ready' ? <em>{lang === 'hr' ? 'Materijal na čekanju' : 'Material pending'}</em> : null}
    </div>;
  }, [jobs, lang, scheduleSlack]);
  // Live snap during drag: shift boundaries everywhere except hour zoom, where the planner is
  // deliberately working fine-grained (same rule the old drop-snap and the mobile timeline use).
  const ganttSnapTime = useMemo(() => (
    viewMode === 'hour' ? undefined : (ms: number) => snapToShiftBoundary(ms, settings.workdayStart, settings.workdayEnd)
  ), [viewMode, settings.workdayEnd, settings.workdayStart]);

  /**
   * Conflict + cascade preview while a bar is being dragged: runs the same engine as the
   * post-drop checks (cpm.getJobConflicts, cascadeDependents) against the *proposed* times so
   * the planner sees the consequence before releasing — not via banner-and-snap-back after.
   */
  const getGanttDragPreview = useCallback((task: GanttTask, start: Date, end: Date, laneId: string): GanttDragPreview => {
    // Operation rows shift the whole route; previewing that is the route editor's job.
    if (task.id.startsWith('op-')) return { conflicts: [], cascades: [] };
    const jobId = jobIdFromTaskId(task.id);
    const job = jobId ? jobs.find((item) => item.id === jobId) : null;
    if (!job) return { conflicts: [], cascades: [] };
    const startStr = toLocalDateTimeString(start);
    const endStr = toLocalDateTimeString(end);
    const machine = task.laneChangeable && laneId && !splitMachineChain(job.machine).includes(laneId) ? laneId : job.machine;
    const conflicts = summarizeConflicts(getJobConflicts({ ...job, machine, start: startStr, end: endStr }), lang === 'hr');
    const pending = cascadeDependents(jobId!, startStr, endStr, jobsToScheduleInput(validJobs), {
      holidays: settings.holidays,
      workdayStart: settings.workdayStart,
      workdayEnd: settings.workdayEnd,
      skipWeekends: true,
    });
    const cascades = [...pending].map(([id, patch]) => ({ taskId: `wo-${id}`, start: new Date(patch.start), end: new Date(patch.end) }));
    return { conflicts, cascades };
  }, [getJobConflicts, jobs, lang, settings.holidays, settings.workdayEnd, settings.workdayStart, validJobs]);

  const selectionHint = useCallback((count: number) => (
    lang === 'hr'
      ? `${count} odabrano · povuci za skupno pomicanje · Esc za poništenje`
      : `${count} selected · drag to move together · Esc to clear`
  ), [lang]);

  const predecessorOptions = useMemo(() => {
    const targetId = Number(depForm.jobId);
    if (!targetId) return schedulableJobs;
    return schedulableJobs.filter((candidate) => {
      if (candidate.id === targetId) return false;
      const next = jobs.map((job) => job.id === targetId ? { ...job, dependencies: [...(job.dependencies ?? []), { jobId: candidate.id, type: depForm.type, lagHours: Number(depForm.lagHours) || 0 }] } : job);
      return !findDependencyCycle(jobsToScheduleInput(next));
    });
  }, [depForm.jobId, depForm.lagHours, depForm.type, jobs, schedulableJobs]);

  const pushHistory = useCallback(() => {
    setHistory((current) => [...current.slice(-29), structuredClone(jobs)]);
    setFuture([]);
  }, [jobs]);

  const undo = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setFuture((current) => [structuredClone(jobs), ...current].slice(0, 30));
    setHistory((current) => current.slice(0, -1));
    void restoreBackup(previous);
  }, [history, jobs, restoreBackup]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setHistory((current) => [...current, structuredClone(jobs)].slice(-30));
    setFuture((current) => current.slice(1));
    void restoreBackup(next);
  }, [future, jobs, restoreBackup]);

  useEffect(() => {
    const handleHistoryKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handleHistoryKey);
    return () => window.removeEventListener('keydown', handleHistoryKey);
  }, [redo, undo]);

  // Builds task hierarchies per machine
  const buildTasksForMachine = useCallback((machineName: string): GanttTask[] => {
    const normalizedSearch = search.trim().toLowerCase();
    const matchingJobs = jobs.filter((j) => {
      if (normalizedSearch && !`${j.order} ${j.operator} ${j.product ?? ''} ${j.machine}`.toLowerCase().includes(normalizedSearch)) return false;
      if (j.machine && splitMachineChain(j.machine).includes(machineName)) {
        return true;
      }
      if (j.operations?.some((op) => op.machine.trim() === machineName)) {
        return true;
      }
      return false;
    });

    if (matchingJobs.length === 0) return [];

    const jobIdsToKeep = new Set<number>();
    matchingJobs.forEach((j) => {
      jobIdsToKeep.add(j.id);
      let curr = j;
      while (curr.parentId) {
        const parent = jobs.find((p) => p.id === curr.parentId);
        if (!parent) break;
        jobIdsToKeep.add(parent.id);
        curr = parent;
      }
    });

    const machineJobsList = jobs.filter((j) => jobIdsToKeep.has(j.id));
    return buildGanttTasks(machineJobsList, {
      highlightCritical,
      criticalToleranceMs: settings.criticalToleranceMs,
      collapsedIds,
      scheduling: { holidays: settings.holidays, workdayStart: settings.workdayStart, workdayEnd: settings.workdayEnd, skipWeekends: true },
    });
  }, [collapsedIds, highlightCritical, jobs, search, settings.criticalToleranceMs, settings.holidays, settings.workdayEnd, settings.workdayStart]);

  /**
   * Attaches the visual decorations (in-progress texture, setup stripe, baseline ghost, warning
   * badge, dependency-arrow types) to the base tasks. The old implementation injected these into
   * gantt-task-react's rendered DOM after the fact; DravaGantt renders them first-class.
   */
  const decorateTasks = useCallback((tasks: GanttTask[]): GanttTask[] => tasks.map((task) => {
    const jobId = jobIdFromTaskId(task.id);
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return task;
    const decorated: GanttTask = { ...task };
    const isWorkOrderBar = task.id.startsWith('wo-');

    if (job.status === 'inProgress') decorated.texture = true;

    if (isWorkOrderBar && job.setupHours) {
      const totalHours = Math.max(0.01, (task.end.getTime() - task.start.getTime()) / 3_600_000);
      decorated.setupRatio = Math.min(1, job.setupHours / totalHours);
      decorated.setupLabel = `${lang === 'hr' ? 'Priprema' : 'Setup'}: ${job.setupHours}h`;
    }

    if (showBaseline && isWorkOrderBar && baseline[job.id]) {
      decorated.baseline = { start: new Date(baseline[job.id].start), end: new Date(baseline[job.id].end) };
    }

    const hasOperatorConflict = Boolean(job.operator) && jobs.some((other) => other.id !== job.id && other.operator.trim().toLowerCase() === job.operator.trim().toLowerCase() && new Date(job.start) < new Date(other.end) && new Date(other.start) < new Date(job.end));
    if (isWorkOrderBar && (hasOperatorConflict || (job.materialStatus && job.materialStatus !== 'ready'))) {
      decorated.warning = hasOperatorConflict
        ? (lang === 'hr' ? 'Sukob rasporeda operatera' : 'Operator schedule conflict')
        : (lang === 'hr' ? 'Materijal nije spreman' : 'Material is not ready');
    }

    if (task.dependencies?.length && job.dependencies?.length) {
      decorated.dependencyTypes = Object.fromEntries(job.dependencies.map((dependency) => [`wo-${dependency.jobId}`, dependency.type]));
    }

    // Cross-machine drag: only plain single-machine leaf jobs can be dropped on another lane.
    // Routed orders (operations pin machines) and machine chains keep their lane assignment.
    if (isWorkOrderBar && task.type === 'task' && !job.operations?.length && splitMachineChain(job.machine).length <= 1) {
      decorated.laneChangeable = true;
    }
    return decorated;
  }), [baseline, jobs, lang, showBaseline]);

  const ganttLanes = useMemo((): GanttLane[] => machinesList.map((machineName) => ({
    id: machineName,
    label: machineName,
    efficiency: machineEfficiency(machineName),
    tasks: decorateTasks(buildTasksForMachine(machineName)),
  })), [buildTasksForMachine, decorateTasks, machinesList, jobs]);

  const ganttRef = useRef<DravaGanttHandle>(null);
  // Bumped when the database rejects a drag so the renderer discards its optimistic bar position.
  const [ganttRevertNonce, setGanttRevertNonce] = useState(0);

  function saveBaseline() {
    const data: Record<number, { start: string; end: string }> = {};
    jobs.forEach((j) => {
      if (j.start && j.end) {
        data[j.id] = { start: j.start, end: j.end };
      }
    });
    setBaseline(data);
    localStorage.setItem('gantt-baseline', JSON.stringify(data));
  }

  function handleAdd() {
    if (!form.name || !form.start || !form.end) return;
    addJob({
      machine: '',
      order: form.name,
      operator: '',
      start: `${form.start}T00:00`,
      end: `${form.end}T00:00`,
    });
    setForm({ name: '', start: '', end: '' });
  }

  /**
   * Surface a failed drag/edit write. In Supabase mode a write can be rejected by the DB
   * double-booking trigger or lose an optimistic-version race; the realtime refetch then snaps the
   * bar back, which without a message reads as a silent glitch (the machine board already toasts
   * these — the Gantt swallowed them).
   */
  const reportWriteResult = useCallback((result: UpdateResult) => {
    if (result.ok || result.reason === 'offline') return;
    // Discard the renderer's optimistic bar position — the write did not land.
    setGanttRevertNonce((nonce) => nonce + 1);
    const message = result.reason === 'rejected'
      ? (result.message || (lang === 'hr' ? 'Baza je odbila promjenu (npr. zauzet termin) — vraćeno na prethodno stanje.' : 'The database rejected the change (e.g. a booked slot) — reverted.'))
      : (lang === 'hr' ? 'Nalog je u međuvremenu izmijenjen drugdje — vraćeno na svježe stanje.' : 'The order was changed elsewhere in the meantime — reloaded the fresh state.');
    setWriteWarning(message);
    if (writeWarningTimerRef.current !== null) window.clearTimeout(writeWarningTimerRef.current);
    writeWarningTimerRef.current = window.setTimeout(() => setWriteWarning(''), 6000);
  }, [lang]);

  // Recursive propagation of scheduling constraints (CPM logic, shared with the Machine Scheduling board)
  function adjustDependencies(updatedJobId: number, startStr: string, endStr: string, currentJobsList: typeof jobs) {
    const pending = cascadeDependents(updatedJobId, startStr, endStr, jobsToScheduleInput(currentJobsList), {
      holidays: settings.holidays,
      workdayStart: settings.workdayStart,
      workdayEnd: settings.workdayEnd,
      skipWeekends: true,
    });
    if (dependencyUpdateTimerRef.current !== null) window.clearTimeout(dependencyUpdateTimerRef.current);
    dependencyUpdateTimerRef.current = window.setTimeout(() => {
      void Promise.all([...pending].map(([id, patch]) => updateJob(id, patch).then(reportWriteResult)));
      dependencyUpdateTimerRef.current = null;
    }, 120);
  }

  /**
   * An operation has no stored start — the route is chained off job.start — so a
   * dragged operation bar is decomposed into (route shift, this op's duration):
   *   middle drag -> start moves, duration constant  -> the whole route shifts
   *   right edge  -> start fixed, duration changes   -> only this op resizes
   *   left edge   -> both change, so the far edge stays put
   */
  function handleOperationDateChange(task: GanttTask) {
    const match = task.id.match(/^op-(\d+)-(\d+)$/);
    if (!match) return;
    const jobId = Number(match[1]);
    const operationId = Number(match[2]);
    const job = jobs.find((item) => item.id === jobId);
    if (!job?.operations) return;
    const original = computeOperationSchedule(job).find((entry) => entry.op.id === operationId);
    if (!original) return;

    const shiftMs = task.start.getTime() - original.start.getTime();
    const durationHours = Math.max(0.25, (task.end.getTime() - task.start.getTime()) / 3_600_000);
    const operations = job.operations.map((operation) => operation.id === operationId
      ? { ...operation, hours: Number(durationHours.toFixed(2)) }
      : operation);
    const totalHours = operations.reduce((sum, operation) => sum + operation.hours, 0);
    const start = new Date(new Date(job.start).getTime() + shiftMs);
    const startStr = toLocalDateTimeString(start);
    const endStr = toLocalDateTimeString(new Date(start.getTime() + totalHours * 3_600_000));

    pushHistory();
    void updateJob(jobId, { operations, start: startStr, end: endStr }).then(reportWriteResult);
    adjustDependencies(jobId, startStr, endStr, jobs);
  }

  function handleDateChange(task: GanttTask) {
    if (task.id.startsWith('op-')) {
      handleOperationDateChange(task);
      return;
    }
    const jobId = jobIdFromTaskId(task.id);
    if (!jobId) return;
    const job = jobs.find((item) => item.id === jobId);
    pushHistory();
    // Snapping already happened live during the drag (DravaGantt's snapTime prop) — the task
    // arrives with its final times; snapping again here would fight keyboard fine-nudges.
    const delta = task.start.getTime() - new Date(job?.start ?? task.start).getTime();
    const startStr = toLocalDateTimeString(task.start);
    const endStr = toLocalDateTimeString(task.end);

    void updateJob(jobId, {
      start: startStr,
      end: endStr,
    }).then(reportWriteResult);
    adjustDependencies(jobId, startStr, endStr, jobs);
    // Bulk move: co-selected jobs shift by the same delta — but only when the dragged job is
    // itself part of the selection (dragging an unselected bar must not move the selection).
    if (selectedIds.has(jobId)) {
      selectedIds.forEach((selectedId) => {
        if (selectedId === jobId) return;
        const selected = jobs.find((item) => item.id === selectedId);
        if (!selected) return;
        void updateJob(selectedId, { start: toLocalDateTimeString(new Date(new Date(selected.start).getTime() + delta)), end: toLocalDateTimeString(new Date(new Date(selected.end).getTime() + delta)) }).then(reportWriteResult);
      });
    }
    const movedCount = selectedIds.has(jobId) ? selectedIds.size : 1;
    const label = job?.order || job?.machine || task.name;
    showUndoToast(`${movedCount > 1 ? `${movedCount} × · ` : ''}${label} → ${task.start.toLocaleString(lang === 'hr' ? 'hr-HR' : 'en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
  }

  /** A bar was dropped on another machine's lane: reassign the machine along with the new times. */
  function handleLaneChange(task: GanttTask, laneId: string) {
    const jobId = jobIdFromTaskId(task.id);
    if (!jobId) return;
    const job = jobs.find((item) => item.id === jobId);
    if (!job || job.operations?.length || splitMachineChain(job.machine).length > 1) return;
    pushHistory();
    const startStr = toLocalDateTimeString(task.start);
    const endStr = toLocalDateTimeString(task.end);
    void updateJob(jobId, { machine: laneId, start: startStr, end: endStr }).then(reportWriteResult);
    adjustDependencies(jobId, startStr, endStr, jobs);
    showUndoToast(`${job.order || job.machine} → ${laneId}`);
  }

  function handleProgressChange(task: GanttTask) {
    // An operation row renders the parent job's progress; it is not separately tracked.
    if (task.id.startsWith('op-')) return;
    const jobId = jobIdFromTaskId(task.id);
    if (!jobId) return;
    pushHistory();
    void updateJob(jobId, { progress: Math.round(task.progress) }).then(reportWriteResult);
  }

  function handleDelete(task: GanttTask): boolean {
    // Deleting an operation row must not delete the work order it belongs to.
    if (task.id.startsWith('op-')) return false;
    const jobId = jobIdFromTaskId(task.id);
    if (!jobId) return false;
    pushHistory();
    removeJob(jobId);
    return true;
  }

  function addDependency() {
    setDepError('');
    const jobId = Number(depForm.jobId);
    const predecessorId = Number(depForm.predecessorId);
    const lagHours = parseFloat(depForm.lagHours) || 0;
    if (!jobId || !predecessorId || jobId === predecessorId) {
      setDepError(t.gantt.dependencyError);
      return;
    }
    if (lagHours < 0 && !['SS', 'SF'].includes(depForm.type)) {
      setDepError(lang === 'hr' ? 'Negativni pomak dopušten je samo za SS/SF veze.' : 'Negative lag is only allowed for SS/SF links.');
      return;
    }
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (job.dependencies?.some((d) => d.jobId === predecessorId)) return;
    const candidateJobs = jobs.map((item) => item.id === jobId ? { ...item, dependencies: [...(item.dependencies ?? []), { jobId: predecessorId, type: depForm.type, lagHours }] } : item);
    if (findDependencyCycle(jobsToScheduleInput(candidateJobs))) {
      setDepError(lang === 'hr' ? 'Ova veza stvara kružnu ovisnost.' : 'This link would create a dependency cycle.');
      return;
    }
    pushHistory();
    updateJob(jobId, {
      dependencies: [...(job.dependencies ?? []), { jobId: predecessorId, type: depForm.type, lagHours }],
    });
    setDepForm({ jobId: '', predecessorId: '', type: 'FS', lagHours: '0' });
  }

  function removeDependency(jobId: number, predecessorId: number) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    pushHistory();
    updateJob(jobId, { dependencies: (job.dependencies ?? []).filter((d) => d.jobId !== predecessorId) });
  }

  function handleSelect(task: GanttTask, selected: boolean) {
    const jobId = jobIdFromTaskId(task.id);
    if (!jobId) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(jobId); else next.delete(jobId);
      return next;
    });
  }

  function saveDependencyEdit() {
    if (!editingDependency) return;
    const job = jobs.find((item) => item.id === editingDependency.jobId);
    if (!job) return;
    pushHistory();
    updateJob(job.id, { dependencies: (job.dependencies ?? []).map((dependency) => dependency.jobId === editingDependency.predecessorId ? { ...dependency, type: editingDependency.type, lagHours: editingDependency.lagHours } : dependency) });
    setEditingDependency(null);
  }

  function toggleCollapsed(id: number) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('gantt-collapsed', JSON.stringify([...next]));
      return next;
    });
  }

  function togglePlanningTools() {
    setPlanningToolsOpen((open) => {
      localStorage.setItem('gantt-planning-tools-open', String(!open));
      return !open;
    });
  }

  function applyViewPreset(id: string) {
    setActivePresetId(id);
    const preset = viewPresets.find((item) => item.id === id);
    if (!preset) return;
    setSearch(preset.search);
    setMachineSort(preset.machineSort);
    setHighlightCritical(preset.highlightCritical);
    setViewMode(preset.viewMode);
  }

  function saveViewPreset() {
    const name = presetName.trim();
    if (!name) return;
    const preset: GanttViewPreset = { id: crypto.randomUUID(), name, search, machineSort, highlightCritical, viewMode };
    const next = [...viewPresets, preset].slice(-12);
    setViewPresets(next);
    localStorage.setItem(presetStorageKey, JSON.stringify(next));
    setActivePresetId(preset.id);
    setPresetName('');
    setPresetEditorOpen(false);
  }

  function deleteViewPreset() {
    if (!activePresetId) return;
    const next = viewPresets.filter((preset) => preset.id !== activePresetId);
    setViewPresets(next);
    localStorage.setItem(presetStorageKey, JSON.stringify(next));
    setActivePresetId('');
  }

  async function autoSchedule() {
    pushHistory();
    const effective = computeEffectiveSchedule(jobsToScheduleInput(jobs), { holidays: settings.holidays, workdayStart: settings.workdayStart, workdayEnd: settings.workdayEnd, skipWeekends: true });
    const machineEnd = new Map<string, number>();
    for (const job of [...jobs].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())) {
      if (hasChildren(jobs, job.id)) continue;
      const duration = Math.max(0, new Date(job.end).getTime() - new Date(job.start).getTime());
      const dependencyStart = effective.get(job.id)?.start ?? new Date(job.start).getTime();
      const previousEnd = machineEnd.get(job.machine) ?? 0;
      const start = Math.max(dependencyStart, previousEnd);
      const end = start + duration;
      machineEnd.set(job.machine, end);
      if (start !== new Date(job.start).getTime()) await updateJob(job.id, { start: toLocalDateTimeString(new Date(start)), end: toLocalDateTimeString(new Date(end)) });
    }
  }

  async function exportGantt(format: 'png' | 'pdf') {
    if (!pageContainerRef.current) return;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(pageContainerRef.current, { backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-page') || '#fff', scale: 1.6, useCORS: true });
    if (format === 'png') {
      const link = document.createElement('a'); link.download = `dravaint-gantt-${new Date().toISOString().slice(0, 10)}.png`; link.href = canvas.toDataURL('image/png'); link.click(); return;
    }
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, canvas.width, canvas.height);
    pdf.save(`dravaint-gantt-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  function machineEfficiency(machine: string) {
    const laneJobs = jobs.filter((job) => splitMachineChain(job.machine).includes(machine) || job.operations?.some((operation) => operation.machine === machine));
    if (!laneJobs.length) return 0;
    const start = Math.min(...laneJobs.map((job) => new Date(job.start).getTime()));
    const end = Math.max(...laneJobs.map((job) => new Date(job.end).getTime()));
    const active = laneJobs.reduce((sum, job) => sum + Math.max(0, new Date(job.end).getTime() - new Date(job.start).getTime()), 0);
    return end > start ? Math.min(100, Math.round(active / (end - start) * 100)) : 0;
  }

  const typeLabel: Record<DependencyType, string> = {
    FS: t.gantt.typeFS,
    SS: t.gantt.typeSS,
    FF: t.gantt.typeFF,
    SF: t.gantt.typeSF,
  };
  const editingJob = jobs.find((job) => job.id === editingJobId) ?? null;
  const editingConflicts = editingJob ? getJobConflicts(editingJob) : null;

  function moveOperation(job: Job, operationId: number, direction: -1 | 1) {
    if (!job.operations) return;
    const index = job.operations.findIndex((operation) => operation.id === operationId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= job.operations.length) return;
    const next = [...job.operations];
    [next[index], next[target]] = [next[target], next[index]];
    pushHistory();
    updateJob(job.id, { operations: next });
  }

  function dropOperation(job: Job, targetOperationId: number) {
    if (!job.operations || draggedOperation?.jobId !== job.id) return;
    const sourceIndex = job.operations.findIndex((operation) => operation.id === draggedOperation.operationId);
    const targetIndex = job.operations.findIndex((operation) => operation.id === targetOperationId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...job.operations];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    pushHistory();
    updateJob(job.id, { operations: next });
    setDraggedOperation(null);
  }

  return (
    <div ref={pageContainerRef} className={`wizard-container gantt-page${settings.compactMode ? ' gantt-compact' : ''}`}>
      <div className="page-heading-row"><div><span className="eyebrow">CPM · live planning</span><h2>{t.gantt.title}</h2><p className="subtitle-text">{t.gantt.subtitle}</p></div><div className="sync-badge"><span className="sync-dot" />{jobs.length} {lang === 'hr' ? 'naloga' : 'orders'}</div></div>
      {cycle && <div className="gantt-cycle-banner" role="alert"><strong>{lang === 'hr' ? 'Kružna ovisnost' : 'Dependency cycle'}</strong><span>{cycleLabel}</span></div>}
      {writeWarning && <div className="gantt-cycle-banner" role="alert"><strong>{lang === 'hr' ? 'Promjena nije spremljena' : 'Change not saved'}</strong><span>{writeWarning}</span></div>}

      <div className="gantt-command-deck glass-panel">
        <div className="gantt-search"><span>⌕</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setActivePresetId(''); }} placeholder={lang === 'hr' ? 'Traži nalog, operatera, proizvod…' : 'Search order, operator, product…'} /></div>
        <div className="gantt-command-actions">
          <button className="btn btn-blue" onClick={() => void autoSchedule()}>{lang === 'hr' ? 'Auto-raspored' : 'Auto-schedule'}</button>
          <button className="btn btn-ghost" onClick={undo} disabled={!history.length}>↶ {lang === 'hr' ? 'Poništi' : 'Undo'}</button>
          <button className="btn btn-ghost" onClick={redo} disabled={!future.length}>↷ {lang === 'hr' ? 'Ponovi' : 'Redo'}</button>
          <button className="btn btn-ghost" onClick={() => void exportGantt('png')}>PNG</button><button className="btn btn-ghost" onClick={() => void exportGantt('pdf')}>PDF</button>
          <button className="btn btn-ghost" onClick={() => pageContainerRef.current?.requestFullscreen()}>{lang === 'hr' ? 'Cijeli zaslon' : 'Full screen'}</button>
          <button className={`btn btn-ghost gantt-tools-button${planningToolsOpen ? ' active' : ''}`} onClick={togglePlanningTools} aria-expanded={planningToolsOpen}>{lang === 'hr' ? 'Alati planiranja' : 'Planning tools'}</button>
        </div>
        <div className="gantt-filter-row"><label><input type="checkbox" checked={highlightCritical} onChange={(event) => { setHighlightCritical(event.target.checked); setActivePresetId(''); }} /> {lang === 'hr' ? 'Kritični put' : 'Critical path'}</label><label>{lang === 'hr' ? 'Poredaj strojeve' : 'Sort machines'}<select value={machineSort} onChange={(event) => { setMachineSort(event.target.value as typeof machineSort); setActivePresetId(''); }}><option value="name">A–Z</option><option value="jobs">{lang === 'hr' ? 'Broj naloga' : 'Job count'}</option><option value="load">{lang === 'hr' ? 'Opterećenje' : 'Workload'}</option></select></label><div className="gantt-preset-control"><select value={activePresetId} onChange={(event) => applyViewPreset(event.target.value)} aria-label={lang === 'hr' ? 'Spremljeni prikazi' : 'Saved views'}><option value="">{lang === 'hr' ? 'Spremljeni prikazi' : 'Saved views'}</option>{viewPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><button type="button" onClick={() => setPresetEditorOpen((open) => !open)}>+ {lang === 'hr' ? 'Spremi prikaz' : 'Save view'}</button>{activePresetId && <button type="button" className="preset-delete" onClick={deleteViewPreset} aria-label={lang === 'hr' ? 'Izbriši spremljeni prikaz' : 'Delete saved view'}>×</button>}</div></div>
        {presetEditorOpen && <div className="gantt-preset-editor"><input type="text" value={presetName} onChange={(event) => setPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveViewPreset(); if (event.key === 'Escape') setPresetEditorOpen(false); }} placeholder={lang === 'hr' ? 'Naziv prikaza, npr. Kritični CNC' : 'View name, e.g. Critical CNC'} autoFocus /><button className="btn btn-blue" onClick={saveViewPreset} disabled={!presetName.trim()}>{lang === 'hr' ? 'Spremi' : 'Save'}</button><button className="btn btn-ghost" onClick={() => setPresetEditorOpen(false)}>{lang === 'hr' ? 'Odustani' : 'Cancel'}</button></div>}
      </div>

      <div className="gantt-status-legend"><span><i className="legend-planned" />{lang === 'hr' ? 'Planirano' : 'Planned'}</span><span><i className="legend-active" />{lang === 'hr' ? 'U tijeku' : 'In progress'}</span><span><i className="legend-done" />{lang === 'hr' ? 'Završeno' : 'Done'}</span><span><i className="legend-delayed" />{lang === 'hr' ? 'Kašnjenje' : 'Delayed'}</span><span><i className="legend-critical" />{lang === 'hr' ? 'Kritični put' : 'Critical'}</span></div>

      <button className="gantt-tool-summary" onClick={togglePlanningTools} aria-expanded={planningToolsOpen}>
        <span><b>{lang === 'hr' ? 'Radionica planiranja' : 'Planning workshop'}</b><small>{validJobs.length} {lang === 'hr' ? 'naloga' : 'orders'} · {dependencyCount} {lang === 'hr' ? 'veza' : 'dependencies'} · {Object.keys(baseline).length ? (lang === 'hr' ? 'bazni plan spremljen' : 'baseline saved') : (lang === 'hr' ? 'bez baznog plana' : 'no baseline')}</small></span>
        <i>{planningToolsOpen ? '−' : '+'}</i>
      </button>

      {jobs.some((job) => hasChildren(jobs, job.id)) && <div className="gantt-tree-controls">{jobs.filter((job) => hasChildren(jobs, job.id)).map((job) => <button key={job.id} onClick={() => toggleCollapsed(job.id)}><span>{collapsedIds.has(job.id) ? '›' : '⌄'}</span>{job.order}</button>)}</div>}

      {planningToolsOpen && <section className="gantt-planning-tools" aria-label={lang === 'hr' ? 'Alati planiranja' : 'Planning tools'}>
      <div className="step-box">
        <div className="step-title">
          <span className="step-number">1</span>
          {t.progress.addTask}
        </div>
        <div className="grid-inputs workers-ruster">
          <div>
            <label>{t.progress.task}</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>{t.common.start}</label>
            <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          </div>
          <div>
            <label>{t.common.end}</label>
            <input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="action-bar">
        <button className="btn btn-green" onClick={handleAdd}>
          <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
          {t.common.add}
        </button>
      </div>

      <div className="step-box" style={{ marginTop: 20 }}>
        <div className="step-title">
          <span className="step-number">2</span>
          {t.gantt.dependencies}
        </div>
        <div className="grid-inputs workers-ruster">
          <div>
            <label>{t.progress.task}</label>
            <select value={depForm.jobId} onChange={(e) => setDepForm({ ...depForm, jobId: e.target.value })}>
              <option value="">{t.gantt.selectPredecessor}</option>
              {predecessorOptions.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.order || j.machine}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{t.gantt.predecessor}</label>
            <select
              value={depForm.predecessorId}
              onChange={(e) => setDepForm({ ...depForm, predecessorId: e.target.value })}
            >
              <option value="">{t.gantt.selectPredecessor}</option>
              {schedulableJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.order || j.machine}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{t.gantt.dependencyType}</label>
            <select
              value={depForm.type}
              onChange={(e) => setDepForm({ ...depForm, type: e.target.value as DependencyType })}
            >
              {DEPENDENCY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeLabel[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{t.gantt.lagHours}</label>
            <input
              type="number"
              step="0.5"
              value={depForm.lagHours}
              onChange={(e) => setDepForm({ ...depForm, lagHours: e.target.value })}
            />
          </div>
        </div>
        <div className="action-bar" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-blue" onClick={addDependency}>
            <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.gantt.addDependency}
          </button>
        </div>
        {depError && <p style={{ color: 'var(--danger-color)', fontSize: 13, marginTop: 10 }}>{depError}</p>}

        <div style={{ marginTop: 15 }}>
          {!hasAnyDependency ? (
            <p className="subtitle-text" style={{ fontSize: 13 }}>{t.gantt.noDependencies}</p>
          ) : (
            validJobs
              .filter((j) => (j.dependencies?.length ?? 0) > 0)
              .map((j) => (
                <div key={j.id} style={{ marginBottom: 8, fontSize: 12 }}>
                  <strong>{j.order || j.machine}</strong>:{' '}
                  {j.dependencies!.map((dep) => {
                    const predJob = jobs.find((p) => p.id === dep.jobId);
                    return (
                      <span key={dep.jobId} className="role-chip dependency-chip" style={{ marginRight: 6 }} onClick={() => setEditingDependency({ jobId: j.id, predecessorId: dep.jobId, type: dep.type, lagHours: dep.lagHours })}>
                        {predJob?.order || predJob?.machine || dep.jobId} ({typeLabel[dep.type]}
                        {dep.lagHours ? `, +${dep.lagHours}h` : ''})
                        <button onClick={(event) => { event.stopPropagation(); removeDependency(j.id, dep.jobId); }}>×</button>
                      </span>
                    );
                  })}
                </div>
              ))
          )}
        </div>
        {editingDependency && <div className="dependency-editor"><strong>{lang === 'hr' ? 'Uredi vezu' : 'Edit dependency'}</strong><select value={editingDependency.type} onChange={(event) => setEditingDependency({ ...editingDependency, type: event.target.value as DependencyType })}>{DEPENDENCY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select><input type="number" step="0.5" value={editingDependency.lagHours} onChange={(event) => setEditingDependency({ ...editingDependency, lagHours: Number(event.target.value) })} /><button className="btn btn-blue" onClick={saveDependencyEdit}>{lang === 'hr' ? 'Spremi' : 'Save'}</button><button className="btn btn-ghost" onClick={() => setEditingDependency(null)}>×</button></div>}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 15, flexWrap: 'wrap' }}>
        <button className="btn btn-blue" onClick={saveBaseline} style={{ fontSize: 12, padding: '6px 12px', width: 'auto' }}>
          💾 {lang === 'hr' ? 'Spremi bazni plan' : 'Save Baseline'}
        </button>
        <button
          className="btn btn-green"
          onClick={() => setShowBaseline(!showBaseline)}
          style={{ fontSize: 12, padding: '6px 12px', width: 'auto', background: showBaseline ? 'var(--success-color)' : 'var(--primary-light)', color: showBaseline ? 'white' : 'var(--primary-color)' }}
        >
          🔍 {lang === 'hr' ? 'Prikaži odstupanja' : 'Show Deviations'}
        </button>
      </div>

      {showBaseline && (
        <div className="step-box" style={{ marginTop: 15, background: 'var(--bg-step)', padding: 15, borderRadius: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--text-primary)' }}>
            📋 {lang === 'hr' ? 'Log odstupanja od baznog plana' : 'Baseline Deviation Log'}
          </div>
          {jobs.map((j) => {
            const baseVal = baseline[j.id];
            if (!baseVal) return null;
            const currentStart = new Date(j.start).getTime();
            const baseStart = new Date(baseVal.start).getTime();
            const diffHrs = Math.round((currentStart - baseStart) / (1000 * 60 * 60));

            return (
              <div key={j.id} style={{ fontSize: 12, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>{j.order || j.machine}</span>
                {diffHrs === 0 ? (
                  <span style={{ color: 'var(--success-color)' }}>{lang === 'hr' ? 'Na rasporedu (0h)' : 'On Schedule (0h)'}</span>
                ) : diffHrs > 0 ? (
                  <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>{lang === 'hr' ? `Kasni +${diffHrs}h` : `Delayed +${diffHrs}h`}</span>
                ) : (
                  <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{lang === 'hr' ? `Ubrzano ${diffHrs}h` : `Ahead ${diffHrs}h`}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      </section>}

      <div className="view-toggle" style={{ marginTop: 18 }}>
        {viewModeOptions.map((opt) => (
          <button
            key={opt.value}
            className={viewMode === opt.value ? 'active' : ''}
            onClick={() => setViewMode(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? <div className="gantt-skeleton" aria-label="Loading"><span /><span /><span /><span /></div> : validJobs.length === 0 ? (
        <p className="subtitle-text" style={{ fontSize: 13 }}>{t.machines.noJobs}</p>
      ) : (
        <div className="step-box gantt-container" style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 'var(--radius-card)', border: '1px solid var(--border-color)', margin: '15px 0 0' }}>
          <DravaGantt
            ref={ganttRef}
            lanes={ganttLanes}
            viewMode={viewMode}
            locale={lang === 'hr' ? 'hr-HR' : 'en-US'}
            rowHeight={settings.ganttRowHeight}
            barFillPercent={settings.ganttBarFill}
            emptyLaneLabel={lang === 'hr' ? 'Nema dodijeljenih naloga' : 'No assigned work orders'}
            taskCountLabel={(count) => `${count} ${lang === 'hr' ? 'zadataka' : 'tasks'}`}
            onDateChange={handleDateChange}
            onProgressChange={handleProgressChange}
            onDelete={handleDelete}
            onDoubleClick={(task) => setEditingJobId(jobIdFromTaskId(task.id))}
            onSelect={handleSelect}
            onLaneChange={handleLaneChange}
            renderTooltip={renderGanttTooltip}
            snapTime={ganttSnapTime}
            getDragPreview={getGanttDragPreview}
            selectionHint={selectionHint}
            revertNonce={ganttRevertNonce}
          />
        </div>
      )}

      {editingJob && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingJobId(null); }}><div className="modal-content gantt-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="gantt-edit-title"><div className="modal-header"><div><span className="eyebrow">{editingJob.order}</span><h3 id="gantt-edit-title">{lang === 'hr' ? 'Detalji radnog naloga' : 'Work order details'}</h3></div><button className="drawer-close-btn" onClick={() => setEditingJobId(null)}>×</button></div><div className="modal-body"><div className="gantt-edit-grid"><label>{lang === 'hr' ? 'Proizvod' : 'Product'}<input defaultValue={editingJob.product} onBlur={(event) => updateJob(editingJob.id, { product: event.target.value })} /></label><label>{lang === 'hr' ? 'Operater' : 'Operator'}<input defaultValue={editingJob.operator} onBlur={(event) => updateJob(editingJob.id, { operator: event.target.value })} /></label><label>{t.common.start}<input type="datetime-local" defaultValue={editingJob.start} onBlur={(event) => updateJob(editingJob.id, { start: event.target.value })} /></label><label>{t.common.end}<input type="datetime-local" defaultValue={editingJob.end} onBlur={(event) => updateJob(editingJob.id, { end: event.target.value })} /></label><label>{lang === 'hr' ? 'Priprema (h)' : 'Setup (h)'}<input type="number" min={0} step="0.25" defaultValue={editingJob.setupHours ?? 0} onBlur={(event) => updateJob(editingJob.id, { setupHours: Number(event.target.value) })} /></label><label>{lang === 'hr' ? 'Materijal' : 'Material'}<select value={editingJob.materialStatus ?? 'ready'} onChange={(event) => updateJob(editingJob.id, { materialStatus: event.target.value as Job['materialStatus'] })}><option value="ready">Ready</option><option value="waiting">Waiting</option><option value="delayed">Delayed</option></select></label><label className="full-field">{lang === 'hr' ? 'Napomene' : 'Comments'}<textarea defaultValue={editingJob.comments} onBlur={(event) => updateJob(editingJob.id, { comments: event.target.value })} /></label></div>
      {editingJob.operations?.length ? <div className="operation-reorder-list"><strong>{lang === 'hr' ? 'Redoslijed operacija' : 'Operation route'}</strong>{editingJob.operations.map((operation, index) => <div key={operation.id} draggable onDragStart={() => setDraggedOperation({ jobId: editingJob.id, operationId: operation.id })} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOperation(editingJob, operation.id)}><span className="operation-drag-handle">{index + 1}</span><b>{operation.name}</b><small>{operation.machine} · {operation.hours}h</small><button onClick={() => moveOperation(editingJob, operation.id, -1)} disabled={index === 0}>↑</button><button onClick={() => moveOperation(editingJob, operation.id, 1)} disabled={index === editingJob.operations!.length - 1}>↓</button></div>)}</div> : null}
      {editingConflicts && Object.values(editingConflicts).length > 0 && <div className="conflict-summary">{Object.entries(editingConflicts).map(([key, value]) => <span key={key}><b>{key}</b>{'message' in value ? value.message : value.otherOrder}</span>)}</div>}</div><div className="modal-footer"><button className="btn btn-blue" onClick={() => setEditingJobId(null)}>{lang === 'hr' ? 'Gotovo' : 'Done'}</button></div></div></div>}

      {undoToast && (
        <div className="gantt-undo-toast" role="status">
          <span>{undoToast}</span>
          <button
            type="button"
            onClick={() => {
              undo();
              if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current);
              setUndoToast('');
            }}
          >
            ↶ {lang === 'hr' ? 'Poništi' : 'Undo'}
          </button>
          <button type="button" className="gantt-undo-toast-close" onClick={() => setUndoToast('')} aria-label={lang === 'hr' ? 'Zatvori' : 'Dismiss'}>×</button>
        </div>
      )}

      {/* Floating Scroll-to-Today Button */}
      <button
        onClick={() => ganttRef.current?.scrollToNow()}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 1000,
          background: 'var(--primary-color)',
          color: 'white',
          border: 'none',
          borderRadius: '50px',
          padding: '12px 24px',
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          fontWeight: 600,
          transition: 'transform 0.2s, background-color 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.opacity = '0.9';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'none';
          e.currentTarget.style.opacity = '1';
        }}
      >
        📅 {lang === 'hr' ? 'Skoči na Danas' : 'Scroll to Today'}
      </button>
    </div>
  );
}
