import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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

interface MachinesContextValue {
  machines: Machine[];
  addMachine: (machine: Omit<Machine, 'id'>) => Promise<boolean>;
  updateMachine: (id: number, patch: Partial<Omit<Machine, 'id'>>) => Promise<boolean>;
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

  useEffect(() => {
    if (!supabase) return;

    async function loadMachines() {
      const { data, error } = await supabase!.from('machines').select('*').order('id');
      if (error) console.warn('[machines] load failed:', error.message);
      else if (data) setMachines(data as MachineRow[]);
    }
    loadMachines();

    const channel = supabase
      .channel('machines-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, loadMachines)
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, []);

  async function addMachine(machine: Omit<Machine, 'id'>): Promise<boolean> {
    const trimmed = machine.name.trim();
    if (!trimmed) return false;
    if (machines.some((m) => m.name.toLowerCase() === trimmed.toLowerCase())) return false;
    const axis = machine.type === 'mill' ? machine.axis : null;

    if (supabase) {
      const { error } = await supabase.from('machines').insert({ name: trimmed, type: machine.type, axis });
      if (error) return false;
    } else {
      setMachines((prev) => {
        const next = [...prev, { id: nextFallbackId++, name: trimmed, type: machine.type, axis }];
        saveFallbackMachines(next);
        return next;
      });
    }
    return true;
  }

  async function updateMachine(id: number, patch: Partial<Omit<Machine, 'id'>>): Promise<boolean> {
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) return false;
      if (machines.some((m) => m.id !== id && m.name.toLowerCase() === trimmed.toLowerCase())) return false;
      patch = { ...patch, name: trimmed };
    }
    if (patch.type !== undefined && patch.type !== 'mill') patch = { ...patch, axis: null };

    if (supabase) {
      const { error } = await supabase.from('machines').update(patch).eq('id', id);
      if (error) return false;
    } else {
      setMachines((prev) => {
        const next = prev.map((m) => (m.id === id ? { ...m, ...patch } : m));
        saveFallbackMachines(next);
        return next;
      });
    }
    return true;
  }

  async function removeMachine(id: number) {
    if (supabase) {
      await supabase.from('machines').delete().eq('id', id);
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
