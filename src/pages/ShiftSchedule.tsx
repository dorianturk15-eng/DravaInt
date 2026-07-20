import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { IconPrint, IconRefresh } from '../components/Icons';
import { InlineNotice } from '../components/Page';
import { useLanguage } from '../i18n/LanguageContext';
import { useLogo } from '../logo/LogoContext';
import { useShifts, type PublicationSnapshot, type ShiftAssignment, type ShiftDefinition, type ShiftScheduleRecord } from '../shifts/ShiftsContext';
import { downloadShiftSchedulePdf } from '../shifts/shiftPdf';
import { dominantShift, planRotation } from '../shifts/rotation';
import { RotationBoard } from '../shifts/RotationBoard';
import { useWorkers } from '../workers/WorkersContext';

const DAY_MS = 86_400_000;
/** Regular rotation only ever covers Monday–Friday; weekend work is the exception. */
const WORKDAY_COUNT = 5;
const FULL_WEEK_COUNT = 7;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

/** Snaps any date back to the Monday of its ISO week. */
function mondayOf(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return isoDate(date);
}

function isWeekend(value: string) {
  const day = new Date(`${value}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

function getIsoWeek(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const weekOne = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - weekOne.getTime()) / DAY_MS - 3 + ((weekOne.getDay() + 6) % 7)) / 7);
}

/** The ISO week-numbering year the date belongs to — NOT the calendar year. 2025-12-29 is week 1
 *  of 2026; pairing week 1 with calendar year 2025 collides with the real week 1/2025 record. */
function getIsoWeekYear(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  return date.getFullYear();
}

function shiftDuration(start: string, end: string) {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

/** A stable fingerprint of a set of assignments, order-independent, used to tell
 *  whether a working copy still matches what was published. */
function assignmentSignature(assignments: ShiftAssignment[]) {
  return assignments
    .map((assignment) => `${assignment.date}|${assignment.shiftDefinitionId}|${assignment.workerId}`)
    .sort()
    .join(';');
}

function downloadCsv(schedules: Array<{ weekNumber: number; assignments: ShiftAssignment[] }>, workerName: (id: number) => string, shiftName: (id: number) => string) {
  const rows = [['Week', 'Date', 'Shift', 'Worker', 'Override', 'Notes']];
  schedules.forEach((schedule) => schedule.assignments.forEach((assignment) => rows.push([
    String(schedule.weekNumber), assignment.date, shiftName(assignment.shiftDefinitionId), workerName(assignment.workerId), assignment.isOverride ? 'Yes' : 'No', assignment.notes,
  ])));
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `dravaint-shifts-${isoDate(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ShiftSchedule() {
  const { lang, t } = useLanguage();
  const { username } = useAuth();
  const { workers, activeWorkers, displayName, updateWorker } = useWorkers();
  const { logo } = useLogo();
  const { definitions, schedules, publications, absences, saveSchedule, publishSchedule, generateSchedule: generateRemoteSchedule, saveAbsence, exportIcs } = useShifts();
  const today = isoDate(new Date());

  // All active shifts get a lane, including the third/overnight shift. (Whether
  // to hide the third shift from regular scheduling is pending confirmation.)
  const scheduleDefinitions = useMemo(
    () => definitions.filter((definition) => definition.isActive),
    [definitions],
  );

  const [startDate, setStartDate] = useState(() => mondayOf(localStorage.getItem('shift-board-start') || today));
  const [weekCount, setWeekCount] = useState(4);
  const [showWeekend, setShowWeekend] = useState(() => localStorage.getItem('shift-board-weekend') === 'true');
  const [view, setView] = useState<'planner' | 'archive'>('planner');
  const [department, setDepartment] = useState(() => localStorage.getItem('shift-board-department') || 'Alatnica');
  const [participantIds, setParticipantIds] = useState<number[]>(() => activeWorkers.map((worker) => worker.id));
  const [drafts, setDrafts] = useState<ShiftScheduleRecord[]>([]);
  const [dragged, setDragged] = useState<ShiftAssignment | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ scheduleId: number; assignmentId: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [showHours, setShowHours] = useState(true);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [absenceWorker, setAbsenceWorker] = useState('');
  const [absenceStart, setAbsenceStart] = useState(today);
  const [absenceEnd, setAbsenceEnd] = useState(today);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState<PublicationSnapshot | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});
  const [printingSnapshotId, setPrintingSnapshotId] = useState<number | null>(null);
  /** The week whose day grid is open. The day grid is the per-week DETAIL editor
   *  now — the Rotation Board is the landing view — so null means "board only". */
  const [detailWeekId, setDetailWeekId] = useState<number | null>(null);

  useEffect(() => {
    // Prune selections for workers that no longer exist (e.g. a stale localStorage
    // seed cached before the live Supabase workers list loaded) — passing their ids
    // to generate_shift_schedule would hit a foreign-key violation server-side.
    setParticipantIds((current) => {
      const pruned = current.filter((id) => activeWorkers.some((worker) => worker.id === id));
      if (pruned.length === 0) return activeWorkers.map((worker) => worker.id);
      return pruned.length === current.length ? current : pruned;
    });
  }, [activeWorkers]);

  useEffect(() => localStorage.setItem('shift-board-weekend', String(showWeekend)), [showWeekend]);

  // Name lookup spans ALL workers (including archived): existing schedules, the publication archive
  // and reprinted PDFs must keep showing a departed worker's name, not degrade to "#7".
  const workerById = useMemo(() => new Map(workers.map((worker) => [worker.id, worker])), [workers]);
  const definitionById = useMemo(() => new Map(definitions.map((definition) => [definition.id, definition])), [definitions]);
  const maxWeeklyHours = Number(localStorage.getItem('cfg-max-hours')) || 48;
  const dayCount = showWeekend ? FULL_WEEK_COUNT : WORKDAY_COUNT;
  /** Publication history grouped into one entry per week+department, each holding
   *  its version lineage newest-first. This is the immutable audit trail. */
  const publicationGroups = useMemo(() => {
    const byWeek = new Map<string, PublicationSnapshot[]>();
    for (const snapshot of publications) {
      const key = `${snapshot.year}|${snapshot.weekNumber}|${snapshot.department}`;
      const list = byWeek.get(key) ?? [];
      list.push(snapshot);
      byWeek.set(key, list);
    }
    return [...byWeek.entries()]
      .map(([key, snapshots]) => {
        const versions = [...snapshots].sort((a, b) => b.version - a.version);
        return { key, latest: versions[0], versions };
      })
      .sort((a, b) => b.latest.startDate.localeCompare(a.latest.startDate));
  }, [publications]);

  /** The most recent snapshot for a live schedule's week, or null if never published. */
  function latestSnapshotFor(schedule: ShiftScheduleRecord) {
    return publications
      .filter((snapshot) => snapshot.year === schedule.year && snapshot.weekNumber === schedule.weekNumber && snapshot.department === schedule.department)
      .reduce<PublicationSnapshot | null>((latest, snapshot) => (!latest || snapshot.version > latest.version ? snapshot : latest), null);
  }

  /** Whether a working copy has diverged from what was last published. */
  function isModifiedSincePublish(schedule: ShiftScheduleRecord) {
    const snapshot = latestSnapshotFor(schedule);
    if (!snapshot) return false;
    return assignmentSignature(schedule.assignments) !== assignmentSignature(snapshot.assignments);
  }

  function nameForWorker(id: number) {
    const worker = workerById.get(id);
    return worker ? displayName(worker) : `#${id}`;
  }

  /** Group the printed roster by fixed-shift vs rotating, mirroring the Rotation
   *  Board's two row groups, so the sheet and the screen order people the same
   *  way. Sorts fixed first — they are the stable block readers scan past. */
  function pdfWorkerGroup(id: number) {
    return workerById.get(id)?.fixedShiftDefinitionId != null ? '0-fixed' : '1-rotating';
  }

  function pdfGroupLabel(group: string) {
    // Kept short deliberately: the band spans the table but the vertical column
    // rules are drawn over it, so a long label gets struck through.
    if (group === '0-fixed') return lang === 'hr' ? 'Stalna smjena' : 'Fixed shift';
    return lang === 'hr' ? 'Rotacija' : 'Rotating';
  }

  function nameForShift(id: number) {
    const shift = definitionById.get(id);
    if (!shift) return `#${id}`;
    return lang === 'hr' ? shift.nameHr : shift.nameEn;
  }

  /** Lanes for a schedule: the regular ones, plus any retired lane this specific
   * schedule still holds assignments for, so history stays readable. */
  function lanesFor(schedule: ShiftScheduleRecord): ShiftDefinition[] {
    const retired = definitions.filter((definition) =>
      !scheduleDefinitions.some((regular) => regular.id === definition.id)
      && schedule.assignments.some((assignment) => assignment.shiftDefinitionId === definition.id));
    return [...scheduleDefinitions, ...retired];
  }

  function isAbsent(workerId: number, date: string) {
    return absences.some((absence) => absence.workerId === workerId && date >= absence.startDate && date <= absence.endDate);
  }

  async function generateSchedule() {
    if (!scheduleDefinitions.length || !participantIds.length) {
      setGenerationError(!scheduleDefinitions.length
        ? (t.shiftPlanner.noActiveShiftDefinitions)
        : (t.shiftPlanner.noWorkersDatabaseAdd));
      return;
    }
    setGenerationError('');
    setIsGenerating(true);
    const weekStart = mondayOf(startDate);
    let remoteSchedules: ShiftScheduleRecord[] | null;
    try {
      remoteSchedules = await generateRemoteSchedule(weekStart, Math.min(12, Math.max(1, weekCount)), participantIds, department);
    } catch (error) {
      // Supabase/PostgREST errors are not always Error instances — read .message off
      // plain error objects too so the real Postgres error reaches the user.
      const message = error instanceof Error
        ? error.message
        : (typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : '');
      setGenerationError(message || (t.shiftPlanner.scheduleGenerationFailed));
      setIsGenerating(false);
      return;
    }
    if (remoteSchedules) {
      setDrafts(remoteSchedules
        .filter((schedule) => schedule.startDate >= weekStart && schedule.startDate < addDays(weekStart, weekCount * 7) && schedule.department === department)
        .sort((a, b) => a.startDate.localeCompare(b.startDate)));
      localStorage.setItem('shift-board-start', weekStart);
      localStorage.setItem('shift-board-department', department);
      setIsGenerating(false);
      return;
    }
    const previousOverrides = schedules.flatMap((schedule) => schedule.assignments).filter((assignment) => assignment.isOverride);
    const generated: ShiftScheduleRecord[] = [];
    const weeks = Math.min(12, Math.max(1, weekCount));

    // Mirror of generate_shift_schedule v3 (migration 0010): phase anchored to
    // each worker's own previous week, plus the never-rotates fixed group.
    const priorWeekStart = addDays(weekStart, -7);
    const priorSchedule = schedules.find(
      (schedule) => schedule.startDate === priorWeekStart && schedule.department === department,
    );
    const laneOrder = scheduleDefinitions.map((definition) => definition.id);
    const rotation = planRotation({
      workers: participantIds.map((id) => ({
        id,
        fixedShiftDefinitionId: workerById.get(id)?.fixedShiftDefinitionId ?? null,
      })),
      definitions: scheduleDefinitions.map((definition) => ({ id: definition.id, isActive: true })),
      weekCount: weeks,
      previousWeekShift: (workerId) =>
        priorSchedule ? dominantShift(priorSchedule.assignments, workerId, laneOrder) : null,
    });

    for (let weekIndex = 0; weekIndex < weeks; weekIndex++) {
      const currentWeekStart = addDays(weekStart, weekIndex * 7);
      const existing = schedules.find((schedule) => schedule.startDate === currentWeekStart && schedule.department === department);
      const scheduleId = existing?.id ?? Date.now() + weekIndex;
      const assignments: ShiftAssignment[] = [];
      let assignmentId = scheduleId * 1000;

      // Only Mon–Fri is rotated. Weekend columns stay empty and are filled by hand.
      for (let day = 0; day < WORKDAY_COUNT; day++) {
        const date = addDays(currentWeekStart, day);
        participantIds.forEach((workerId) => {
          if (isAbsent(workerId, date)) return;
          const override = previousOverrides.find((item) => item.workerId === workerId && item.date === date);
          if (override) {
            assignments.push({ ...override, id: assignmentId++, scheduleId });
            return;
          }
          const shiftId = rotation.weeks[weekIndex].get(workerId);
          if (shiftId == null) return;
          assignments.push({ id: assignmentId++, scheduleId, workerId, shiftDefinitionId: shiftId, date, isOverride: false, notes: '' });
        });
      }

      generated.push({
        id: scheduleId,
        weekNumber: getIsoWeek(currentWeekStart),
        year: getIsoWeekYear(currentWeekStart),
        startDate: currentWeekStart,
        endDate: addDays(currentWeekStart, 6),
        department,
        status: existing?.status ?? 'draft',
        version: existing?.version ?? 0,
        assignments,
      });
    }
    setDrafts(generated);
    localStorage.setItem('shift-board-start', weekStart);
    localStorage.setItem('shift-board-department', department);
    setIsGenerating(false);
  }

  useEffect(() => {
    if (drafts.length === 0 && activeWorkers.length && scheduleDefinitions.length) void generateSchedule();
    // Initial generation intentionally waits until providers have hydrated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkers.length, scheduleDefinitions.length]);

  function moveAssignment(scheduleId: number, date: string, shiftDefinitionId: number) {
    if (!dragged || dragged.scheduleId !== scheduleId) return;
    setDrafts((current) => current.map((schedule) => schedule.id === scheduleId ? {
      ...schedule,
      assignments: schedule.assignments.map((assignment) => assignment.id === dragged.id ? { ...assignment, date, shiftDefinitionId, isOverride: true } : assignment),
    } : schedule));
    setDragged(null);
    setDropTarget(null);
  }

  /**
   * Week-grain edit from the Rotation Board: move a worker onto one shift for a
   * whole week, writing through to the per-day assignments that remain the
   * storage format. The rows are marked as overrides so regeneration preserves
   * a deliberate week-level decision, exactly as it preserves a per-day drag.
   *
   * `applyForward` extends the change to every later week in the horizon —
   * "this worker is on second shift from week 31 onwards". Published weeks are
   * skipped; they must be unlocked explicitly like anywhere else on the page.
   */
  function setWeekShift(scheduleId: number, workerId: number, shiftDefinitionId: number, applyForward: boolean) {
    const fromIndex = drafts.findIndex((schedule) => schedule.id === scheduleId);
    if (fromIndex === -1) return;
    setDrafts((current) => current.map((schedule, index) => {
      const inScope = applyForward ? index >= fromIndex : schedule.id === scheduleId;
      if (!inScope || schedule.status === 'published') return schedule;
      return {
        ...schedule,
        assignments: schedule.assignments.map((assignment) => assignment.workerId === workerId
          ? { ...assignment, shiftDefinitionId, isOverride: true }
          : assignment),
      };
    }));
  }

  /** Pin a worker out of the rotation (or return them to it). */
  async function toggleFixedShift(workerId: number, shiftDefinitionId: number | null) {
    await updateWorker(workerId, { fixedShiftDefinitionId: shiftDefinitionId });
  }

  /** Does this worker's week breach the weekly-hours cap or a rest period? */
  function weekHasWarning(schedule: ShiftScheduleRecord, workerId: number) {
    if (weeklyHours(schedule, workerId) > maxWeeklyHours) return true;
    return schedule.assignments.some((assignment) => assignment.workerId === workerId
      && (hasRestViolation(schedule, assignment) || isAbsent(assignment.workerId, assignment.date)));
  }

  function reassignWorker(scheduleId: number, assignmentId: number, workerId: number) {
    setDrafts((current) => current.map((schedule) => schedule.id === scheduleId ? {
      ...schedule,
      assignments: schedule.assignments.map((assignment) => assignment.id === assignmentId ? { ...assignment, workerId, isOverride: true } : assignment),
    } : schedule));
    setEditing(null);
  }

  function weeklyHours(schedule: ShiftScheduleRecord, workerId: number) {
    return schedule.assignments.filter((assignment) => assignment.workerId === workerId).reduce((total, assignment) => {
      const definition = definitionById.get(assignment.shiftDefinitionId);
      return total + (definition ? shiftDuration(definition.startTime, definition.endTime) : 0);
    }, 0);
  }

  function hasRestViolation(schedule: ShiftScheduleRecord, assignment: ShiftAssignment) {
    const workerAssignments = schedule.assignments.filter((item) => item.workerId === assignment.workerId).sort((a, b) => a.date.localeCompare(b.date));
    const index = workerAssignments.findIndex((item) => item.id === assignment.id);
    if (index <= 0) return false;
    const previous = workerAssignments[index - 1];
    const previousShift = definitionById.get(previous.shiftDefinitionId);
    const currentShift = definitionById.get(assignment.shiftDefinitionId);
    if (!previousShift || !currentShift) return false;
    const previousEnd = new Date(`${previous.date}T${previousShift.endTime}:00`);
    if (previousShift.endTime <= previousShift.startTime) previousEnd.setDate(previousEnd.getDate() + 1);
    const currentStart = new Date(`${assignment.date}T${currentShift.startTime}:00`);
    return (currentStart.getTime() - previousEnd.getTime()) / 3_600_000 < 12;
  }

  function dropWouldConflict(schedule: ShiftScheduleRecord, date: string, shiftDefinitionId: number) {
    if (!dragged || dragged.scheduleId !== schedule.id) return false;
    const moved = { ...dragged, date, shiftDefinitionId };
    const preview = {
      ...schedule,
      assignments: schedule.assignments.map((assignment) => assignment.id === dragged.id ? moved : assignment),
    };
    return weeklyHours(preview, moved.workerId) > maxWeeklyHours || hasRestViolation(preview, moved) || isAbsent(moved.workerId, date);
  }

  async function saveAll() {
    const next: ShiftScheduleRecord[] = [];
    for (const schedule of drafts) next.push(await saveSchedule(schedule));
    setDrafts(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function publishOne(schedule: ShiftScheduleRecord) {
    const { record } = await publishSchedule(schedule, {
      publishedBy: username ?? '',
      dayCount,
      participantIds: participantIds.filter((id) => schedule.assignments.some((assignment) => assignment.workerId === id)),
    });
    setDrafts((current) => current.map((item) => item.id === schedule.id ? record : item));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  /**
   * Published weeks are locked. Editing withdraws the live row back to draft so
   * the crew never sees half-finished edits on the published schedule. This is
   * now non-destructive: the version that was published stays frozen in the
   * publication archive, so a later re-publish simply appends v2 and the audit
   * trail of what was actually printed is preserved.
   */
  async function unlockForEditing(schedule: ShiftScheduleRecord) {
    const reverted = await saveSchedule({ ...schedule, status: 'draft' });
    setDrafts((current) => current.map((item) => item.id === schedule.id ? reverted : item));
  }

  /**
   * Open a published week in the planner to revise it. We load the live working
   * copy (which may already carry unpublished edits), falling back to a draft
   * reconstructed from the snapshot if the live row is gone. The snapshot itself
   * is never edited — saving/re-publishing produces a new version.
   */
  function openFromArchive(snapshot: PublicationSnapshot) {
    const live = schedules.find((schedule) => schedule.year === snapshot.year && schedule.weekNumber === snapshot.weekNumber && schedule.department === snapshot.department);
    const working: ShiftScheduleRecord = live ?? {
      id: snapshot.scheduleId,
      weekNumber: snapshot.weekNumber,
      year: snapshot.year,
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      department: snapshot.department,
      status: 'draft',
      version: snapshot.version,
      assignments: snapshot.assignments.map((assignment) => ({ ...assignment })),
    };
    setDrafts([working]);
    setDepartment(snapshot.department);
    setStartDate(snapshot.startDate);
    setView('planner');
  }

  async function addAbsence() {
    const workerId = Number(absenceWorker);
    if (!workerId || absenceEnd < absenceStart) return;
    await saveAbsence({ workerId, startDate: absenceStart, endDate: absenceEnd, type: 'vacation', notes: '' });
    setAbsenceWorker('');
  }

  const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(t.common.locale, { weekday: 'short' });

  async function printSchedule() {
    if (!drafts.length || isPrinting) return;
    setIsPrinting(true);
    setGenerationError('');
    try {
      await downloadShiftSchedulePdf({
        schedules: drafts,
        participantIds,
        dayCount,
        lang,
        logo,
        companyName: 'Drava International d.o.o.',
        preparedBy: username ?? undefined,
        workerName: nameForWorker,
        workerGroup: pdfWorkerGroup,
        groupLabel: pdfGroupLabel,
        lanesFor,
        weeklyHours,
        definitionById,
      });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : (t.shiftPlanner.pdfExportFailed));
    } finally {
      setIsPrinting(false);
    }
  }

  /** Reprint the exact document that was published — using the snapshot's own
   *  roster and day range, not whatever the planner is currently showing. */
  async function printSnapshot(snapshot: PublicationSnapshot) {
    if (printingSnapshotId !== null) return;
    setPrintingSnapshotId(snapshot.id);
    setGenerationError('');
    try {
      await downloadShiftSchedulePdf({
        schedules: [{ ...snapshot, status: 'published' }],
        participantIds: snapshot.participantIds,
        dayCount: snapshot.dayCount,
        lang,
        logo,
        companyName: 'Drava International d.o.o.',
        preparedBy: snapshot.publishedBy,
        workerName: nameForWorker,
        workerGroup: pdfWorkerGroup,
        groupLabel: pdfGroupLabel,
        lanesFor,
        weeklyHours,
        definitionById,
      });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : (t.shiftPlanner.pdfExportFailed));
    } finally {
      setPrintingSnapshotId(null);
    }
  }

  const dateTimeLabel = (iso: string) => new Date(iso).toLocaleString(t.common.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="wizard-container shift-planner-page">
      <div className="page-heading-row no-print">
        <div>
          <span className="eyebrow">{t.shiftPlanner.capacityPlanning}</span>
          <h2>{t.shifts.wizardTitle}</h2>
          <p className="subtitle-text">{t.shiftPlanner.interactiveShiftRotationWith}</p>
        </div>
        <div className="sync-badge"><span className="sync-dot" /> {t.shiftPlanner.synced}</div>
      </div>

      <div className="shift-view-tabs no-print" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'planner'} className={view === 'planner' ? 'active' : ''} onClick={() => setView('planner')}>{t.shiftPlanner.planner}</button>
        <button type="button" role="tab" aria-selected={view === 'archive'} className={view === 'archive' ? 'active' : ''} onClick={() => setView('archive')}>{t.shiftPlanner.publishedSchedules}<span className="tab-count">{publicationGroups.length}</span></button>
      </div>

      {view === 'archive' ? (
        <section className="glass-panel archive-panel no-print">
          <div className="section-title-row">
            <h3>{t.shiftPlanner.publishedScheduleArchive}</h3>
            <span>{publicationGroups.length}</span>
          </div>
          <p className="archive-intro">{t.shiftPlanner.everyPublishSavesPermanent}</p>
          {generationError && <div className="inline-error" role="alert">{generationError}</div>}
          {publicationGroups.length === 0 ? (
            <p className="archive-empty">{t.shiftPlanner.noPublishedSchedulesYet}</p>
          ) : (
            <div className="archive-list">
              {publicationGroups.map(({ key, latest, versions }) => {
                const expanded = expandedWeeks[key] ?? false;
                const shown = expanded ? versions : versions.slice(0, 1);
                return (
                  <article className="archive-group" key={key}>
                    <header className="archive-group-head">
                      <div className="archive-week">
                        <strong>{latest.weekNumber}. {t.shiftPlanner.week} {latest.year}</strong>
                        <small>{latest.startDate} — {latest.endDate}</small>
                      </div>
                      <div className="archive-meta">
                        <span className="role-chip">{latest.department}</span>
                        {versions.length > 1
                          ? <button type="button" className="text-button" onClick={() => setExpandedWeeks((current) => ({ ...current, [key]: !expanded }))}>{expanded ? (t.shiftPlanner.hideVersions) : `${versions.length} ${t.shiftPlanner.versionsShowAll}`}</button>
                          : <span>{t.shiftPlanner.singleVersion}</span>}
                      </div>
                    </header>
                    <div className="archive-versions">
                      {shown.map((snapshot) => {
                        const isCurrent = snapshot.version === latest.version;
                        return (
                          <div className={`archive-version${isCurrent ? ' is-current' : ''}`} key={snapshot.id}>
                            <div className="archive-version-info">
                              <span className={`version-badge${isCurrent ? ' current' : ''}`}>v{snapshot.version}</span>
                              {isCurrent && <span className="current-tag">{t.shiftPlanner.current}</span>}
                              <span className="archive-version-meta">{dateTimeLabel(snapshot.publishedAt)} · {snapshot.publishedBy} · {snapshot.assignments.length} {t.shiftPlanner.assignments}</span>
                            </div>
                            <div className="archive-actions">
                              <button className="btn btn-ghost btn-sm" onClick={() => setViewingSnapshot(snapshot)}>{t.shiftPlanner.view}</button>
                              <button className="btn btn-ghost btn-sm" disabled={printingSnapshotId !== null} onClick={() => void printSnapshot(snapshot)}>{printingSnapshotId === snapshot.id ? '…' : 'PDF'}</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv([snapshot], nameForWorker, nameForShift)}>CSV</button>
                              {isCurrent && <button className="btn btn-ghost btn-sm" onClick={() => openFromArchive(snapshot)}>{t.shiftPlanner.editPlanner}</button>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="planner-command-card glass-panel no-print">
            <div className="planner-fields">
              <label>{t.shiftPlanner.planStartMonday}<input type="date" value={startDate} onChange={(event) => { if (event.target.value) setStartDate(mondayOf(event.target.value)); }} /></label>
              <label>{t.shiftPlanner.weeks}<input type="number" min={1} max={12} value={weekCount} onChange={(event) => setWeekCount(Number(event.target.value) || 1)} /></label>
              <label>{t.shiftPlanner.department}<select value={department} onChange={(event) => setDepartment(event.target.value)}><option>Alatnica</option><option>Brizganje</option><option>Montaža</option><option>Kontrola kvalitete</option></select></label>
            </div>
            <div className="planner-actions">
              <button className="btn btn-blue" disabled={isGenerating} onClick={() => void generateSchedule()}><IconRefresh />{isGenerating ? (t.shiftPlanner.generating) : (t.shiftPlanner.generate)}</button>
              <button className="btn btn-green" onClick={saveAll}>{t.shiftPlanner.saveDraft}</button>
              <button className="btn btn-ghost" disabled={isPrinting || drafts.length === 0} onClick={() => void printSchedule()}><IconPrint />{isPrinting ? (t.shiftPlanner.buildingPdf) : t.common.print}</button>
              <button className="btn btn-ghost" onClick={() => downloadCsv(drafts, nameForWorker, nameForShift)}>CSV</button>
            </div>
            <div className="planner-toggle-row">
              <label className="weekend-toggle"><input type="checkbox" checked={showWeekend} onChange={(event) => setShowWeekend(event.target.checked)} /> {t.shiftPlanner.showWeekendSatSun}</label>
              <small>{t.shiftPlanner.weekendsNotAutoFilled}</small>
            </div>
            {saved && <InlineNotice tone="success">✓ {t.shiftPlanner.scheduleSaved}</InlineNotice>}
            {generationError && <div className="inline-error" role="alert">{generationError}</div>}
          </section>

          <section className="planner-sidebar-grid no-print">
            <div className="glass-panel participant-panel">
              <div className="section-title-row"><h3>{t.shiftPlanner.activeWorkers}</h3><span>{participantIds.length}/{activeWorkers.length}</span></div>
              <div className="worker-selector-grid">
                {activeWorkers.map((worker) => {
                  const selected = participantIds.includes(worker.id);
                  return <button key={worker.id} className={`worker-selector${selected ? ' selected' : ''}`} onClick={() => setParticipantIds((current) => selected ? current.filter((id) => id !== worker.id) : [...current, worker.id])}>
                    <span className="worker-avatar">{worker.firstName[0]}{worker.lastName[0]}</span><span><strong>{displayName(worker)}</strong><small>{worker.roleName} · {worker.qualifications.join(', ') || '—'}</small></span><span className={`presence-dot presence-${worker.status}`} />
                  </button>;
                })}
              </div>
            </div>

            <div className="glass-panel absence-panel">
              <div className="section-title-row"><h3>{t.shiftPlanner.absences}</h3><span>{absences.length}</span></div>
              <div className="absence-form">
                <select value={absenceWorker} onChange={(event) => setAbsenceWorker(event.target.value)}><option value="">{t.shiftPlanner.selectWorker}</option>{activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{displayName(worker)}</option>)}</select>
                <input type="date" value={absenceStart} onChange={(event) => setAbsenceStart(event.target.value)} />
                <input type="date" value={absenceEnd} onChange={(event) => setAbsenceEnd(event.target.value)} />
                <button className="btn btn-blue" onClick={addAbsence}>{t.shiftPlanner.add}</button>
              </div>
              <div className="absence-list">{absences.slice(-4).map((absence) => <span key={absence.id}>{nameForWorker(absence.workerId)} · {absence.startDate} → {absence.endDate}</span>)}</div>
              <div className="print-options"><label><input type="checkbox" checked={showHours} onChange={(event) => setShowHours(event.target.checked)} /> {t.shiftPlanner.showHours}</label><label><input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} /> {t.shiftPlanner.hideEmpty}</label></div>
            </div>
          </section>

          <RotationBoard
            weeks={drafts}
            workers={participantIds
              .map((id) => workerById.get(id))
              .filter((worker): worker is NonNullable<typeof worker> => Boolean(worker))
              .map((worker) => ({
                id: worker.id,
                name: displayName(worker),
                initials: `${worker.firstName[0] ?? ''}${worker.lastName[0] ?? ''}`,
                fixedShiftDefinitionId: worker.fixedShiftDefinitionId ?? null,
              }))}
            definitions={scheduleDefinitions}
            lang={lang}
            datesFor={(schedule) => Array.from({ length: WORKDAY_COUNT }, (_, day) => addDays(schedule.startDate, day))}
            isAbsent={isAbsent}
            hasWarning={weekHasWarning}
            onOpenWeek={(scheduleId) => setDetailWeekId((current) => current === scheduleId ? null : scheduleId)}
            onSetWeekShift={setWeekShift}
            onTogglePin={(workerId, shiftDefinitionId) => void toggleFixedShift(workerId, shiftDefinitionId)}
            readOnlyWeek={(schedule) => schedule.status === 'published'}
          />

          <div className="shift-board-scroll no-print">
            {drafts.filter((schedule) => schedule.id === detailWeekId).map((schedule) => {
              const dates = Array.from({ length: dayCount }, (_, day) => addDays(schedule.startDate, day));
              const locked = schedule.status === 'published';
              const snapshot = latestSnapshotFor(schedule);
              const modified = !locked && snapshot !== null && isModifiedSincePublish(schedule);
              return <section className={`shift-week-board glass-panel${locked ? ' is-locked' : ''}`} key={schedule.id}>
                <header className="week-board-header">
                  <div><span>{schedule.weekNumber}. {t.shiftPlanner.week}</span><small>{schedule.startDate} — {schedule.endDate}{snapshot ? ` · ${t.shiftPlanner.published} v${snapshot.version} · ${dateTimeLabel(snapshot.publishedAt)}` : ` · ${t.shiftPlanner.unpublished}`}</small></div>
                  <div className="week-board-actions">
                    <span className={`schedule-state state-${schedule.status}`}>{schedule.status === 'published' ? (t.shiftPlanner.published) : (t.shiftPlanner.draft)}</span>
                    {modified && <span className="schedule-state state-modified" title={t.shiftPlanner.changedSincePublishRe}>{t.shiftPlanner.modified}</span>}
                    {locked
                      ? <button className="btn btn-ghost" onClick={() => void unlockForEditing(schedule)}>{t.shiftPlanner.edit}</button>
                      : <button className="btn btn-ghost" onClick={() => void publishOne(schedule)}>{snapshot ? (lang === 'hr' ? `Objavi v${snapshot.version + 1}` : `Publish v${snapshot.version + 1}`) : (t.shiftPlanner.publish)}</button>}
                  </div>
                </header>
                {locked && <p className="lock-banner">{t.shiftPlanner.publishedScheduleLockedEdit}</p>}
                {modified && <p className="lock-banner modified-banner">{lang === 'hr' ? `Izmijenjeno nakon objave v${snapshot?.version}. Objavite ponovno da izdate v${(snapshot?.version ?? 0) + 1}; prethodna verzija ostaje u arhivi.` : `Changed since publishing v${snapshot?.version}. Re-publish to issue v${(snapshot?.version ?? 0) + 1}; the previous version stays in the archive.`}</p>}
                <div className="shift-board-grid" style={{ '--shift-columns': dates.length } as React.CSSProperties}>
                  <div className="shift-grid-corner">{department}</div>
                  {dates.map((date) => <div className={`shift-day-header${isWeekend(date) ? ' is-weekend' : ''}`} key={date}><strong>{dayLabel(date)}</strong><span>{date.slice(5)}</span></div>)}
                  {lanesFor(schedule).map((definition) => [
                    <div className="shift-lane-label" key={`label-${definition.id}`} style={{ '--shift-color': definition.color } as React.CSSProperties}><span className="shift-color-dot" /> <strong>{lang === 'hr' ? definition.nameHr : definition.nameEn}</strong>{showHours && <small>{definition.startTime}–{definition.endTime}</small>}</div>,
                    ...dates.map((date) => {
                      const targetId = `${schedule.id}-${date}-${definition.id}`;
                      const assignments = schedule.assignments.filter((assignment) => assignment.date === date && assignment.shiftDefinitionId === definition.id);
                      const dropConflict = dropTarget === targetId && dropWouldConflict(schedule, date, definition.id);
                      return <div key={targetId} className={`shift-drop-cell${dropTarget === targetId ? ' drag-over' : ''}${dropConflict ? ' conflict-target' : ''}${hideEmpty && assignments.length === 0 ? ' empty-cell' : ''}${isWeekend(date) ? ' is-weekend' : ''}`} title={dropConflict ? (t.shiftPlanner.restWeeklyHoursConflict) : undefined} onDragOver={(event) => { if (locked) return; event.preventDefault(); setDropTarget(targetId); }} onDragLeave={() => setDropTarget(null)} onDrop={() => { if (!locked) moveAssignment(schedule.id, date, definition.id); }}>
                        {assignments.map((assignment) => {
                          const hours = weeklyHours(schedule, assignment.workerId);
                          const overHours = hours > maxWeeklyHours;
                          const restViolation = hasRestViolation(schedule, assignment);
                          // Absence recorded after generation: the assignment survives, so at least flag it.
                          const absentConflict = isAbsent(assignment.workerId, assignment.date);
                          const worker = workerById.get(assignment.workerId);
                          return <div key={assignment.id} draggable={!locked} onDragStart={() => setDragged(assignment)} onDoubleClick={() => { if (!locked) setEditing({ scheduleId: schedule.id, assignmentId: assignment.id }); }} className={`assignment-chip${assignment.isOverride ? ' is-override' : ''}${overHours || restViolation || absentConflict ? ' has-warning' : ''}`} title={`${nameForWorker(assignment.workerId)} · ${hours}h${restViolation ? (t.shiftPlanner.restPeriodWarning) : ''}${absentConflict ? (t.shiftPlanner.warningWorkerHasRecorded) : ''}`}>
                            {editing?.scheduleId === schedule.id && editing.assignmentId === assignment.id ? <select autoFocus value={assignment.workerId} onChange={(event) => reassignWorker(schedule.id, assignment.id, Number(event.target.value))} onBlur={() => setEditing(null)}>{activeWorkers.filter((candidate) => !isAbsent(candidate.id, date)).map((candidate) => <option key={candidate.id} value={candidate.id}>{displayName(candidate)}</option>)}</select> : <><span className="mini-avatar">{worker?.firstName[0]}{worker?.lastName[0]}</span><span>{nameForWorker(assignment.workerId)}</span>{assignment.isOverride && <b>•</b>}{(overHours || restViolation || absentConflict) && <span className="warning-mark">!</span>}</>}
                          </div>;
                        })}
                      </div>;
                    }),
                  ])}
                </div>
                <footer className="week-board-footer"><span>{schedule.assignments.length} {t.shiftPlanner.assignments}</span><span>{schedule.assignments.filter((assignment) => assignment.isOverride).length} {t.shiftPlanner.overrides}</span><button className="text-button" onClick={() => { const worker = activeWorkers[0]; if (worker) exportIcs(worker.id, displayName(worker)); }}>ICS · {activeWorkers[0] ? displayName(activeWorkers[0]) : ''}</button></footer>
              </section>;
            })}
          </div>

          {detailWeekId !== null && (
            <p className="board-help no-print">{t.shiftPlanner.weekDetailDayLevel}</p>
          )}
        </>
      )}

      {viewingSnapshot && (() => {
        const snapshot = viewingSnapshot;
        const record: ShiftScheduleRecord = { ...snapshot, status: 'published' };
        const dates = Array.from({ length: snapshot.dayCount }, (_, day) => addDays(snapshot.startDate, day));
        return (
          <div className="snapshot-modal-overlay no-print" role="dialog" aria-modal="true" onClick={() => setViewingSnapshot(null)}>
            <div className="snapshot-modal glass-panel" onClick={(event) => event.stopPropagation()}>
              <header className="snapshot-modal-head">
                <div>
                  <span className="eyebrow">{t.shiftPlanner.publishedSnapshotReadOnly}</span>
                  <h3>{snapshot.weekNumber}. {t.shiftPlanner.week} {snapshot.year} · v{snapshot.version}</h3>
                  <small>{snapshot.department} · {snapshot.startDate} — {snapshot.endDate} · {t.shiftPlanner.publishedBy} {snapshot.publishedBy} · {dateTimeLabel(snapshot.publishedAt)}</small>
                </div>
                <div className="snapshot-modal-actions">
                  <button className="btn btn-ghost btn-sm" disabled={printingSnapshotId !== null} onClick={() => void printSnapshot(snapshot)}>{printingSnapshotId === snapshot.id ? '…' : 'PDF'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewingSnapshot(null)}>{t.shiftPlanner.close}</button>
                </div>
              </header>
              <div className="shift-week-board is-locked snapshot-board">
                <div className="shift-board-grid" style={{ '--shift-columns': dates.length } as React.CSSProperties}>
                  <div className="shift-grid-corner">{snapshot.department}</div>
                  {dates.map((date) => <div className={`shift-day-header${isWeekend(date) ? ' is-weekend' : ''}`} key={date}><strong>{dayLabel(date)}</strong><span>{date.slice(5)}</span></div>)}
                  {lanesFor(record).map((definition) => [
                    <div className="shift-lane-label" key={`label-${definition.id}`} style={{ '--shift-color': definition.color } as React.CSSProperties}><span className="shift-color-dot" /> <strong>{lang === 'hr' ? definition.nameHr : definition.nameEn}</strong><small>{definition.startTime}–{definition.endTime}</small></div>,
                    ...dates.map((date) => {
                      const assignments = snapshot.assignments.filter((assignment) => assignment.date === date && assignment.shiftDefinitionId === definition.id);
                      return <div key={`${date}-${definition.id}`} className={`shift-drop-cell${assignments.length === 0 ? ' empty-cell' : ''}${isWeekend(date) ? ' is-weekend' : ''}`}>
                        {assignments.map((assignment) => {
                          const worker = workerById.get(assignment.workerId);
                          return <div key={assignment.id} className={`assignment-chip${assignment.isOverride ? ' is-override' : ''}`}>
                            <span className="mini-avatar">{worker?.firstName[0]}{worker?.lastName[0]}</span><span>{nameForWorker(assignment.workerId)}</span>{assignment.isOverride && <b>•</b>}
                          </div>;
                        })}
                      </div>;
                    }),
                  ])}
                </div>
                <footer className="week-board-footer"><span>{snapshot.assignments.length} {t.shiftPlanner.assignments}</span><span>{snapshot.assignments.filter((assignment) => assignment.isOverride).length} {t.shiftPlanner.overrides}</span></footer>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
