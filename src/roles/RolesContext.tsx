import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase/client';

export interface Role {
  id: number;
  name: string;
}

const FALLBACK_ROLES: Role[] = [
  { id: 1, name: 'Alatničar' },
  { id: 2, name: 'Pomoćni alatničar' },
  { id: 3, name: 'CNC Operater' },
  { id: 4, name: 'CNC Programer' },
];

const FALLBACK_STORAGE_KEY = 'dravaint-roles-fallback';

function loadFallbackRoles(): Role[] {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return FALLBACK_ROLES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : FALLBACK_ROLES;
  } catch {
    return FALLBACK_ROLES;
  }
}

function saveFallbackRoles(roles: Role[]) {
  localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(roles));
}

let nextFallbackId = 1000;

interface RolesContextValue {
  roles: Role[];
  addRole: (name: string) => Promise<boolean>;
  removeRole: (id: number) => Promise<void>;
}

const RolesContext = createContext<RolesContextValue | null>(null);

export function RolesProvider({ children }: { children: ReactNode }) {
  const [roles, setRoles] = useState<Role[]>(() => {
    if (supabase) return FALLBACK_ROLES;
    const loaded = loadFallbackRoles();
    nextFallbackId = Math.max(nextFallbackId, ...loaded.map((r) => r.id + 1));
    return loaded;
  });

  useEffect(() => {
    if (!supabase) return;

    async function loadRoles() {
      const { data, error } = await supabase!.from('roles').select('*').order('id');
      if (!error && data) setRoles(data as Role[]);
    }
    loadRoles();

    const channel = supabase
      .channel('roles-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, loadRoles)
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, []);

  async function addRole(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (roles.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) return false;

    if (supabase) {
      const { error } = await supabase.from('roles').insert({ name: trimmed });
      if (error) return false;
    } else {
      setRoles((prev) => {
        const next = [...prev, { id: nextFallbackId++, name: trimmed }];
        saveFallbackRoles(next);
        return next;
      });
    }
    return true;
  }

  async function removeRole(id: number) {
    if (supabase) {
      await supabase.from('roles').delete().eq('id', id);
    } else {
      setRoles((prev) => {
        const next = prev.filter((r) => r.id !== id);
        saveFallbackRoles(next);
        return next;
      });
    }
  }

  return <RolesContext.Provider value={{ roles, addRole, removeRole }}>{children}</RolesContext.Provider>;
}

export function useRoles() {
  const ctx = useContext(RolesContext);
  if (!ctx) throw new Error('useRoles must be used within RolesProvider');
  return ctx;
}
