import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase/client';

export type MachineType = 'mill' | 'lathe';
export type MillAxis = 3 | 5;

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
];

let nextFallbackId = 1000;

interface MachinesContextValue {
  machines: Machine[];
  addMachine: (machine: Omit<Machine, 'id'>) => Promise<boolean>;
  updateMachine: (id: number, patch: Partial<Omit<Machine, 'id'>>) => Promise<boolean>;
  removeMachine: (id: number) => Promise<void>;
}

const MachinesContext = createContext<MachinesContextValue | null>(null);

export function MachinesProvider({ children }: { children: ReactNode }) {
  const [machines, setMachines] = useState<Machine[]>(FALLBACK_MACHINES);

  useEffect(() => {
    if (!supabase) return;

    async function loadMachines() {
      const { data, error } = await supabase!.from('machines').select('*').order('id');
      if (!error && data) setMachines(data as MachineRow[]);
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
      setMachines((prev) => [...prev, { id: nextFallbackId++, name: trimmed, type: machine.type, axis }]);
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
    if (patch.type === 'lathe') patch = { ...patch, axis: null };

    if (supabase) {
      const { error } = await supabase.from('machines').update(patch).eq('id', id);
      if (error) return false;
    } else {
      setMachines((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    }
    return true;
  }

  async function removeMachine(id: number) {
    if (supabase) {
      await supabase.from('machines').delete().eq('id', id);
    } else {
      setMachines((prev) => prev.filter((m) => m.id !== id));
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
