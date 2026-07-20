import { IconAlert } from './Icons';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase/client';

const SETTING_KEY = 'job_operations_overlap_enforcement';

interface WarningRow {
  id: number;
  recordId: string | null;
  machine?: string;
  otherOrder?: string;
  createdAt: string;
}

interface OverlapEnforcementCardProps {
  language: 'hr' | 'en';
  /** Live client-side conflict count (from detectOperationOverlaps) — the preflight gate. */
  conflictCount: number;
}

/**
 * Admin → System card that finishes the Phase D loop: it reads the live `app_settings`
 * `job_operations_overlap_enforcement` flag, shows the current unresolved-conflict count as a
 * preflight (Enforce stays disabled until the count is 0, with an explicit override for the brave),
 * writes the flag back, and lists recent warn-mode entries from `audit_logs`.
 *
 * NOTE (live DB): reading `audit_logs` requires a base `select` grant to `authenticated` (RLS then
 * restricts rows to admin/boss). If that grant hasn't been applied — migration
 * `0009_grant_audit_logs_select.sql` — the warning list degrades to an explanatory message instead of
 * breaking. The enforcement flag itself uses the existing `app_settings` admin-write policy.
 */
export function OverlapEnforcementCard({ language, conflictCount }: OverlapEnforcementCardProps) {
  const hr = language === 'hr';
  const [mode, setMode] = useState<'warn' | 'enforce' | 'unknown'>(supabase ? 'unknown' : 'warn');
  const [override, setOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<WarningRow[]>([]);
  const [warningsError, setWarningsError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadMode = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
    if (error) { setMode('unknown'); return; }
    const value = typeof data?.value === 'string' ? data.value : 'warn';
    setMode(value === 'enforce' ? 'enforce' : 'warn');
  }, []);

  const loadWarnings = useCallback(async () => {
    if (!supabase) { setWarnings([]); return; }
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, record_id, after_state, created_at')
      .eq('action', 'operation_overlap_warning')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      setWarningsError(hr
        ? 'Popis upozorenja nije dostupan — nedostaje SELECT dozvola na audit_logs (primijenite migraciju 0009).'
        : 'Warning list unavailable — audit_logs SELECT grant is missing (apply migration 0009).');
      return;
    }
    setWarningsError(null);
    setWarnings((data ?? []).map((row) => {
      const after = (row.after_state ?? {}) as Record<string, unknown>;
      return { id: row.id as number, recordId: (row.record_id as string) ?? null, machine: after.machine as string | undefined, otherOrder: after.other_order as string | undefined, createdAt: row.created_at as string };
    }));
  }, [hr]);

  useEffect(() => { void loadMode(); void loadWarnings(); }, [loadMode, loadWarnings]);

  async function writeMode(next: 'warn' | 'enforce') {
    if (!supabase) { setMessage(hr ? 'Dostupno samo uz živu bazu.' : 'Only available with a live database.'); return; }
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.from('app_settings').update({ value: next }).eq('key', SETTING_KEY);
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    setMode(next);
    setMessage(hr ? `Način postavljen na "${next}".` : `Mode set to "${next}".`);
  }

  const enforceBlocked = conflictCount > 0 && !override;

  return (
    <div className="step-box admin-card">
      <div className="step-title oec-title">
        <IconAlert className="panel-title-icon" /> {hr ? 'Provođenje preklapanja operacija' : 'Operation overlap enforcement'}
      </div>
      <p className="subtitle-text text-sm oec-lead">
        {hr
          ? 'Phase D bilježi preklapanja operacija na istom stroju. U načinu "warn" upozorenja se zapisuju, ali se upis dopušta; "enforce" odbija upis (DR001).'
          : 'Phase D detects operations sharing a machine. In "warn" mode conflicts are logged but the write is allowed; "enforce" rejects the write (DR001).'}
      </p>

      <div className="oec-stat-row">
        <div>
          <div className="oec-stat-label">{hr ? 'Trenutni način' : 'Current mode'}</div>
          <strong className={`oec-stat-value${mode === 'enforce' ? ' is-danger' : ''}`}>{mode === 'unknown' ? '—' : mode}</strong>
        </div>
        <div>
          <div className="oec-stat-label">{hr ? 'Nerazriješeni konflikti' : 'Unresolved conflicts'}</div>
          <strong className={`oec-stat-value${conflictCount > 0 ? ' is-danger' : ' is-ok'}`}>{conflictCount}</strong>
        </div>
      </div>

      {conflictCount > 0 && (
        <p className="oec-error">
          {hr ? `${conflictCount} nerazriješen(ih) konflikt(a) — razriješite ih prije provođenja.` : `${conflictCount} unresolved conflict(s) — resolve them before enforcing.`}
        </p>
      )}

      <div className="oec-action-row">
        <button type="button" className="btn btn-blue" disabled={saving || mode === 'warn'} onClick={() => void writeMode('warn')}>{hr ? 'Postavi na "warn"' : 'Set "warn"'}</button>
        <button type="button" className="btn btn-red" disabled={saving || mode === 'enforce' || enforceBlocked} onClick={() => void writeMode('enforce')}>{hr ? 'Provedi ("enforce")' : 'Enforce'}</button>
        <label className="oec-inline-label">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} disabled={conflictCount === 0} />
          {hr ? 'Nadjačaj (provedi unatoč konfliktima)' : 'Override (enforce despite conflicts)'}
        </label>
      </div>
      {message && <p className="oec-hint">{message}</p>}

      <div className="oec-divider-top">
        <div className="oec-subhead">{hr ? 'Nedavna upozorenja (warn)' : 'Recent overlap warnings'}</div>
        {warningsError ? (
          <p className="subtitle-text text-sm">{warningsError}</p>
        ) : warnings.length === 0 ? (
          <p className="subtitle-text text-sm">{hr ? 'Nema zabilježenih upozorenja.' : 'No warnings logged.'}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>{hr ? 'Nalog' : 'Job'}</th><th>{hr ? 'Stroj' : 'Machine'}</th><th>{hr ? 'Drugi nalog' : 'Other order'}</th><th>{hr ? 'Vrijeme' : 'Time'}</th></tr></thead>
              <tbody>
                {warnings.map((row) => (
                  <tr key={row.id}>
                    <td>{row.recordId}</td>
                    <td>{row.machine ?? '—'}</td>
                    <td>{row.otherOrder ?? '—'}</td>
                    <td className="text-xs">{new Date(row.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
