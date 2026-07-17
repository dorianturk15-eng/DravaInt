import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase/client';

export type AppTab = 'dashboard' | 'shifts' | 'machines' | 'progress' | 'gantt' | 'workOrders' | 'admin';

export interface AppSettings {
  autoLockEnabled: boolean;
  lockOnBlur: boolean;
  lockWindowStart: string;
  lockWindowEnd: string;
  defaultView: AppTab;
  roleTimeouts: Record<string, number>;
  warningSeconds: number;
  wallpaper: string;
  greeting: string;
  avatar: string;
  compactMode: boolean;
  lockPin: string;
  criticalToleranceMs: number;
  ganttRowHeight: number;
  ganttBarFill: number;
  workdayStart: number;
  workdayEnd: number;
  holidays: string[];
  delayAlertMinutes: number;
  capacityAlertPercent: number;
  materialAlertsEnabled: boolean;
  scheduleConflictAlertsEnabled: boolean;
  absenceAlertsEnabled: boolean;
  delayAlertsEnabled: boolean;
  capacityAlertsEnabled: boolean;
  kioskMode: boolean;
}

const STORAGE_KEY = 'dravaint-app-settings-v3';

export const DEFAULT_SETTINGS: AppSettings = {
  autoLockEnabled: true,
  lockOnBlur: false,
  lockWindowStart: '00:00',
  lockWindowEnd: '23:59',
  defaultView: 'dashboard',
  roleTimeouts: {
    admin: 900,
    boss: 1800,
    managers: 600,
    'level between admin and managers': 600,
    workers: 300,
  },
  warningSeconds: 100,
  wallpaper: '',
  greeting: '',
  avatar: '',
  compactMode: false,
  lockPin: '',
  criticalToleranceMs: 60_000,
  ganttRowHeight: 50,
  ganttBarFill: 70,
  workdayStart: 6,
  workdayEnd: 22,
  holidays: [],
  delayAlertMinutes: 0,
  capacityAlertPercent: 90,
  materialAlertsEnabled: true,
  scheduleConflictAlertsEnabled: true,
  absenceAlertsEnabled: true,
  delayAlertsEnabled: true,
  capacityAlertsEnabled: true,
  kioskMode: false,
};

function loadSettings(): AppSettings {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacyTimeouts = localStorage.getItem('dravaint-role-timeouts');
    return {
      ...DEFAULT_SETTINGS,
      ...(current ? JSON.parse(current) as Partial<AppSettings> : {}),
      roleTimeouts: current
        ? { ...DEFAULT_SETTINGS.roleTimeouts, ...(JSON.parse(current) as Partial<AppSettings>).roleTimeouts }
        : legacyTimeouts ? { ...DEFAULT_SETTINGS.roleTimeouts, ...JSON.parse(legacyTimeouts) } : DEFAULT_SETTINGS.roleTimeouts,
      autoLockEnabled: current ? (JSON.parse(current) as Partial<AppSettings>).autoLockEnabled ?? true : localStorage.getItem('cfg-auto-lock-enabled') !== 'false',
      defaultView: (current ? (JSON.parse(current) as Partial<AppSettings>).defaultView : localStorage.getItem('cfg-default-view')) as AppTab || 'dashboard',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setRoleTimeout: (role: string, seconds: number) => void;
  resetSettings: () => void;
  exportBackup: () => void;
  importBackup: (file: File) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('app_settings').select('value').eq('key', 'ui_settings').maybeSingle().then(({ data }) => {
      if (!data?.value || typeof data.value !== 'object') return;
      const remote = { ...(data.value as Partial<AppSettings>) };
      // The lock PIN must never travel through the shared, world-readable app_settings row. If an
      // older client persisted one there, ignore it and keep this workstation's local PIN.
      delete remote.lockPin;
      const next = { ...loadSettings(), ...remote };
      setSettings(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    });
  }, []);

  function commit(next: AppSettings) {
    setSettings(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    localStorage.setItem('dravaint-role-timeouts', JSON.stringify(next.roleTimeouts));
    localStorage.setItem('cfg-auto-lock-enabled', String(next.autoLockEnabled));
    localStorage.setItem('cfg-default-view', next.defaultView);
    if (supabase) {
      // Strip the lock PIN before syncing: app_settings('ui_settings') is a single, world-readable
      // shop-wide row, and a plaintext credential must not be stored there. The PIN stays local to
      // this terminal. Non-admin upserts are rejected by RLS — surface that instead of silently
      // dropping shop-wide settings changes.
      const { lockPin: _localOnlyPin, ...shared } = next;
      void supabase.from('app_settings').upsert({ key: 'ui_settings', value: shared }).then(({ error }) => {
        if (error) console.warn('[settings] shop-wide settings did not sync (kept locally):', error.message);
      });
    }
  }

  function updateSettings(patch: Partial<AppSettings>) {
    commit({ ...settings, ...patch });
  }

  function setRoleTimeout(role: string, seconds: number) {
    const safeSeconds = Math.max(5, Math.min(86_400, Math.round(seconds || 900)));
    commit({ ...settings, roleTimeouts: { ...settings.roleTimeouts, [role]: safeSeconds } });
  }

  function resetSettings() {
    commit(DEFAULT_SETTINGS);
  }

  function exportBackup() {
    const backup: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || key.startsWith('sb-')) continue;
      const value = localStorage.getItem(key);
      if (value !== null) backup[key] = value;
    }
    const blob = new Blob([JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), data: backup }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dravaint-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(file: File) {
    const parsed = JSON.parse(await file.text()) as { data?: Record<string, string> } | Record<string, string>;
    const data = 'data' in parsed && parsed.data ? parsed.data : parsed as Record<string, string>;
    Object.entries(data).forEach(([key, value]) => {
      if (!key.startsWith('sb-') && typeof value === 'string') localStorage.setItem(key, value);
    });
    setSettings(loadSettings());
  }

  const value: SettingsContextValue = { settings, updateSettings, setRoleTimeout, resetSettings, exportBackup, importBackup };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within SettingsProvider');
  return context;
}
