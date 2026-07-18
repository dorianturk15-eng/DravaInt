import { useCallback, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useScheduling, type Job, type UpdateResult } from '../../scheduling/SchedulingContext';
import { useMachines } from '../../machines/MachinesContext';
import { useSettings } from '../../settings/SettingsContext';
import { cascadeDependents, jobsToScheduleInput, type JobConflicts } from '../../scheduling/cpm';
import { buildMobileGanttModel, type SpotlightChip, type SpotlightFilter } from './ganttMobileData';
import { GanttAgendaView } from './GanttAgendaView';
import { GanttCompactTimeline, type TimelineCommit } from './GanttCompactTimeline';
import './ganttMobile.css';

type MobileView = 'agenda' | 'timeline';

interface ToastState {
  message: string;
  tone: 'info' | 'warning' | 'error';
  undoSnapshot?: Job[];
}

function conflictMessages(conflicts: JobConflicts): string[] {
  return [
    conflicts.machineOverlap && conflicts.machineOverlap.otherOrder,
    conflicts.operatorOverlap && conflicts.operatorOverlap.otherOrder,
    conflicts.unqualified?.message,
    conflicts.shiftOutside?.message,
    conflicts.hoursExceeded?.message,
    conflicts.restViolation?.message,
    conflicts.absent?.message,
  ].filter(Boolean) as string[];
}

/**
 * Phone & tablet Gantt experience (GANTT_ELEVATION_PLAN.md §3, Phase 2). Reads the same
 * scheduling data layer as the desktop chart; the desktop renderer is untouched. On phones the
 * agenda card list is the default with the compact timeline one tap away; tablets open on the
 * timeline directly.
 */
export function GanttMobile({ tier }: { tier: 'phone' | 'tablet' }) {
  const { t, lang } = useLanguage();
  const { jobs, loading, updateJob, removeJob, restoreBackup, getJobConflicts } = useScheduling();
  const { machines } = useMachines();
  const { settings } = useSettings();
  const hr = lang === 'hr';
  const locale = hr ? 'hr-HR' : 'en-GB';

  const [view, setView] = useState<MobileView>(tier === 'tablet' ? 'timeline' : 'agenda');
  const [search, setSearch] = useState('');
  const [chips, setChips] = useState<Set<SpotlightChip>>(new Set());
  const [detailsJobId, setDetailsJobId] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const model = useMemo(() => buildMobileGanttModel(jobs, machines, {
    holidays: settings.holidays,
    workdayStart: settings.workdayStart,
    workdayEnd: settings.workdayEnd,
    skipWeekends: true,
    criticalToleranceMs: settings.criticalToleranceMs,
  }), [jobs, machines, settings.criticalToleranceMs, settings.holidays, settings.workdayEnd, settings.workdayStart]);

  const filter: SpotlightFilter = useMemo(() => ({ search, chips }), [search, chips]);
  const jobById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

  const showToast = useCallback((next: ToastState, timeoutMs = 6000) => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = window.setTimeout(() => setToast(null), timeoutMs);
  }, []);

  const reportWriteResult = useCallback((result: UpdateResult) => {
    if (result.ok || result.reason === 'offline') return;
    const message = result.reason === 'rejected'
      ? (result.message || (hr ? 'Baza je odbila promjenu — vraćeno na prethodno stanje.' : 'The database rejected the change — reverted.'))
      : (hr ? 'Nalog je u međuvremenu izmijenjen drugdje — učitano svježe stanje.' : 'The order was changed elsewhere — reloaded the fresh state.');
    showToast({ message, tone: 'error' });
  }, [hr, showToast]);

  /** ✓ on the confirm pill lands here: write the move, cascade dependents, offer one-tap Undo. */
  const commitTimes = useCallback(({ jobId, times }: TimelineCommit) => {
    const job = jobById.get(jobId);
    if (!job) return;
    const snapshot = structuredClone(jobs);
    void updateJob(jobId, { start: times.start, end: times.end }).then(reportWriteResult);
    const pending = cascadeDependents(jobId, times.start, times.end, jobsToScheduleInput(jobs), {
      holidays: settings.holidays,
      workdayStart: settings.workdayStart,
      workdayEnd: settings.workdayEnd,
      skipWeekends: true,
    });
    pending.forEach((patch, id) => void updateJob(id, patch).then(reportWriteResult));
    const cascadeNote = pending.size > 0 ? ` · +${pending.size} ${hr ? 'ovisnih' : 'linked'}` : '';
    showToast({
      message: `${job.order || job.machine} → ${new Date(times.startMs).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${cascadeNote}`,
      tone: 'info',
      undoSnapshot: snapshot,
    });
  }, [hr, jobById, jobs, locale, reportWriteResult, settings.holidays, settings.workdayEnd, settings.workdayStart, showToast, updateJob]);

  const undoFromToast = useCallback(() => {
    if (!toast?.undoSnapshot) return;
    void restoreBackup(toast.undoSnapshot);
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    setToast(null);
  }, [restoreBackup, toast]);

  const toggleChip = (chip: SpotlightChip) => {
    setChips((current) => {
      const next = new Set(current);
      if (next.has(chip)) next.delete(chip); else next.add(chip);
      return next;
    });
  };

  const detailsJob = detailsJobId != null ? jobById.get(detailsJobId) ?? null : null;
  const detailsConflicts = detailsJob ? conflictMessages(getJobConflicts(detailsJob)) : [];

  const updateDetails = (patch: Partial<Job>) => {
    if (detailsJobId == null) return;
    void updateJob(detailsJobId, patch).then(reportWriteResult);
  };

  const chipDefs: { chip: SpotlightChip; label: string }[] = [
    { chip: 'critical', label: hr ? 'Kritični' : 'Critical' },
    { chip: 'delayed', label: hr ? 'Kašnjenje' : 'Delayed' },
    { chip: 'material', label: hr ? 'Materijal čeka' : 'Material waiting' },
  ];

  return (
    <div className={`gmb-page gmb-tier-${tier}`}>
      <div className="gmb-topbar">
        <div className="gmb-topbar-title">
          <h2>{t.gantt.title}</h2>
          <span className="sync-badge"><span className="sync-dot" />{jobs.length} {hr ? 'naloga' : 'orders'}</span>
        </div>
        <div className="gmb-view-toggle" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'agenda'} className={view === 'agenda' ? 'active' : ''} onClick={() => setView('agenda')}>
            ☰ {hr ? 'Agenda' : 'Agenda'}
          </button>
          <button type="button" role="tab" aria-selected={view === 'timeline'} className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}>
            ▬ {hr ? 'Vremenska crta' : 'Timeline'}
          </button>
        </div>
        <div className="gmb-search">
          <span>⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={hr ? 'Traži nalog, operatera…' : 'Search order, operator…'}
          />
        </div>
        <div className="gmb-chips">
          {chipDefs.map(({ chip, label }) => (
            <button
              key={chip}
              type="button"
              className={`gmb-chip${chips.has(chip) ? ' active' : ''}`}
              onClick={() => toggleChip(chip)}
              aria-pressed={chips.has(chip)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="gantt-skeleton" aria-label="Loading"><span /><span /><span /><span /></div>
      ) : view === 'agenda' ? (
        <GanttAgendaView
          sections={model.sections}
          filter={filter}
          statusLabels={t.progress.statusOptions}
          locale={locale}
          lang={lang}
          jobById={jobById}
          getJobConflicts={getJobConflicts}
          onOpenJob={setDetailsJobId}
        />
      ) : (
        <GanttCompactTimeline
          sections={model.sections}
          originMs={model.originMs}
          horizonEndMs={model.horizonEndMs}
          filter={filter}
          lang={lang}
          locale={locale}
          workdayStart={settings.workdayStart}
          workdayEnd={settings.workdayEnd}
          tier={tier}
          getJobConflicts={getJobConflicts}
          onOpenJob={setDetailsJobId}
          onCommit={commitTimes}
        />
      )}

      {detailsJob && (
        <div className="gmb-sheet-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setDetailsJobId(null); }}>
          <div className="gmb-sheet" role="dialog" aria-modal="true" aria-label={detailsJob.order}>
            <div className="gmb-sheet-grip" />
            <div className="gmb-sheet-header">
              <div>
                <span className="eyebrow">{detailsJob.order}</span>
                <h3>{hr ? 'Detalji radnog naloga' : 'Work order details'}</h3>
              </div>
              <button type="button" className="drawer-close-btn" onClick={() => setDetailsJobId(null)}>×</button>
            </div>
            <div className="gmb-sheet-body">
              <div className="gmb-sheet-grid">
                <label>{hr ? 'Proizvod' : 'Product'}
                  <input defaultValue={detailsJob.product} onBlur={(event) => updateDetails({ product: event.target.value })} />
                </label>
                <label>{hr ? 'Operater' : 'Operator'}
                  <input defaultValue={detailsJob.operator} onBlur={(event) => updateDetails({ operator: event.target.value })} />
                </label>
                <label>{t.common.start}
                  <input type="datetime-local" defaultValue={detailsJob.start} onBlur={(event) => { if (event.target.value) updateDetails({ start: event.target.value }); }} />
                </label>
                <label>{t.common.end}
                  <input type="datetime-local" defaultValue={detailsJob.end} onBlur={(event) => { if (event.target.value) updateDetails({ end: event.target.value }); }} />
                </label>
                <label>{hr ? 'Status' : 'Status'}
                  <select value={detailsJob.status} onChange={(event) => updateDetails({ status: event.target.value as Job['status'] })}>
                    {(['planned', 'inProgress', 'done', 'delayed'] as const).map((status) => (
                      <option key={status} value={status}>{t.progress.statusOptions[status]}</option>
                    ))}
                  </select>
                </label>
                <label>{hr ? 'Materijal' : 'Material'}
                  <select value={detailsJob.materialStatus ?? 'ready'} onChange={(event) => updateDetails({ materialStatus: event.target.value as Job['materialStatus'] })}>
                    <option value="ready">{hr ? 'Spreman' : 'Ready'}</option>
                    <option value="waiting">{hr ? 'Na čekanju' : 'Waiting'}</option>
                    <option value="delayed">{hr ? 'Kasni' : 'Delayed'}</option>
                  </select>
                </label>
                <label className="gmb-sheet-full">{hr ? 'Napredak' : 'Progress'} · {detailsJob.progress}%
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    defaultValue={detailsJob.progress}
                    onChange={(event) => updateDetails({ progress: Number(event.target.value) })}
                  />
                </label>
              </div>

              {detailsJob.operations && detailsJob.operations.length > 0 && (
                <div className="gmb-sheet-operations">
                  <strong>{hr ? 'Redoslijed operacija' : 'Operation route'}</strong>
                  {detailsJob.operations.map((operation, index) => (
                    <div key={operation.id} className="gmb-sheet-operation">
                      <span>{index + 1}</span>
                      <b>{operation.name}</b>
                      <small>{operation.machine} · {operation.hours}h{operation.operator ? ` · ${operation.operator}` : ''}</small>
                    </div>
                  ))}
                </div>
              )}

              {detailsConflicts.length > 0 && (
                <div className="gmb-sheet-conflicts">
                  <strong>⚠ {hr ? 'Upozorenja' : 'Warnings'}</strong>
                  <span>{detailsConflicts.join(' · ')}</span>
                </div>
              )}

              <button
                type="button"
                className="btn btn-red gmb-sheet-remove"
                onClick={() => {
                  if (!window.confirm(hr ? `Ukloniti nalog ${detailsJob.order}?` : `Remove order ${detailsJob.order}?`)) return;
                  const snapshot = structuredClone(jobs);
                  void removeJob(detailsJob.id);
                  setDetailsJobId(null);
                  showToast({ message: `${detailsJob.order || detailsJob.machine} — ${hr ? 'uklonjeno' : 'removed'}`, tone: 'warning', undoSnapshot: snapshot });
                }}
              >
                {t.common.remove ?? (hr ? 'Ukloni' : 'Remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`board-toast gmb-toast gmb-toast-${toast.tone}`} role="status">
          <span>{toast.message}</span>
          {toast.undoSnapshot && (
            <button type="button" className="gmb-toast-undo" onClick={undoFromToast}>{hr ? 'Poništi' : 'Undo'}</button>
          )}
          <button type="button" className="gmb-toast-close" onClick={() => setToast(null)} aria-label={hr ? 'Zatvori' : 'Dismiss'}>×</button>
        </div>
      )}
    </div>
  );
}
