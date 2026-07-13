import { createContext, useContext, useState, type ReactNode } from 'react';

export type JobStatus = 'planned' | 'inProgress' | 'done' | 'delayed';

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
}

const STORAGE_KEY = 'dravaint-jobs';

const COLORS = ['#1a365d', '#2b6cb0', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0e7490'];

function colorFor(index: number) {
  return COLORS[index % COLORS.length];
}

const DEFAULT_JOBS: Job[] = [
  {
    id: 1,
    machine: 'CNC-1',
    order: 'RN-2026-014',
    operator: 'Goran Ć.',
    start: '2026-07-13T06:00',
    end: '2026-07-15T14:00',
    status: 'inProgress',
    progress: 55,
    color: colorFor(0),
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
    color: colorFor(1),
  },
  {
    id: 3,
    machine: 'Glodalica-1',
    order: 'RN-2026-016',
    operator: 'Damir M.',
    start: '2026-07-12T06:00',
    end: '2026-07-13T13:00',
    status: 'done',
    progress: 100,
    color: colorFor(2),
  },
];

function loadJobs(): Job[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_JOBS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_JOBS;
  } catch {
    return DEFAULT_JOBS;
  }
}

function saveJobs(jobs: Job[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

let nextId = 1000;

interface SchedulingContextValue {
  jobs: Job[];
  addJob: (job: Omit<Job, 'id' | 'color' | 'status' | 'progress'>) => void;
  updateJob: (id: number, patch: Partial<Job>) => void;
  removeJob: (id: number) => void;
}

const SchedulingContext = createContext<SchedulingContextValue | null>(null);

export function SchedulingProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>(() => loadJobs());

  function persist(next: Job[]) {
    setJobs(next);
    saveJobs(next);
  }

  function addJob(job: Omit<Job, 'id' | 'color' | 'status' | 'progress'>) {
    const next = [
      ...jobs,
      { ...job, id: nextId++, status: 'planned' as JobStatus, progress: 0, color: colorFor(jobs.length) },
    ];
    persist(next);
  }

  function updateJob(id: number, patch: Partial<Job>) {
    const next = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
    persist(next);
  }

  function removeJob(id: number) {
    const next = jobs.filter((j) => j.id !== id);
    persist(next);
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
