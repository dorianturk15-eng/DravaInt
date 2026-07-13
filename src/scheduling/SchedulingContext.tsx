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
];

let nextFallbackId = 1000;

interface SchedulingContextValue {
  jobs: Job[];
  addJob: (job: Omit<Job, 'id' | 'color' | 'status' | 'progress'>) => Promise<void>;
  updateJob: (id: number, patch: Partial<Job>) => Promise<void>;
  removeJob: (id: number) => Promise<void>;
}

const SchedulingContext = createContext<SchedulingContextValue | null>(null);

export function SchedulingProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>(FALLBACK_JOBS);

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
      });
    } else {
      setJobs((prev) => [
        ...prev,
        { ...job, id: nextFallbackId++, status: 'planned', progress: 0, color },
      ]);
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
      await supabase.from('jobs').update(dbPatch).eq('id', id);
    } else {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    }
  }

  async function removeJob(id: number) {
    if (supabase) {
      await supabase.from('jobs').delete().eq('id', id);
    } else {
      setJobs((prev) => prev.filter((j) => j.id !== id));
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
