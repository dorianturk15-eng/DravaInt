import { useEffect, useMemo, useState } from 'react';
import { IconPrint, IconRefresh } from '../components/Icons';
import { useLanguage } from '../i18n/LanguageContext';
import { useShifts, type ShiftAssignment, type ShiftScheduleRecord } from '../shifts/ShiftsContext';
import { useWorkers } from '../workers/WorkersContext';

const DAY_MS = 86_400_000;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function getIsoWeek(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const weekOne = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - weekOne.getTime()) / DAY_MS - 3 + ((weekOne.getDay() + 6) % 7)) / 7);
}

function shiftDuration(start: string, end: string) {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

function downloadCsv(schedules: ShiftScheduleRecord[], workerName: (id: number) => string, shiftName: (id: number) => string) {
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
  const { activeWorkers, displayName } = useWorkers();
  const { definitions, schedules, absences, saveSchedule, generateSchedule: generateRemoteSchedule, saveAbsence, exportIcs } = useShifts();
  const activeDefinitions = useMemo(() => definitions.filter((definition) => definition.isActive), [definitions]);
  const today = isoDate(new Date());

  const [startDate, setStartDate] = useState(() => localStorage.getItem('shift-board-start') || today);
  const [weekCount, setWeekCount] = useState(4);
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

  useEffect(() => {
    if (participantIds.length === 0 && activeWorkers.length) setParticipantIds(activeWorkers.map((worker) => worker.id));
  }, [activeWorkers, participantIds.length]);

  const workerById = useMemo(() => new Map(activeWorkers.map((worker) => [worker.id, worker])), [activeWorkers]);
  const definitionById = useMemo(() => new Map(definitions.map((definition) => [definition.id, definition])), [definitions]);
  const maxWeeklyHours = Number(localStorage.getItem('cfg-max-hours')) || 48;

  function nameForWorker(id: number) {
    const worker = workerById.get(id);
    return worker ? displayName(worker) : `#${id}`;
  }

  function nameForShift(id: number) {
    const shift = definitionById.get(id);
    if (!shift) return `#${id}`;
    return lang === 'hr' ? shift.nameHr : shift.nameEn;
  }

  function isAbsent(workerId: number, date: string) {
    return absences.some((absence) => absence.workerId === workerId && date >= absence.startDate && date <= absence.endDate);
  }

  async function generateSchedule() {
    if (!activeDefinitions.length || !participantIds.length) return;
    setGenerationError('');
    setIsGenerating(true);
    let remoteSchedules: ShiftScheduleRecord[] | null;
    try {
      remoteSchedules = await generateRemoteSchedule(startDate, Math.min(12, Math.max(1, weekCount)), participantIds, department);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : (lang === 'hr' ? 'Generiranje nije uspjelo.' : 'Schedule generation failed.'));
      setIsGenerating(false);
      return;
    }
    if (remoteSchedules) {
      setDrafts(remoteSchedules
        .filter((schedule) => schedule.startDate >= startDate && schedule.startDate < addDays(startDate, weekCount * 7) && schedule.department === department)
        .sort((a, b) => a.startDate.localeCompare(b.startDate)));
      localStorage.setItem('shift-board-start', startDate);
      localStorage.setItem('shift-board-department', department);
      setIsGenerating(false);
      return;
    }
    const previousOverrides = schedules.flatMap((schedule) => schedule.assignments).filter((assignment) => assignment.isOverride);
    const generated: ShiftScheduleRecord[] = [];

    for (let weekIndex = 0; weekIndex < Math.min(12, Math.max(1, weekCount)); weekIndex++) {
      const weekStart = addDays(startDate, weekIndex * 7);
      const existing = schedules.find((schedule) => schedule.startDate === weekStart && schedule.department === department);
      const scheduleId = existing?.id ?? Date.now() + weekIndex;
      const assignments: ShiftAssignment[] = [];
      let assignmentId = scheduleId * 1000;

      for (let day = 0; day < 5; day++) {
        const date = addDays(weekStart, day);
        participantIds.forEach((workerId, workerIndex) => {
          if (isAbsent(workerId, date)) return;
          const override = previousOverrides.find((item) => item.workerId === workerId && item.date === date);
          if (override) {
            assignments.push({ ...override, id: assignmentId++, scheduleId });
            return;
          }
          const shift = activeDefinitions[(workerIndex + weekIndex) % activeDefinitions.length];
          assignments.push({ id: assignmentId++, scheduleId, workerId, shiftDefinitionId: shift.id, date, isOverride: false, notes: '' });
        });
      }

      generated.push({
        id: scheduleId,
        weekNumber: getIsoWeek(weekStart),
        year: new Date(`${weekStart}T12:00:00`).getFullYear(),
        startDate: weekStart,
        endDate: addDays(weekStart, 6),
        department,
        status: existing?.status ?? 'draft',
        version: existing?.version ?? 0,
        assignments,
      });
    }
    setDrafts(generated);
    localStorage.setItem('shift-board-start', startDate);
    localStorage.setItem('shift-board-department', department);
    setIsGenerating(false);
  }

  useEffect(() => {
    if (drafts.length === 0 && activeWorkers.length && activeDefinitions.length) void generateSchedule();
    // Initial generation intentionally waits until providers have hydrated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkers.length, activeDefinitions.length]);

  function moveAssignment(scheduleId: number, date: string, shiftDefinitionId: number) {
    if (!dragged || dragged.scheduleId !== scheduleId) return;
    setDrafts((current) => current.map((schedule) => schedule.id === scheduleId ? {
      ...schedule,
      assignments: schedule.assignments.map((assignment) => assignment.id === dragged.id ? { ...assignment, date, shiftDefinitionId, isOverride: true } : assignment),
    } : schedule));
    setDragged(null);
    setDropTarget(null);
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
    return weeklyHours(preview, moved.workerId) > maxWeeklyHours || hasRestViolation(preview, moved);
  }

  async function saveAll() {
    const next: ShiftScheduleRecord[] = [];
    for (const schedule of drafts) next.push(await saveSchedule(schedule));
    setDrafts(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function publishOne(schedule: ShiftScheduleRecord) {
    const published = await saveSchedule({ ...schedule, status: 'published' });
    setDrafts((current) => current.map((item) => item.id === schedule.id ? published : item));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function addAbsence() {
    const workerId = Number(absenceWorker);
    if (!workerId || absenceEnd < absenceStart) return;
    await saveAbsence({ workerId, startDate: absenceStart, endDate: absenceEnd, type: 'vacation', notes: '' });
    setAbsenceWorker('');
  }

  const weekdays = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(startDate, index)), [startDate]);

  return (
    <div className="wizard-container shift-planner-page">
      <div className="page-heading-row">
        <div>
          <span className="eyebrow">{lang === 'hr' ? 'Planiranje kapaciteta' : 'Capacity planning'}</span>
          <h2>{t.shifts.wizardTitle}</h2>
          <p className="subtitle-text">{lang === 'hr' ? 'Interaktivna rotacija smjena s provjerom odmora, izostanaka i tjednih sati.' : 'Interactive shift rotation with rest, absence, and weekly-hours validation.'}</p>
        </div>
        <div className="sync-badge"><span className="sync-dot" /> {lang === 'hr' ? 'Sinkronizirano' : 'Synced'}</div>
      </div>

      <section className="planner-command-card glass-panel">
        <div className="planner-fields">
          <label>{lang === 'hr' ? 'Početak plana' : 'Plan start'}<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>{lang === 'hr' ? 'Broj tjedana' : 'Weeks'}<input type="number" min={1} max={12} value={weekCount} onChange={(event) => setWeekCount(Number(event.target.value) || 1)} /></label>
          <label>{lang === 'hr' ? 'Odjel' : 'Department'}<select value={department} onChange={(event) => setDepartment(event.target.value)}><option>Alatnica</option><option>Brizganje</option><option>Montaža</option><option>Kontrola kvalitete</option></select></label>
        </div>
        <div className="planner-actions">
          <button className="btn btn-blue" disabled={isGenerating} onClick={() => void generateSchedule()}><IconRefresh />{isGenerating ? (lang === 'hr' ? 'Generiranje…' : 'Generating…') : (lang === 'hr' ? 'Generiraj' : 'Generate')}</button>
          <button className="btn btn-green" onClick={saveAll}>{lang === 'hr' ? 'Spremi nacrt' : 'Save draft'}</button>
          <button className="btn btn-ghost" onClick={() => window.print()}><IconPrint />{t.common.print}</button>
          <button className="btn btn-ghost" onClick={() => downloadCsv(drafts, nameForWorker, nameForShift)}>CSV</button>
        </div>
        {saved && <div className="inline-success" role="status">✓ {lang === 'hr' ? 'Raspored je spremljen.' : 'Schedule saved.'}</div>}
        {generationError && <div className="inline-error" role="alert">{generationError}</div>}
      </section>

      <section className="planner-sidebar-grid">
        <div className="glass-panel participant-panel">
          <div className="section-title-row"><h3>{lang === 'hr' ? 'Aktivni radnici' : 'Active workers'}</h3><span>{participantIds.length}/{activeWorkers.length}</span></div>
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
          <div className="section-title-row"><h3>{lang === 'hr' ? 'Izostanci' : 'Absences'}</h3><span>{absences.length}</span></div>
          <div className="absence-form">
            <select value={absenceWorker} onChange={(event) => setAbsenceWorker(event.target.value)}><option value="">{lang === 'hr' ? 'Odaberi radnika' : 'Select worker'}</option>{activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{displayName(worker)}</option>)}</select>
            <input type="date" value={absenceStart} onChange={(event) => setAbsenceStart(event.target.value)} />
            <input type="date" value={absenceEnd} onChange={(event) => setAbsenceEnd(event.target.value)} />
            <button className="btn btn-blue" onClick={addAbsence}>{lang === 'hr' ? 'Dodaj' : 'Add'}</button>
          </div>
          <div className="absence-list">{absences.slice(-4).map((absence) => <span key={absence.id}>{nameForWorker(absence.workerId)} · {absence.startDate} → {absence.endDate}</span>)}</div>
          <div className="print-options"><label><input type="checkbox" checked={showHours} onChange={(event) => setShowHours(event.target.checked)} /> {lang === 'hr' ? 'Prikaži sate' : 'Show hours'}</label><label><input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} /> {lang === 'hr' ? 'Sakrij prazno' : 'Hide empty'}</label></div>
        </div>
      </section>

      <div className="shift-board-scroll">
        {drafts.map((schedule) => {
          const dates = Array.from({ length: 5 }, (_, day) => addDays(schedule.startDate, day));
          return <section className="shift-week-board glass-panel" key={schedule.id}>
            <header className="week-board-header"><div><span>{schedule.weekNumber}. {lang === 'hr' ? 'tjedan' : 'week'}</span><small>{schedule.startDate} — {schedule.endDate} · v{schedule.version || 1}</small></div><div className="week-board-actions"><span className={`schedule-state state-${schedule.status}`}>{schedule.status}</span><button className="btn btn-ghost" disabled={schedule.status === 'published'} onClick={() => void publishOne(schedule)}>{schedule.status === 'published' ? (lang === 'hr' ? 'Objavljeno' : 'Published') : (lang === 'hr' ? 'Objavi' : 'Publish')}</button></div></header>
            <div className="shift-board-grid" style={{ '--shift-columns': dates.length } as React.CSSProperties}>
              <div className="shift-grid-corner">{department}</div>
              {dates.map((date) => <div className="shift-day-header" key={date}><strong>{new Date(`${date}T12:00:00`).toLocaleDateString(lang === 'hr' ? 'hr-HR' : 'en-US', { weekday: 'short' })}</strong><span>{date.slice(5)}</span></div>)}
              {activeDefinitions.map((definition) => [
                <div className="shift-lane-label" key={`label-${definition.id}`} style={{ '--shift-color': definition.color } as React.CSSProperties}><span className="shift-color-dot" /> <strong>{lang === 'hr' ? definition.nameHr : definition.nameEn}</strong>{showHours && <small>{definition.startTime}–{definition.endTime}</small>}</div>,
                ...dates.map((date) => {
                  const targetId = `${schedule.id}-${date}-${definition.id}`;
                  const assignments = schedule.assignments.filter((assignment) => assignment.date === date && assignment.shiftDefinitionId === definition.id);
                  const dropConflict = dropTarget === targetId && dropWouldConflict(schedule, date, definition.id);
                  return <div key={targetId} className={`shift-drop-cell${dropTarget === targetId ? ' drag-over' : ''}${dropConflict ? ' conflict-target' : ''}${hideEmpty && assignments.length === 0 ? ' empty-cell' : ''}`} title={dropConflict ? (lang === 'hr' ? 'Sukob odmora ili tjednih sati' : 'Rest or weekly-hours conflict') : undefined} onDragOver={(event) => { event.preventDefault(); setDropTarget(targetId); }} onDragLeave={() => setDropTarget(null)} onDrop={() => moveAssignment(schedule.id, date, definition.id)}>
                    {assignments.map((assignment) => {
                      const hours = weeklyHours(schedule, assignment.workerId);
                      const overHours = hours > maxWeeklyHours;
                      const restViolation = hasRestViolation(schedule, assignment);
                      const worker = workerById.get(assignment.workerId);
                      return <div key={assignment.id} draggable onDragStart={() => setDragged(assignment)} onDoubleClick={() => setEditing({ scheduleId: schedule.id, assignmentId: assignment.id })} className={`assignment-chip${assignment.isOverride ? ' is-override' : ''}${overHours || restViolation ? ' has-warning' : ''}`} title={`${nameForWorker(assignment.workerId)} · ${hours}h${restViolation ? ' · Rest period warning' : ''}`}>
                        {editing?.scheduleId === schedule.id && editing.assignmentId === assignment.id ? <select autoFocus value={assignment.workerId} onChange={(event) => reassignWorker(schedule.id, assignment.id, Number(event.target.value))} onBlur={() => setEditing(null)}>{activeWorkers.filter((candidate) => !isAbsent(candidate.id, date)).map((candidate) => <option key={candidate.id} value={candidate.id}>{displayName(candidate)}</option>)}</select> : <><span className="mini-avatar">{worker?.firstName[0]}{worker?.lastName[0]}</span><span>{nameForWorker(assignment.workerId)}</span>{assignment.isOverride && <b>•</b>}{(overHours || restViolation) && <span className="warning-mark">!</span>}</>}
                      </div>;
                    })}
                  </div>;
                }),
              ])}
            </div>
            <footer className="week-board-footer"><span>{schedule.assignments.length} {lang === 'hr' ? 'dodjela' : 'assignments'}</span><span>{schedule.assignments.filter((assignment) => assignment.isOverride).length} {lang === 'hr' ? 'ručnih izmjena' : 'overrides'}</span><button className="text-button" onClick={() => { const worker = activeWorkers[0]; if (worker) exportIcs(worker.id, displayName(worker)); }}>ICS · {activeWorkers[0] ? displayName(activeWorkers[0]) : ''}</button></footer>
          </section>;
        })}
      </div>

      <p className="board-help">{lang === 'hr' ? 'Povucite radnika u drugu ćeliju za ručnu izmjenu. Dvostruki klik otvara brzo pretraživo prebacivanje.' : 'Drag a worker to another cell for a manual override. Double-click for quick reassignment.'}</p>
      <span className="sr-only">{weekdays.join(', ')} drafts: {drafts.length}</span>
    </div>
  );
}
