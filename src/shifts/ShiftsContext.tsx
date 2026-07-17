import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase/client';

export interface ShiftDefinition {
  id: number;
  nameHr: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  color: string;
  isActive: boolean;
}

export interface ShiftAssignment {
  id: number;
  scheduleId: number;
  workerId: number;
  shiftDefinitionId: number;
  date: string;
  isOverride: boolean;
  notes: string;
}

export interface ShiftScheduleRecord {
  id: number;
  weekNumber: number;
  year: number;
  startDate: string;
  endDate: string;
  department: string;
  status: 'draft' | 'published';
  version: number;
  assignments: ShiftAssignment[];
}

export interface Absence {
  id: number;
  workerId: number;
  startDate: string;
  endDate: string;
  type: 'vacation' | 'sick' | 'training' | 'other';
  notes: string;
}

interface ShiftsContextValue {
  definitions: ShiftDefinition[];
  schedules: ShiftScheduleRecord[];
  absences: Absence[];
  loading: boolean;
  saveSchedule: (schedule: Omit<ShiftScheduleRecord, 'id' | 'version'> & { id?: number; version?: number }) => Promise<ShiftScheduleRecord>;
  generateSchedule: (startDate: string, weekCount: number, workerIds: number[], department: string) => Promise<ShiftScheduleRecord[] | null>;
  publishSchedule: (id: number) => Promise<void>;
  saveDefinition: (definition: Omit<ShiftDefinition, 'id'> & { id?: number }) => Promise<void>;
  saveAbsence: (absence: Omit<Absence, 'id'>) => Promise<void>;
  exportIcs: (workerId: number, workerName: string) => void;
}

const STORAGE_KEY = 'dravaint-shifts-v2';
const ABSENCE_KEY = 'dravaint-absences-v1';

const DEFAULT_DEFINITIONS: ShiftDefinition[] = [
  { id: 1, nameHr: 'Prva smjena', nameEn: 'First shift', startTime: '06:00', endTime: '14:00', color: '#2563eb', isActive: true },
  { id: 2, nameHr: 'Druga smjena', nameEn: 'Second shift', startTime: '14:00', endTime: '22:00', color: '#7c3aed', isActive: true },
  { id: 3, nameHr: 'Treća smjena', nameEn: 'Third shift', startTime: '22:00', endTime: '06:00', color: '#0f766e', isActive: false },
];

/**
 * A shift whose end time wraps past midnight — i.e. the third shift.
 *
 * The company never runs a *scheduled* third shift: when someone works overnight
 * it is logged as overtime against that person rather than filling a regular
 * schedule slot. Overnight definitions are therefore never offered as a lane in
 * the planning grid, but are still resolved by name so that assignments saved
 * before this rule existed keep rendering correctly in the archive.
 *
 * This is derived from the times rather than from `isActive` or the row id on
 * purpose: the definitions may come from Supabase, where the third shift row can
 * still be marked active.
 */
export function isOvernightShift(definition: ShiftDefinition) {
  return definition.endTime <= definition.startTime;
}

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function persist(definitions: ShiftDefinition[], schedules: ShiftScheduleRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ definitions, schedules }));
}

const ShiftsContext = createContext<ShiftsContextValue | null>(null);

export function ShiftsProvider({ children }: { children: ReactNode }) {
  const cached = loadLocal(STORAGE_KEY, { definitions: DEFAULT_DEFINITIONS, schedules: [] as ShiftScheduleRecord[] });
  const [definitions, setDefinitions] = useState<ShiftDefinition[]>(cached.definitions);
  const [schedules, setSchedules] = useState<ShiftScheduleRecord[]>(cached.schedules);
  const [absences, setAbsences] = useState<Absence[]>(() => loadLocal(ABSENCE_KEY, []));
  const [loading, setLoading] = useState(Boolean(supabase));

  const loadRemote = useCallback(async () => {
    if (!supabase) return [] as ShiftScheduleRecord[];
    const [definitionsResult, schedulesResult, assignmentsResult, absencesResult] = await Promise.all([
      supabase.from('shift_definitions').select('*').order('start_time'),
      supabase.from('shift_schedules').select('*').order('start_date', { ascending: false }),
      supabase.from('shift_assignments').select('*').order('date'),
      supabase.from('absences').select('*').order('start_date'),
    ]);
    if (definitionsResult.data) {
      setDefinitions(definitionsResult.data.map((row) => ({
        id: Number(row.id), nameHr: row.name_hr, nameEn: row.name_en, startTime: row.start_time.slice(0, 5), endTime: row.end_time.slice(0, 5), color: row.color_code, isActive: row.is_active,
      })));
    }
    let loadedSchedules: ShiftScheduleRecord[] = [];
    if (schedulesResult.data && assignmentsResult.data) {
      loadedSchedules = schedulesResult.data.map((row) => ({
        id: Number(row.id), weekNumber: row.week_number, year: row.year, startDate: row.start_date, endDate: row.end_date, department: row.department ?? 'Alatnica', status: row.status, version: row.version ?? 1,
        assignments: assignmentsResult.data.filter((assignment) => assignment.shift_schedule_id === row.id).map((assignment) => ({
          id: Number(assignment.id), scheduleId: Number(assignment.shift_schedule_id), workerId: Number(assignment.worker_id), shiftDefinitionId: Number(assignment.shift_definition_id), date: assignment.date, isOverride: assignment.is_override, notes: assignment.notes ?? '',
        })),
      }));
      setSchedules(loadedSchedules);
    }
    if (absencesResult.data) {
      setAbsences(absencesResult.data.map((row) => ({ id: Number(row.id), workerId: Number(row.worker_id), startDate: row.start_date, endDate: row.end_date, type: row.type, notes: row.notes ?? '' })));
    }
    setLoading(false);
    return loadedSchedules;
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    void loadRemote();
    const channel = client.channel('shift-planning-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_schedules' }, () => void loadRemote())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_assignments' }, () => void loadRemote())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_definitions' }, () => void loadRemote())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [loadRemote]);

  useEffect(() => persist(definitions, schedules), [definitions, schedules]);
  useEffect(() => localStorage.setItem(ABSENCE_KEY, JSON.stringify(absences)), [absences]);

  async function saveSchedule(input: Omit<ShiftScheduleRecord, 'id' | 'version'> & { id?: number; version?: number }) {
    const id = input.id ?? Math.max(0, ...schedules.map((schedule) => schedule.id)) + 1;
    const nextSchedule: ShiftScheduleRecord = { ...input, id, version: (input.version ?? 0) + 1 };
    setSchedules((current) => [...current.filter((schedule) => schedule.id !== id), nextSchedule].sort((a, b) => a.startDate.localeCompare(b.startDate)));

    if (supabase) {
      const scheduleRow = { week_number: input.weekNumber, year: input.year, start_date: input.startDate, end_date: input.endDate, department: input.department, status: input.status, version: nextSchedule.version };
      const result = input.id
        ? await supabase.from('shift_schedules').update(scheduleRow).eq('id', input.id).eq('version', input.version ?? 1).select('id').single()
        : await supabase.from('shift_schedules').insert(scheduleRow).select('id').single();
      if (result.data) {
        const remoteId = Number(result.data.id);
        await supabase.from('shift_assignments').delete().eq('shift_schedule_id', remoteId).eq('is_override', false);
        const rows = input.assignments.map((assignment) => ({ shift_schedule_id: remoteId, worker_id: assignment.workerId, shift_definition_id: assignment.shiftDefinitionId, date: assignment.date, is_override: assignment.isOverride, notes: assignment.notes }));
        if (rows.length) await supabase.from('shift_assignments').upsert(rows, { onConflict: 'shift_schedule_id,worker_id,date' });
      }
    }
    return nextSchedule;
  }

  async function publishSchedule(id: number) {
    const target = schedules.find((schedule) => schedule.id === id);
    if (!target) return;
    await saveSchedule({ ...target, status: 'published' });
  }

  async function generateSchedule(startDate: string, weekCount: number, workerIds: number[], department: string) {
    if (!supabase) return null;
    const { error } = await supabase.rpc('generate_shift_schedule', {
      p_start_date: startDate,
      p_week_count: weekCount,
      p_worker_ids: workerIds,
      p_department: department,
    });
    if (error) throw error;
    return loadRemote();
  }

  async function saveDefinition(input: Omit<ShiftDefinition, 'id'> & { id?: number }) {
    const id = input.id ?? Math.max(0, ...definitions.map((definition) => definition.id)) + 1;
    const next = { ...input, id };
    setDefinitions((current) => [...current.filter((definition) => definition.id !== id), next]);
    if (supabase) {
      await supabase.from('shift_definitions').upsert({ id, name_hr: input.nameHr, name_en: input.nameEn, start_time: input.startTime, end_time: input.endTime, color_code: input.color, is_active: input.isActive });
    }
  }

  async function saveAbsence(input: Omit<Absence, 'id'>) {
    const next = { ...input, id: Math.max(0, ...absences.map((absence) => absence.id)) + 1 };
    setAbsences((current) => [...current, next]);
    if (supabase) await supabase.from('absences').insert({ worker_id: input.workerId, start_date: input.startDate, end_date: input.endDate, type: input.type, notes: input.notes });
  }

  function exportIcs(workerId: number, workerName: string) {
    const activeDefinitions = new Map(definitions.map((definition) => [definition.id, definition]));
    const events = schedules.flatMap((schedule) => schedule.assignments.filter((assignment) => assignment.workerId === workerId).map((assignment) => ({ assignment, definition: activeDefinitions.get(assignment.shiftDefinitionId), schedule })));
    const stamp = (value: string) => value.replace(/[-:]/g, '').replace('.000', '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DravaInt//Shift Schedule//EN', 'CALSCALE:GREGORIAN'];
    events.forEach(({ assignment, definition, schedule }) => {
      if (!definition) return;
      const endDate = new Date(`${assignment.date}T${definition.endTime}:00`);
      if (definition.endTime <= definition.startTime) endDate.setDate(endDate.getDate() + 1);
      lines.push('BEGIN:VEVENT', `UID:dravaint-${schedule.id}-${assignment.id}@local`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(`${assignment.date}T${definition.startTime}:00`)}`, `DTEND:${stamp(endDate.toISOString().slice(0, 19))}`, `SUMMARY:${definition.nameEn} – ${workerName}`, `DESCRIPTION:${schedule.department}${assignment.notes ? ` – ${assignment.notes}` : ''}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${workerName.replace(/\s+/g, '-')}-shifts.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const value: ShiftsContextValue = { definitions, schedules, absences, loading, saveSchedule, generateSchedule, publishSchedule, saveDefinition, saveAbsence, exportIcs };
  return <ShiftsContext.Provider value={value}>{children}</ShiftsContext.Provider>;
}

export function useShifts() {
  const context = useContext(ShiftsContext);
  if (!context) throw new Error('useShifts must be used within ShiftsProvider');
  return context;
}
