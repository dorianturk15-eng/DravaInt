import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase/client';

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
  start: string; // datetime-local string
  end: string; // datetime-local string
  status: JobStatus;
  progress: number;
  color: string;
  operations?: OperationStep[];
  dependencies?: Dependency[];
  parentId?: number | null;
}

interface JobRow {
  id: number;
  machine: string;
  job_order: string;
  operator: string;
  start_time: string;
  end_time: string;
  status: JobStatus;
  progress: number;
  color: string;
  operations: OperationStep[] | null;
  dependencies: Dependency[] | null;
  parent_id: number | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    machine: row.machine,
    order: row.job_order,
    operator: row.operator,
    start: row.start_time,
    end: row.end_time,
    status: row.status,
    progress: row.progress,
    color: row.color,
    operations: row.operations ?? undefined,
    dependencies: row.dependencies ?? undefined,
    parentId: row.parent_id ?? undefined,
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

interface SchedulingContextValue {
  jobs: Job[];
  addJob: (job: Omit<Job, 'id' | 'color' | 'status' | 'progress'>) => Promise<void>;
  updateJob: (id: number, patch: Partial<Job>) => Promise<void>;
  removeJob: (id: number) => Promise<void>;
}

const SchedulingContext = createContext<SchedulingContextValue | null>(null);

export function SchedulingProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>(() => {
    if (supabase) return FALLBACK_JOBS;
    const loaded = loadFallbackJobs();
    nextFallbackId = Math.max(nextFallbackId, ...loaded.map((j) => j.id + 1));
    return loaded;
  });

  useEffect(() => {
    if (!supabase) return;

    async function loadJobs() {
      const { data, error } = await supabase!.from('jobs').select('*').order('id');
      if (!error && data) setJobs((data as JobRow[]).map(rowToJob));
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

  async function addJob(job: Omit<Job, 'id' | 'color' | 'status' | 'progress'>) {
    const color = COLORS[jobs.length % COLORS.length];

    if (supabase) {
      await supabase.from('jobs').insert({
        machine: job.machine,
        job_order: job.order,
        operator: job.operator,
        start_time: job.start,
        end_time: job.end,
        status: 'planned',
        progress: 0,
        color,
        operations: job.operations ?? null,
        dependencies: job.dependencies ?? null,
        parent_id: job.parentId ?? null,
      });
    } else {
      setJobs((prev) => {
        const next = [...prev, { ...job, id: nextFallbackId++, status: 'planned' as JobStatus, progress: 0, color }];
        saveFallbackJobs(next);
        return next;
      });
    }
  }

  async function updateJob(id: number, patch: Partial<Job>) {
    if (supabase) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.machine !== undefined) dbPatch.machine = patch.machine;
      if (patch.order !== undefined) dbPatch.job_order = patch.order;
      if (patch.operator !== undefined) dbPatch.operator = patch.operator;
      if (patch.start !== undefined) dbPatch.start_time = patch.start;
      if (patch.end !== undefined) dbPatch.end_time = patch.end;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      if (patch.progress !== undefined) dbPatch.progress = patch.progress;
      if (patch.color !== undefined) dbPatch.color = patch.color;
      if (patch.operations !== undefined) dbPatch.operations = patch.operations;
      if (patch.dependencies !== undefined) dbPatch.dependencies = patch.dependencies;
      if (patch.parentId !== undefined) dbPatch.parent_id = patch.parentId;
      await supabase.from('jobs').update(dbPatch).eq('id', id);
    } else {
      setJobs((prev) => {
        const next = prev.map((j) => (j.id === id ? { ...j, ...patch } : j));
        saveFallbackJobs(next);
        return next;
      });
    }
  }

  async function removeJob(id: number) {
    if (supabase) {
      await supabase.from('jobs').delete().eq('id', id);
    } else {
      setJobs((prev) => {
        const next = prev.filter((j) => j.id !== id);
        saveFallbackJobs(next);
        return next;
      });
    }
  }

  return (
    <SchedulingContext.Provider value={{ jobs, addJob, updateJob, removeJob }}>
      {children}
    </SchedulingContext.Provider>
  );
}

export function useScheduling() {
  const ctx = useContext(SchedulingContext);
  if (!ctx) throw new Error('useScheduling must be used within SchedulingProvider');
  return ctx;
}
