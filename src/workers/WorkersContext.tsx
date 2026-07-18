import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, onAuthUserChange } from '../supabase/client';
import { enqueueMutation } from '../sync/offlineQueue';

export type WorkerStatus = 'available' | 'busy' | 'break' | 'absent';

export interface Worker {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  roleId: number | null;
  roleName: string;
  appUserId: string | null;
  isActive: boolean;
  status: WorkerStatus;
  qualifications: string[];
}

type WorkerInput = Omit<Worker, 'id' | 'status'> & { status?: WorkerStatus };

interface WorkersContextValue {
  workers: Worker[];
  activeWorkers: Worker[];
  loading: boolean;
  syncError: string | null;
  addWorker: (worker: WorkerInput) => Promise<boolean>;
  updateWorker: (id: number, patch: Partial<Worker>) => Promise<boolean>;
  archiveWorker: (id: number) => Promise<void>;
  removeWorker: (id: number) => Promise<boolean>;
  setWorkerStatus: (id: number, status: WorkerStatus) => Promise<void>;
  displayName: (worker: Worker) => string;
}

const STORAGE_KEY = 'dravaint-workers-v2';

const DEFAULT_WORKERS: Worker[] = [
  { id: 1, firstName: 'Goran', lastName: 'Ć.', email: 'goran@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: true, status: 'available', qualifications: ['CNC-1', 'CNC-2'] },
  { id: 2, firstName: 'Alen', lastName: 'M.', email: 'alen@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: true, status: 'busy', qualifications: ['CNC-2'] },
  { id: 3, firstName: 'Damir', lastName: 'M.', email: 'damir@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: true, status: 'available', qualifications: ['Tokarilica-1'] },
  { id: 4, firstName: 'Krunoslav', lastName: 'S.', email: 'krunoslav@dravaint.local', roleId: null, roleName: 'managers', appUserId: null, isActive: true, status: 'available', qualifications: ['CNC-1', 'CNC-2', 'Tokarilica-1'] },
  { id: 5, firstName: 'Dorian', lastName: 'T.', email: 'dorian@dravaint.local', roleId: null, roleName: 'boss', appUserId: null, isActive: true, status: 'available', qualifications: ['Kontrola kvalitete'] },
  { id: 6, firstName: 'Božidar', lastName: 'B.', email: 'bozidar@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: true, status: 'break', qualifications: ['CNC-1'] },
  { id: 7, firstName: 'Ivana', lastName: 'K.', email: 'ivana@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: true, status: 'available', qualifications: ['Pila', 'Tokarilica-1'] },
  { id: 8, firstName: 'Tomislav', lastName: 'P.', email: 'tomislav@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: true, status: 'available', qualifications: [] },
  { id: 9, firstName: 'Nikola', lastName: 'V.', email: 'nikola@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: true, status: 'absent', qualifications: ['Tokarilica-2'] },
  { id: 10, firstName: 'Marija', lastName: 'H.', email: 'marija@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: true, status: 'available', qualifications: ['Kontrola kvalitete'] },
  { id: 11, firstName: 'Petra', lastName: 'J.', email: 'petra@dravaint.local', roleId: null, roleName: 'managers', appUserId: null, isActive: true, status: 'available', qualifications: ['CNC-1', 'CNC-2', 'Tokarilica-1', 'Tokarilica-2', 'Pila', 'Kontrola kvalitete'] },
  { id: 12, firstName: 'Filip', lastName: 'R.', email: 'filip@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: true, status: 'available', qualifications: ['CNC-2'] },
  { id: 13, firstName: 'Stjepan', lastName: 'D.', email: 'stjepan@dravaint.local', roleId: null, roleName: 'workers', appUserId: null, isActive: false, status: 'available', qualifications: ['CNC-1'] },
];

function loadWorkers(): Worker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Worker[];
      if (Array.isArray(parsed)) return parsed;
    }

    const legacy = localStorage.getItem('dravaint-workers-list');
    if (legacy) {
      const parsed = JSON.parse(legacy) as Array<{ id: number; name: string; role?: string; appAccount?: string }>;
      if (Array.isArray(parsed)) {
        return parsed.map((worker) => {
          const [firstName = '', ...last] = worker.name.trim().split(/\s+/);
          return {
            id: worker.id,
            firstName,
            lastName: last.join(' '),
            email: worker.appAccount ? `${worker.appAccount}@dravaint.local` : '',
            roleId: null,
            roleName: worker.role || 'workers',
            appUserId: null,
            isActive: true,
            status: 'available' as const,
            qualifications: [],
          };
        });
      }
    }
  } catch {
    // A corrupt local cache should never stop the workshop terminal from loading.
  }
  return DEFAULT_WORKERS;
}

function persist(workers: Worker[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workers));
}

function rowToWorker(row: Record<string, unknown>): Worker {
  const role = row.roles as { id?: number; name?: string } | null;
  return {
    id: Number(row.id),
    firstName: String(row.first_name ?? ''),
    lastName: String(row.last_name ?? ''),
    email: String(row.email ?? ''),
    roleId: row.role_id == null ? null : Number(row.role_id),
    roleName: role?.name ?? String(row.role_name ?? 'workers'),
    appUserId: row.app_user_id == null ? null : String(row.app_user_id),
    isActive: row.is_active !== false && row.deleted_at == null,
    status: (row.status as WorkerStatus) || 'available',
    qualifications: Array.isArray(row.qualifications) ? row.qualifications.map(String) : [],
  };
}

const WorkersContext = createContext<WorkersContextValue | null>(null);

export function WorkersProvider({ children }: { children: ReactNode }) {
  const [workers, setWorkers] = useState<Worker[]>(loadWorkers);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadRemote = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('workers')
      .select('id,first_name,last_name,email,role_id,app_user_id,is_active,status,qualifications,deleted_at,roles(id,name)')
      .order('last_name');
    if (error) {
      setSyncError(error.message);
    } else if (data) {
      const next = data.map((row) => rowToWorker(row as unknown as Record<string, unknown>));
      setWorkers(next);
      persist(next);
      setSyncError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    void loadRemote();
    const channel = client
      .channel('workers-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workers' }, () => void loadRemote())
      .subscribe();
    // The mount fetch above can fire before login (as anon, which has no table grants);
    // refetch once a user signs in so the list doesn't stay empty until a reload.
    const unsubscribeAuth = onAuthUserChange(() => void loadRemote());
    return () => {
      void client.removeChannel(channel);
      unsubscribeAuth();
    };
  }, [loadRemote]);

  async function addWorker(input: WorkerInput): Promise<boolean> {
    if (!input.firstName.trim() || !input.lastName.trim()) return false;
    if (input.email && workers.some((worker) => worker.email.toLowerCase() === input.email.toLowerCase())) return false;

    if (supabase) {
      const { error } = await supabase.from('workers').insert({
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        email: input.email.trim() || null,
        role_id: input.roleId,
        app_user_id: input.appUserId,
        is_active: input.isActive,
        status: input.status ?? 'available',
        qualifications: input.qualifications,
      });
      if (error) {
        setSyncError(error.message);
        await enqueueMutation({ table: 'workers', operation: 'insert', payload: { first_name: input.firstName.trim(), last_name: input.lastName.trim(), email: input.email.trim() || null, role_id: input.roleId, is_active: input.isActive, status: input.status ?? 'available', qualifications: input.qualifications } });
        return false;
      }
      // Refresh directly instead of relying on the realtime channel to echo our own
      // write — without this a new worker stays invisible everywhere until a reload.
      await loadRemote();
      return true;
    }

    const next = [...workers, { ...input, id: Math.max(0, ...workers.map((worker) => worker.id)) + 1, status: input.status ?? 'available' }];
    setWorkers(next);
    persist(next);
    return true;
  }

  async function updateWorker(id: number, patch: Partial<Worker>): Promise<boolean> {
    const next = workers.map((worker) => (worker.id === id ? { ...worker, ...patch } : worker));
    setWorkers(next);
    persist(next);

    if (supabase) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.firstName !== undefined) dbPatch.first_name = patch.firstName;
      if (patch.lastName !== undefined) dbPatch.last_name = patch.lastName;
      if (patch.email !== undefined) dbPatch.email = patch.email || null;
      if (patch.roleId !== undefined) dbPatch.role_id = patch.roleId;
      if (patch.appUserId !== undefined) dbPatch.app_user_id = patch.appUserId;
      if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      if (patch.qualifications !== undefined) dbPatch.qualifications = patch.qualifications;
      const { error } = await supabase.from('workers').update(dbPatch).eq('id', id);
      if (error) {
        setSyncError(error.message);
        await enqueueMutation({ table: 'workers', operation: 'update', payload: dbPatch, match: { id } });
        return false;
      }
      void loadRemote();
    }
    return true;
  }

  async function archiveWorker(id: number) {
    await updateWorker(id, { isActive: false });
    if (supabase) {
      await supabase.from('workers').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      void loadRemote();
    }
  }

  /** Permanent removal. Unlike archiveWorker this hard-deletes the row; the database cascades
   * away the worker's shift assignments and absences (audit_logs keeps the row images). The
   * Admin UI only offers this for already-archived workers, behind a confirm dialog. */
  async function removeWorker(id: number): Promise<boolean> {
    if (supabase) {
      const { error } = await supabase.from('workers').delete().eq('id', id);
      if (error) {
        setSyncError(error.message);
        return false;
      }
      await loadRemote();
      return true;
    }
    const next = workers.filter((worker) => worker.id !== id);
    setWorkers(next);
    persist(next);
    return true;
  }

  async function setWorkerStatus(id: number, status: WorkerStatus) {
    await updateWorker(id, { status });
  }

  const value: WorkersContextValue = {
    workers,
    activeWorkers: workers.filter((worker) => worker.isActive),
    loading,
    syncError,
    addWorker,
    updateWorker,
    archiveWorker,
    removeWorker,
    setWorkerStatus,
    displayName: (worker) => `${worker.firstName} ${worker.lastName}`.trim(),
  };

  return <WorkersContext.Provider value={value}>{children}</WorkersContext.Provider>;
}

export function useWorkers() {
  const context = useContext(WorkersContext);
  if (!context) throw new Error('useWorkers must be used within WorkersProvider');
  return context;
}
