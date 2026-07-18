import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase/client';

export type MachineType = 'mill' | 'lathe' | 'saw' | 'qc' | 'other';
export type MillAxis = 3 | 5;

/** Machine types that are registrable/capacity-tracked. Routings reference saw ("Pila") and a QC
 * station ("Kontrola kvalitete") beyond the original mill/lathe pair. */
export const MACHINE_TYPES: MachineType[] = ['mill', 'lathe', 'saw', 'qc', 'other'];

export interface Machine {
  id: number;
  name: string;
  type: MachineType;
  axis: MillAxis | null; // only meaningful for mills
}

interface MachineRow {
  id: number;
  name: string;
  type: MachineType;
  axis: MillAxis | null;
}

const FALLBACK_MACHINES: Machine[] = [
  { id: 1, name: 'CNC-1', type: 'mill', axis: 3 },
  { id: 2, name: 'CNC-2', type: 'mill', axis: 5 },
  { id: 3, name: 'Tokarilica-1', type: 'lathe', axis: null },
  { id: 4, name: 'Tokarilica-2', type: 'lathe', axis: null },
  // Spare lathe, not currently scheduled - genuinely idle rather than merely light.
  { id: 5, name: 'Tokarilica-3', type: 'lathe', axis: null },
  // Referenced by routings (saw + QC station) so they can be registered and capacity-tracked.
  { id: 6, name: 'Pila', type: 'saw', axis: null },
  { id: 7, name: 'Kontrola kvalitete', type: 'qc', axis: null },
];

const FALLBACK_STORAGE_KEY = 'dravaint-machines-fallback';

function loadFallbackMachines(): Machine[] {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return FALLBACK_MACHINES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : FALLBACK_MACHINES;
  } catch {
    return FALLBACK_MACHINES;
  }
}

function saveFallbackMachines(machines: Machine[]) {
  localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(machines));
}

let nextFallbackId = 1000;

/** Outcome of a machine write. `duplicate`/`invalid` are validation results the UI already has
 * copy for; `db` carries the real Supabase/Postgres message so it isn't mislabeled as a duplicate. */
export type MachineWriteResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate' | 'invalid' | 'db'; message?: string };

interface MachinesContextValue {
  machines: Machine[];
  addMachine: (machine: Omit<Machine, 'id'>) => Promise<MachineWriteResult>;
  updateMachine: (id: number, patch: Partial<Omit<Machine, 'id'>>) => Promise<MachineWriteResult>;
  removeMachine: (id: number) => Promise<void>;
}

const MachinesContext = createContext<MachinesContextValue | null>(null);

export function MachinesProvider({ children }: { children: ReactNode }) {
  const [machines, setMachines] = useState<Machine[]>(() => {
    // In Supabase mode start empty: the demo FALLBACK_MACHINES don't exist in a live database,
    // and offering them as picker options lets users write job rows referencing phantom machines.
    if (supabase) return [];
    const loaded = loadFallbackMachines();
    nextFallbackId = Math.max(nextFallbackId, ...loaded.map((m) => m.id + 1));
    return loaded;
  });

  const loadMachines = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('machines').select('*').order('id');
    if (error) console.warn('[machines] load failed:', error.message);
    else if (data) setMachines(data as MachineRow[]);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void loadMachines();

    const channel = supabase
      .channel('machines-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, () => void loadMachines())
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, [loadMachines]);

  async function addMachine(machine: Omit<Machine, 'id'>): Promise<MachineWriteResult> {
    const trimmed = machine.name.trim();
    if (!trimmed) return { ok: false, reason: 'invalid' };
    if (machines.some((m) => m.name.toLowerCase() === trimmed.toLowerCase())) return { ok: false, reason: 'duplicate' };
    const axis = machine.type === 'mill' ? machine.axis : null;

    if (supabase) {
      const { error } = await supabase.from('machines').insert({ name: trimmed, type: machine.type, axis });
      if (error) {
        // 23505 = unique violation: the machine exists server-side even though the local list
        // didn't show it (e.g. an earlier attempt landed but the refresh was missed) — resync so
        // the hidden row becomes visible alongside the duplicate message.
        if (error.code === '23505') {
          void loadMachines();
          return { ok: false, reason: 'duplicate', message: error.message };
        }
        return { ok: false, reason: 'db', message: error.message };
      }
      // Refresh directly rather than relying on the realtime channel to echo our own write.
      await loadMachines();
    } else {
      setMachines((prev) => {
        const next = [...prev, { id: nextFallbackId++, name: trimmed, type: machine.type, axis }];
        saveFallbackMachines(next);
        return next;
      });
    }
    return { ok: true };
  }

  async function updateMachine(id: number, patch: Partial<Omit<Machine, 'id'>>): Promise<MachineWriteResult> {
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) return { ok: false, reason: 'invalid' };
      if (machines.some((m) => m.id !== id && m.name.toLowerCase() === trimmed.toLowerCase())) return { ok: false, reason: 'duplicate' };
      patch = { ...patch, name: trimmed };
    }
    if (patch.type !== undefined && patch.type !== 'mill') patch = { ...patch, axis: null };

    if (supabase) {
      const { error } = await supabase.from('machines').update(patch).eq('id', id);
      if (error) {
        if (error.code === '23505') {
          void loadMachines();
          return { ok: false, reason: 'duplicate', message: error.message };
        }
        return { ok: false, reason: 'db', message: error.message };
      }
      await loadMachines();
    } else {
      setMachines((prev) => {
        const next = prev.map((m) => (m.id === id ? { ...m, ...patch } : m));
        saveFallbackMachines(next);
        return next;
      });
    }
    return { ok: true };
  }

  async function removeMachine(id: number) {
    if (supabase) {
      const { error } = await supabase.from('machines').delete().eq('id', id);
      if (error) console.warn('[machines] delete failed:', error.message);
      await loadMachines();
    } else {
      setMachines((prev) => {
        const next = prev.filter((m) => m.id !== id);
        saveFallbackMachines(next);
        return next;
      });
    }
  }

  return (
    <MachinesContext.Provider value={{ machines, addMachine, updateMachine, removeMachine }}>
      {children}
    </MachinesContext.Provider>
  );
}

export function useMachines() {
  const ctx = useContext(MachinesContext);
  if (!ctx) throw new Error('useMachines must be used within MachinesProvider');
  return ctx;
}
