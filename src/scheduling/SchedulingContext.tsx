import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase/client';
import { getJobConflicts, type JobConflicts } from './cpm';
import { enqueueMutation } from '../sync/offlineQueue';

export type JobStatus = 'planned' | 'inProgress' | 'done' | 'delayed';

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Dependency {
  jobId: number;
  type: DependencyType;
  lagHours: number;
}

export interface OperationStep {
  id: number;
  name: string;
  machine: string;
  hours: number;
}

export interface Job {
  id: number;
  machine: string;
  order: string;
  operator: string;
  operatorId?: number | null;
  product?: string;
  start: string; // datetime-local string
  end: string; // datetime-local string
  status: JobStatus;
  progress: number;
  color: string;
  operations?: OperationStep[];
  dependencies?: Dependency[];
  parentId?: number | null;
  comments?: string;
  setupHours?: number;
  materialStatus?: 'ready' | 'waiting' | 'delayed';
  version?: number;
}

interface JobRow {
  id: number;
  machine: string;
  job_order: string;
  operator: string;
  operator_id?: number | null;
  product_description?: string | null;
  start_time: string;
  end_time: string;
  status: JobStatus;
  progress: number;
  color: string;
  operations: OperationStep[] | null;
  dependencies: Dependency[] | null;
  parent_id: number | null;
  comments?: string | null;
  setup_hours?: number | null;
  material_status?: 'ready' | 'waiting' | 'delayed' | null;
  version?: number | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    machine: row.machine,
    order: row.job_order,
    operator: row.operator,
    operatorId: row.operator_id ?? null,
    product: row.product_description ?? '',
    start: row.start_time,
    end: row.end_time,
    status: row.status,
    progress: row.progress,
    color: row.color,
    operations: row.operations ?? undefined,
    dependencies: row.dependencies ?? undefined,
    parentId: row.parent_id ?? undefined,
    comments: row.comments ?? '',
    setupHours: row.setup_hours ?? 0,
    materialStatus: row.material_status ?? 'ready',
    version: row.version ?? 1,
  };
}

const COLORS = ['#1a365d', '#2b6cb0', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0e7490'];

const FALLBACK_JOBS: Job[] = [
  {
    id: 1,
    machine: 'CNC-1',
    order: 'RN-2026-014',
    operator: 'Goran Ć.',
    start: '2026-07-13T06:00',
    end: '2026-07-15T14:00',
    status: 'inProgress',
    progress: 55,
    color: COLORS[0],
  },
  {
    id: 2,
    machine: 'CNC-2',
    order: 'RN-2026-015',
    operator: 'Alen M.',
    start: '2026-07-14T14:00',
    end: '2026-07-16T22:00',
    status: 'planned',
    progress: 0,
    color: COLORS[1],
    dependencies: [{ jobId: 1, type: 'FS', lagHours: 0 }],
  },
  {
    id: 3,
    machine: 'Tokarilica-1 → CNC-2 → Kontrola kvalitete',
    order: 'RN-2026-021',
    operator: 'Kalup za brizganje (poklopac)',
    start: '2026-07-14T06:00',
    end: '2026-07-14T17:00',
    status: 'planned',
    progress: 0,
    color: COLORS[2],
    operations: [
      { id: 1, name: 'Tokarenje', machine: 'Tokarilica-1', hours: 4 },
      { id: 2, name: 'Glodanje (5-osno)', machine: 'CNC-2', hours: 6 },
      { id: 3, name: 'Završna kontrola', machine: 'Kontrola kvalitete', hours: 1 },
    ],
  },
  {
    id: 30,
    machine: '',
    order: 'RN-2026-030',
    operator: 'Alat XY (kompletan alat)',
    start: '2026-07-15T06:00',
    end: '2026-07-15T06:00',
    status: 'inProgress',
    progress: 0,
    color: COLORS[3],
  },
  {
    id: 31,
    machine: '',
    order: 'RN-2026-030-A',
    operator: 'Sklop A',
    start: '2026-07-15T06:00',
    end: '2026-07-15T06:00',
    status: 'inProgress',
    progress: 0,
    color: COLORS[3],
    parentId: 30,
  },
  {
    id: 32,
    machine: 'Pila → CNC-1',
    order: 'RN-2026-030-A1',
    operator: 'Podsklop A1',
    start: '2026-07-15T06:00',
    end: '2026-07-15T06:00',
    status: 'inProgress',
    progress: 40,
    color: COLORS[3],
    parentId: 31,
    operations: [
      { id: 1, name: 'Pila', machine: 'Pila', hours: 2 },
      { id: 2, name: 'Glodanje Operacija 1', machine: 'CNC-1', hours: 3 },
      { id: 3, name: 'Glodanje Operacija 2', machine: 'CNC-1', hours: 2 },
    ],
  },
  {
    id: 33,
    machine: 'Tokarilica-1 → CNC-2',
    order: 'RN-2026-030-A2',
    operator: 'Podsklop A2',
    start: '2026-07-15T13:00',
    end: '2026-07-15T13:00',
    status: 'planned',
    progress: 0,
    color: COLORS[3],
    parentId: 31,
    operations: [
      { id: 1, name: 'Tokarenje Operacija 1', machine: 'Tokarilica-1', hours: 3 },
      { id: 2, name: 'Glodanje Operacija 1', machine: 'CNC-2', hours: 4 },
    ],
  },
  {
    id: 34,
    machine: '',
    order: 'RN-2026-030-B',
    operator: 'Sklop B',
    start: '2026-07-15T06:00',
    end: '2026-07-15T06:00',
    status: 'planned',
    progress: 0,
    color: COLORS[4],
    parentId: 30,
  },
  {
    id: 35,
    machine: 'Pila → Tokarilica-1',
    order: 'RN-2026-030-B1',
    operator: 'Podsklop B1',
    start: '2026-07-15T06:00',
    end: '2026-07-15T06:00',
    status: 'planned',
    progress: 0,
    color: COLORS[4],
    parentId: 34,
    operations: [
      { id: 1, name: 'Pila', machine: 'Pila', hours: 1.5 },
      { id: 2, name: 'Tokarenje Operacija 1', machine: 'Tokarilica-1', hours: 2 },
    ],
  },
  {
    id: 36,
    machine: 'CNC-1',
    order: 'RN-2026-030-B2',
    operator: 'Podsklop B2',
    start: '2026-07-15T09:30',
    end: '2026-07-15T09:30',
    status: 'planned',
    progress: 0,
    color: COLORS[4],
    parentId: 34,
    operations: [
      { id: 1, name: 'Glodanje Operacija 1', machine: 'CNC-1', hours: 3 },
      { id: 2, name: 'Glodanje Operacija 2', machine: 'CNC-1', hours: 2 },
    ],
  },
];

const FALLBACK_STORAGE_KEY = 'dravaint-jobs-fallback';

function loadFallbackJobs(): Job[] {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return FALLBACK_JOBS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : FALLBACK_JOBS;
  } catch {
    return FALLBACK_JOBS;
  }
}

function saveFallbackJobs(jobs: Job[]) {
  localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(jobs));
}

let nextFallbackId = 1000;

/** Custom Postgres errcode raised by validate_job_assignment() on a genuine machine/operator double-booking (see supabase/schema.sql). */
const SLOT_TAKEN_ERRCODE = 'DR001';

export type UpdateResult =
  | { ok: true }
  | { ok: false; reason: 'version-conflict' | 'rejected' | 'offline'; message?: string };

interface SchedulingContextValue {
  jobs: Job[];
  loading: boolean;
  addJob: (job: Omit<Job, 'id' | 'color' | 'status' | 'progress'>) => Promise<UpdateResult>;
  updateJob: (id: number, patch: Partial<Job>) => Promise<UpdateResult>;
  removeJob: (id: number) => Promise<void>;
  restoreBackup: (newJobs: Job[]) => Promise<void>;
  getJobConflicts: (job: Job) => JobConflicts;
}

const SchedulingContext = createContext<SchedulingContextValue | null>(null);

export function SchedulingProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>(() => {
    if (supabase) return FALLBACK_JOBS;
    const loaded = loadFallbackJobs();
    nextFallbackId = Math.max(nextFallbackId, ...loaded.map((j) => j.id + 1));
    return loaded;
  });
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;

    async function loadJobs() {
      const { data, error } = await supabase!.from('jobs').select('*').order('id');
      if (!error && data) setJobs((data as JobRow[]).map(rowToJob));
      setLoading(false);
    }
    loadJobs();

    const channel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadJobs)
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, []);

  async function addJob(job: Omit<Job, 'id' | 'color' | 'status' | 'progress'>): Promise<UpdateResult> {
    const color = COLORS[jobs.length % COLORS.length];

    if (supabase) {
      const payload = {
        machine: job.machine,
        job_order: job.order,
        operator: job.operator,
        operator_id: job.operatorId ?? null,
        product_description: job.product ?? '',
        start_time: job.start,
        end_time: job.end,
        status: 'planned',
        progress: 0,
        color,
        operations: job.operations ?? null,
        dependencies: job.dependencies ?? null,
        parent_id: job.parentId ?? null,
        comments: job.comments ?? '',
        setup_hours: job.setupHours ?? 0,
        material_status: job.materialStatus ?? 'ready',
      };
      const { error } = await supabase.from('jobs').insert(payload);
      if (error) {
        if (error.code === SLOT_TAKEN_ERRCODE) return { ok: false, reason: 'rejected', message: error.message };
        await enqueueMutation({ table: 'jobs', operation: 'insert', payload });
        return { ok: false, reason: 'offline', message: error.message };
      }
      return { ok: true };
    }

    setJobs((prev) => {
      const next = [...prev, { ...job, id: nextFallbackId++, status: 'planned' as JobStatus, progress: 0, color }];
      saveFallbackJobs(next);
      return next;
    });
    return { ok: true };
  }

  async function updateJob(id: number, patch: Partial<Job>): Promise<UpdateResult> {
    if (supabase) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.machine !== undefined) dbPatch.machine = patch.machine;
      if (patch.order !== undefined) dbPatch.job_order = patch.order;
      if (patch.operator !== undefined) dbPatch.operator = patch.operator;
      if (patch.operatorId !== undefined) dbPatch.operator_id = patch.operatorId;
      if (patch.product !== undefined) dbPatch.product_description = patch.product;
      if (patch.start !== undefined) dbPatch.start_time = patch.start;
      if (patch.end !== undefined) dbPatch.end_time = patch.end;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      if (patch.progress !== undefined) dbPatch.progress = patch.progress;
      if (patch.color !== undefined) dbPatch.color = patch.color;
      if (patch.operations !== undefined) dbPatch.operations = patch.operations;
      if (patch.dependencies !== undefined) dbPatch.dependencies = patch.dependencies;
      if (patch.parentId !== undefined) dbPatch.parent_id = patch.parentId;
      if (patch.comments !== undefined) dbPatch.comments = patch.comments;
      if (patch.setupHours !== undefined) dbPatch.setup_hours = patch.setupHours;
      if (patch.materialStatus !== undefined) dbPatch.material_status = patch.materialStatus;
      dbPatch.version = (jobs.find((job) => job.id === id)?.version ?? 1) + 1;
      let query = supabase.from('jobs').update(dbPatch).eq('id', id);
      const expectedVersion = jobs.find((job) => job.id === id)?.version;
      if (expectedVersion !== undefined) query = query.eq('version', expectedVersion);
      const { error, data } = await query.select('id');
      if (error) {
        if (error.code === SLOT_TAKEN_ERRCODE) return { ok: false, reason: 'rejected', message: error.message };
        await enqueueMutation({ table: 'jobs', operation: 'update', payload: dbPatch, match: { id } });
        return { ok: false, reason: 'offline', message: error.message };
      }
      if (!data || data.length === 0) {
        // The version filter matched zero rows: someone else updated this job first. The realtime
        // channel will refetch the current row shortly; surface this instead of silently no-op'ing.
        return { ok: false, reason: 'version-conflict' };
      }
      return { ok: true };
    }

    setJobs((prev) => {
      const next = prev.map((j) => (j.id === id ? { ...j, ...patch, version: (j.version ?? 1) + 1 } : j));
      saveFallbackJobs(next);
      return next;
    });
    return { ok: true };
  }

  async function removeJob(id: number) {
    if (supabase) {
      const { error } = await supabase.from('jobs').delete().eq('id', id);
      if (error) await enqueueMutation({ table: 'jobs', operation: 'delete', match: { id } });
    } else {
      setJobs((prev) => {
        const next = prev.filter((j) => j.id !== id);
        saveFallbackJobs(next);
        return next;
      });
    }
  }

  async function restoreBackup(newJobs: Job[]) {
    if (!supabase) {
      setJobs(newJobs);
      saveFallbackJobs(newJobs);
      return;
    }

    // Replay real writes for anything that changed or was removed since the snapshot, so undo/redo
    // actually persists instead of only rewinding local state (which the next realtime refresh would
    // then overwrite). Resurrecting a job deleted since the snapshot isn't supported here: addJob
    // always mints a new server-side id, which would break any dependency still pointing at the old
    // one — that case stays local-only via the optimistic setJobs below.
    const currentById = new Map(jobs.map((job) => [job.id, job]));
    const targetIds = new Set(newJobs.map((job) => job.id));
    const replays: Promise<unknown>[] = [];

    for (const target of newJobs) {
      const current = currentById.get(target.id);
      if (!current) continue;
      const patch: Partial<Job> = {};
      (Object.keys(target) as Array<keyof Job>).forEach((key) => {
        if (key === 'id' || key === 'version') return;
        if (JSON.stringify(target[key]) !== JSON.stringify(current[key])) (patch as Record<string, unknown>)[key] = target[key];
      });
      if (Object.keys(patch).length > 0) replays.push(updateJob(target.id, patch));
    }
    for (const current of jobs) {
      if (!targetIds.has(current.id)) replays.push(removeJob(current.id));
    }

    await Promise.all(replays);
    setJobs(newJobs);
  }

  return (
    <SchedulingContext.Provider value={{ jobs, loading, addJob, updateJob, removeJob, restoreBackup, getJobConflicts: (job) => getJobConflicts(job, jobs) }}>
      {children}
    </SchedulingContext.Provider>
  );
}

export function useScheduling() {
  const ctx = useContext(SchedulingContext);
  if (!ctx) throw new Error('useScheduling must be used within SchedulingProvider');
  return ctx;
}
