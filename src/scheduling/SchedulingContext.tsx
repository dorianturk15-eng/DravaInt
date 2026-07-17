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
  /** Worker assigned to this specific operation. Multi-op routing orders are worked by different
   * people per step (a lathe operator, then a mill operator, then QC), so the assignment lives on
   * the operation, not the parent order — whose top-level `operator` is often just a product label. */
  operator?: string;
  operatorId?: number | null;
}

export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

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
  priority?: JobPriority;
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
  priority?: JobPriority | null;
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
    priority: row.priority ?? 'normal',
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
      { id: 1, name: 'Tokarenje', machine: 'Tokarilica-1', hours: 4, operator: 'Damir M.', operatorId: 3 },
      { id: 2, name: 'Glodanje (5-osno)', machine: 'CNC-2', hours: 6, operator: 'Alen M.', operatorId: 2 },
      { id: 3, name: 'Završna kontrola', machine: 'Kontrola kvalitete', hours: 1, operator: 'Marija H.', operatorId: 10 },
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
      { id: 1, name: 'Pila', machine: 'Pila', hours: 2, operator: 'Ivana K.', operatorId: 7 },
      { id: 2, name: 'Glodanje Operacija 1', machine: 'CNC-1', hours: 3, operator: 'Goran Ć.', operatorId: 1 },
      { id: 3, name: 'Glodanje Operacija 2', machine: 'CNC-1', hours: 2, operator: 'Goran Ć.', operatorId: 1 },
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
      { id: 1, name: 'Tokarenje Operacija 1', machine: 'Tokarilica-1', hours: 3, operator: 'Damir M.', operatorId: 3 },
      { id: 2, name: 'Glodanje Operacija 1', machine: 'CNC-2', hours: 4, operator: 'Filip R.', operatorId: 12 },
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
      { id: 1, name: 'Pila', machine: 'Pila', hours: 1.5, operator: 'Ivana K.', operatorId: 7 },
      { id: 2, name: 'Tokarenje Operacija 1', machine: 'Tokarilica-1', hours: 2, operator: 'Damir M.', operatorId: 3 },
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
      { id: 1, name: 'Glodanje Operacija 1', machine: 'CNC-1', hours: 3, operator: 'Božidar B.', operatorId: 6 },
      { id: 2, name: 'Glodanje Operacija 2', machine: 'CNC-1', hours: 2, operator: 'Božidar B.', operatorId: 6 },
    ],
  },

  // -- Additional realistic shop-floor data below: completed history, future
  // planning, near-capacity and idle machines, and a handful of jobs that
  // deliberately collide (double-booking, tight rest windows, unqualified
  // assignments) the way a real week on the floor eventually does. --

  {
    id: 40,
    machine: 'CNC-1',
    order: 'RN-2025-998',
    operator: 'Božidar B.',
    product: 'Kućište - standardna serija',
    start: '2026-07-08T06:00',
    end: '2026-07-10T14:00',
    status: 'done',
    progress: 100,
    color: COLORS[5],
    materialStatus: 'ready',
    comments: 'Isporučeno na vrijeme.',
  },
  {
    id: 41,
    machine: 'Tokarilica-2',
    order: 'RN-2026-050',
    operator: 'Nikola V.',
    product: 'Vratilo - manja serija',
    start: '2026-07-20T06:00',
    end: '2026-07-20T10:00',
    status: 'planned',
    progress: 0,
    color: COLORS[6],
    comments: 'Nikola je vodio kao nedostupan u sustavu — provjeriti prije potvrde.',
  },
  {
    id: 42,
    machine: 'CNC-2',
    order: 'RN-2026-051',
    operator: 'Alen M.',
    product: 'Poklopac - hitna narudžba',
    start: '2026-07-17T06:00',
    end: '2026-07-17T14:00',
    status: 'inProgress',
    progress: 45,
    color: COLORS[0],
    priority: 'urgent',
  },
  {
    id: 43,
    machine: 'CNC-2',
    order: 'RN-2026-052',
    operator: 'Filip R.',
    product: 'Prirubnica',
    start: '2026-07-17T10:00',
    end: '2026-07-17T18:00',
    status: 'planned',
    progress: 0,
    color: COLORS[1],
    comments: 'Dvostruka rezervacija CNC-2 s RN-2026-051 — provjeriti raspored stroja.',
  },
  {
    id: 44,
    machine: 'CNC-2',
    order: 'RN-2026-053',
    operator: 'Krunoslav S.',
    product: 'Umetak kalupa',
    start: '2026-07-15T14:00',
    end: '2026-07-15T18:00',
    status: 'planned',
    progress: 0,
    color: COLORS[2],
    comments: 'Preklapa se s CNC-2 operacijom unutar RN-2026-030-A2 (16:00-20:00) — sustav to ne prijavljuje jer je ondje stroj zapisan kao dio cijele rute, ne kao "CNC-2".',
  },
  {
    id: 45,
    machine: 'Tokarilica-1',
    order: 'RN-2026-054',
    operator: 'Alen M.',
    product: 'Osovina',
    start: '2026-07-21T06:00',
    end: '2026-07-21T12:00',
    status: 'planned',
    progress: 0,
    color: COLORS[3],
    comments: 'Alen je kvalificiran samo za CNC-2 — ovo bi trebalo biti prijavljeno kao nekvalificirano.',
  },
  {
    id: 46,
    machine: 'CNC-1',
    order: 'RN-2026-055',
    operator: 'Tomislav P.',
    product: 'Nosač',
    start: '2026-07-22T06:00',
    end: '2026-07-22T14:00',
    status: 'planned',
    progress: 0,
    color: COLORS[4],
    comments: 'Tomislav (pripravnik) nema upisane kvalifikacije u profilu.',
  },
  {
    id: 47,
    machine: 'Tokarilica-1',
    order: 'RN-2026-056',
    operator: 'Damir M.',
    product: 'Čahura',
    start: '2026-07-16T14:00',
    end: '2026-07-16T22:00',
    status: 'planned',
    progress: 0,
    color: COLORS[5],
  },
  {
    id: 48,
    machine: 'Pila',
    order: 'RN-2026-057',
    operator: 'Damir M.',
    product: 'Šipka - rezanje na duljinu',
    start: '2026-07-17T06:00',
    end: '2026-07-17T09:00',
    status: 'planned',
    progress: 0,
    color: COLORS[6],
    comments: 'Samo 8h odmora od kraja RN-2026-056 - brzi okret smjene.',
  },
  {
    id: 49,
    machine: 'Tokarilica-2',
    order: 'RN-2026-058',
    operator: 'Krunoslav S.',
    product: 'Podrška stroju - pokrivanje',
    start: '2026-07-13T06:00',
    end: '2026-07-13T18:00',
    status: 'done',
    progress: 100,
    color: COLORS[0],
  },
  {
    id: 50,
    machine: 'Tokarilica-2',
    order: 'RN-2026-059',
    operator: 'Krunoslav S.',
    product: 'Podrška stroju - pokrivanje',
    start: '2026-07-14T06:00',
    end: '2026-07-14T18:00',
    status: 'done',
    progress: 100,
    color: COLORS[1],
  },
  {
    id: 51,
    machine: 'Tokarilica-2',
    order: 'RN-2026-060',
    operator: 'Krunoslav S.',
    product: 'Podrška stroju - pokrivanje',
    start: '2026-07-16T06:00',
    end: '2026-07-16T18:00',
    status: 'inProgress',
    progress: 60,
    color: COLORS[2],
  },
  {
    id: 52,
    machine: 'Tokarilica-2',
    order: 'RN-2026-061',
    operator: 'Krunoslav S.',
    product: 'Podrška stroju - pokrivanje',
    start: '2026-07-17T06:00',
    end: '2026-07-17T18:00',
    status: 'planned',
    progress: 0,
    color: COLORS[3],
    comments: 'Krunoslav ovaj tjedan pokriva više strojeva - provjeriti ukupne sate.',
  },
  {
    id: 53,
    machine: 'Pila',
    order: 'RN-2026-062',
    operator: 'Ivana K.',
    product: 'Ploča - priprema materijala',
    start: '2026-07-20T06:00',
    end: '2026-07-20T09:00',
    status: 'planned',
    progress: 0,
    color: COLORS[4],
  },
  {
    id: 54,
    machine: 'Tokarilica-1',
    order: 'RN-2026-063',
    operator: 'Damir M.',
    product: 'Osovina - paralelna obrada',
    start: '2026-07-20T06:00',
    end: '2026-07-20T14:00',
    status: 'planned',
    progress: 0,
    color: COLORS[5],
    dependencies: [{ jobId: 53, type: 'SS', lagHours: 2 }],
    comments: 'Kreće 2h nakon starta RN-2026-062 (paralelan rad, ne čeka njegov završetak).',
  },
  {
    id: 55,
    machine: 'Kontrola kvalitete',
    order: 'RN-2026-064',
    operator: 'Marija H.',
    product: 'Osovina - završna kontrola',
    start: '2026-07-21T06:00',
    end: '2026-07-21T10:00',
    status: 'planned',
    progress: 0,
    color: COLORS[6],
    dependencies: [{ jobId: 54, type: 'FF', lagHours: 1 }],
    comments: 'Mora završiti najmanje 1h nakon završetka RN-2026-063.',
  },
  {
    id: 56,
    machine: 'Pila → Tokarilica-2 → CNC-1 → Kontrola kvalitete',
    order: 'RN-2026-070',
    operator: 'Poklopac kućišta - serija 200 kom',
    product: 'Poklopac kućišta',
    start: '2026-07-20T06:00',
    end: '2026-07-20T06:00',
    status: 'planned',
    progress: 0,
    color: COLORS[0],
    materialStatus: 'waiting',
    priority: 'high',
    comments: 'Velika serija (200 kom), rok 24.7. Čeka se sirovina. Tokarenje je dodijeljeno Nikoli V. koji je trenutno odsutan — sada se prijavljuje i na razini operacije rute.',
    operations: [
      { id: 1, name: 'Pila', machine: 'Pila', hours: 2, operator: 'Ivana K.', operatorId: 7 },
      { id: 2, name: 'Tokarenje grubo', machine: 'Tokarilica-2', hours: 5, operator: 'Nikola V.', operatorId: 9 },
      { id: 3, name: 'Glodanje finalno', machine: 'CNC-1', hours: 6, operator: 'Goran Ć.', operatorId: 1 },
      { id: 4, name: 'Završna kontrola', machine: 'Kontrola kvalitete', hours: 1.5, operator: 'Marija H.', operatorId: 10 },
    ],
  },
  {
    id: 57,
    machine: 'CNC-1',
    order: 'RN-2026-040',
    operator: 'Božidar B.',
    product: 'Ventilska ploča',
    start: '2026-07-04T06:00',
    end: '2026-07-06T10:00',
    status: 'planned',
    progress: 30,
    color: COLORS[1],
    materialStatus: 'delayed',
    priority: 'high',
    comments: 'Kupac je zvao - kasni isporuka! Rok je prošao, a status nikad nije ručno promijenjen na "kašnjenje".',
  },
  {
    id: 58,
    machine: 'Tokarilica-1',
    order: 'RN-2026-041',
    operator: 'Ivana K.',
    product: 'Čahura - veća serija',
    start: '2026-07-27T06:00',
    end: '2026-07-27T14:00',
    status: 'delayed',
    progress: 10,
    color: COLORS[2],
    comments: 'Ručno označeno kao kašnjenje zbog kašnjenja dobavljača materijala - stvarni rok (27.7.) je zapravo tek za deset dana.',
  },
  {
    id: 59,
    machine: 'Tokarilica-1 → CNC-1',
    order: 'RN-2026-080',
    operator: 'Osovina - finalna obrada',
    product: 'Osovina',
    start: '2026-07-23T06:00',
    end: '2026-07-23T06:00',
    status: 'planned',
    progress: 0,
    color: COLORS[3],
    comments: 'Standardni nalog, bez posebnosti.',
    operations: [
      { id: 1, name: 'Tokarenje', machine: 'Tokarilica-1', hours: 3, operator: 'Damir M.', operatorId: 3 },
      { id: 2, name: 'Glodanje', machine: 'CNC-1', hours: 2, operator: 'Goran Ć.', operatorId: 1 },
    ],
  },
  {
    id: 60,
    machine: 'CNC-1',
    order: 'RN-2026-081',
    operator: 'Božidar B.',
    product: 'Držač senzora',
    start: '2026-07-24T06:00',
    end: '2026-07-24T08:00',
    status: 'planned',
    progress: 0,
    color: COLORS[4],
    priority: 'low',
    comments: 'Nizak prioritet - može pričekati do kraja mjeseca.',
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
    // In Supabase mode start empty: the demo FALLBACK_JOBS reference workers/machines that don't
    // exist in a live database, and flashing them as if real invites edits against phantom rows.
    if (supabase) return [];
    const loaded = loadFallbackJobs();
    nextFallbackId = Math.max(nextFallbackId, ...loaded.map((j) => j.id + 1));
    return loaded;
  });
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;

    async function loadJobs() {
      const { data, error } = await supabase!.from('jobs').select('*').is('deleted_at', null).order('id');
      if (error) console.warn('[scheduling] jobs load failed:', error.message);
      else if (data) setJobs((data as JobRow[]).map(rowToJob));
      setLoading(false);
    }
    loadJobs();

    const channel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadJobs)
      .subscribe();

    // Reconciliation pass: refetch when the terminal regains focus, catching any drift the
    // realtime channel missed while the tab was backgrounded or briefly disconnected.
    const onFocus = () => {
      if (document.visibilityState === 'visible') void loadJobs();
    };
    window.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);

    return () => {
      supabase!.removeChannel(channel);
      window.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
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
        priority: job.priority ?? 'normal',
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
      if (patch.priority !== undefined) dbPatch.priority = patch.priority;
      dbPatch.version = (jobs.find((job) => job.id === id)?.version ?? 1) + 1;
      let query = supabase.from('jobs').update(dbPatch).eq('id', id);
      const expectedVersion = jobs.find((job) => job.id === id)?.version;
      if (expectedVersion !== undefined) query = query.eq('version', expectedVersion);
      const { error, data } = await query.select('id');
      if (error) {
        if (error.code === SLOT_TAKEN_ERRCODE) return { ok: false, reason: 'rejected', message: error.message };
        // Carry the expected version into the queued match so the offline replay is optimistically
        // locked too — a reconnecting terminal won't overwrite a newer edit made by someone else.
        const replayMatch: Record<string, string | number> = expectedVersion !== undefined ? { id, version: expectedVersion } : { id };
        await enqueueMutation({ table: 'jobs', operation: 'update', payload: dbPatch, match: replayMatch });
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
      // Soft delete: the schema's deleted_at column keeps history intact (audit trail, dependency
      // references) and every read filters on `deleted_at is null`.
      const deletedAt = new Date().toISOString();
      const { error } = await supabase.from('jobs').update({ deleted_at: deletedAt }).eq('id', id);
      if (error) await enqueueMutation({ table: 'jobs', operation: 'update', payload: { deleted_at: deletedAt }, match: { id } });
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

    const results = await Promise.all(replays);
    // Surface partial failures instead of optimistically showing the restored state as if every
    // replayed write persisted. The realtime channel will reconcile local state to the server truth
    // shortly; log so a failed undo/redo replay isn't completely invisible.
    const failed = results.filter((result): result is UpdateResult => Boolean(result) && (result as UpdateResult).ok === false);
    if (failed.length) console.warn(`[restoreBackup] ${failed.length} replayed change(s) did not persist:`, failed.map((f) => (f as Extract<UpdateResult, { ok: false }>).reason));
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
