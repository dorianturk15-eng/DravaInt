import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface Role {
  id: number;
  name: string;
  is_active: boolean;
}

const FALLBACK_ROLES: Role[] = [
  { id: 1, name: 'admin', is_active: true },
  { id: 2, name: 'level between admin and managers', is_active: true },
  { id: 3, name: 'managers', is_active: true },
  { id: 4, name: 'workers', is_active: true },
  { id: 5, name: 'boss', is_active: true },
];

const FALLBACK_STORAGE_KEY = 'dravaint-roles-fallback';

function loadFallbackRoles(): Role[] {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return FALLBACK_ROLES;
    const parsed = JSON.parse(raw);
    // Re-seed if not matching the user's requested roles
    if (Array.isArray(parsed) && parsed.some((r) => ['admin', 'level between admin and managers', 'boss'].includes(r.name))) {
      return parsed;
    }
    return FALLBACK_ROLES;
  } catch {
    return FALLBACK_ROLES;
  }
}

function saveFallbackRoles(roles: Role[]) {
  localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(roles));
}

let nextFallbackId = 1000;

/** Mirrors MachineWriteResult: `db` carries the real Supabase error so the UI can show it. */
export type RoleWriteResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate' | 'invalid' | 'db'; message?: string };

interface RolesContextValue {
  roles: Role[];
  addRole: (name: string) => Promise<RoleWriteResult>;
  removeRole: (id: number) => Promise<void>;
  setRoleActive: (id: number, isActive: boolean) => Promise<void>;
}

const RolesContext = createContext<RolesContextValue | null>(null);

export function RolesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [fallbackRoles, setFallbackRoles] = useState<Role[]>(() => {
    const loaded = loadFallbackRoles();
    nextFallbackId = Math.max(nextFallbackId, ...loaded.map((r) => r.id + 1));
    return loaded;
  });
  const rolesQuery = useQuery({
    queryKey: ['roles'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const { data, error } = await supabase!.from('roles').select('*').order('id');
      if (error) throw error;
      return (data as Role[]).map((role) => ({ ...role, is_active: role.is_active ?? true }));
    },
  });
  const roles = supabase ? (rolesQuery.data ?? FALLBACK_ROLES) : fallbackRoles;

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('roles-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['roles'] });
      })
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, [queryClient]);

  async function addRole(name: string): Promise<RoleWriteResult> {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, reason: 'invalid' };
    if (roles.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) return { ok: false, reason: 'duplicate' };

    if (supabase) {
      const { error } = await supabase.from('roles').insert({ name: trimmed });
      if (error) {
        if (error.code === '23505') {
          void queryClient.invalidateQueries({ queryKey: ['roles'] });
          return { ok: false, reason: 'duplicate', message: error.message };
        }
        return { ok: false, reason: 'db', message: error.message };
      }
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    } else {
      setFallbackRoles((prev) => {
        const next = [...prev, { id: nextFallbackId++, name: trimmed, is_active: true }];
        saveFallbackRoles(next);
        return next;
      });
    }
    return { ok: true };
  }

  async function removeRole(id: number) {
    if (supabase) {
      await supabase.from('roles').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', id);
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    } else {
      setFallbackRoles((prev) => {
        const next = prev.map((role) => role.id === id ? { ...role, is_active: false } : role);
        saveFallbackRoles(next);
        return next;
      });
    }
  }

  async function setRoleActive(id: number, isActive: boolean) {
    if (supabase) {
      await supabase.from('roles').update({ is_active: isActive, deleted_at: isActive ? null : undefined }).eq('id', id);
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    } else {
      setFallbackRoles((prev) => {
        const next = prev.map((role) => (role.id === id ? { ...role, is_active: isActive } : role));
        saveFallbackRoles(next);
        return next;
      });
    }
  }

  return <RolesContext.Provider value={{ roles, addRole, removeRole, setRoleActive }}>{children}</RolesContext.Provider>;
}

export function useRoles() {
  const ctx = useContext(RolesContext);
  if (!ctx) throw new Error('useRoles must be used within RolesProvider');
  return ctx;
}
