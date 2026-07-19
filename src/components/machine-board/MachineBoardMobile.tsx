import { useState } from 'react';
import type { Machine } from '../../machines/MachinesContext';
import type { Job, JobStatus } from '../../scheduling/SchedulingContext';
import type { JobConflicts } from '../../scheduling/cpm';
import type { BoardLane } from '../../scheduling/boardData';
import type { BoardConflict } from '../../scheduling/boardConflicts';
import { STATUS_COLORS } from '../../scheduling/boardData';
import type { TranslationShape } from '../../i18n/translations';
import { IconAlert } from '../Icons';

interface MachineBoardMobileProps {
  lanes: BoardLane[];
  machineByName: Map<string, Machine>;
  statusLabels: TranslationShape['progress']['statusOptions'];
  statusOptionLabels: TranslationShape['progress']['statusOptions'];
  t: TranslationShape['machineBoard'];
  removeLabel: string;
  locale: string;
  conflicts: BoardConflict[];
  laneLoadPercent: Map<string, number>;
  getJobConflicts: (job: Job) => JobConflicts;
  onRemove: (id: number) => void;
  onShiftLater: (conflict: BoardConflict) => void;
  onSetStatus: (id: number, status: JobStatus) => void;
}

function jobLevelMessages(conflicts: JobConflicts): string[] {
  return [
    conflicts.operatorOverlap && `${conflicts.operatorOverlap.otherOrder}`,
    conflicts.unqualified?.message,
    conflicts.shiftOutside?.message,
    conflicts.hoursExceeded?.message,
    conflicts.restViolation?.message,
  ].filter(Boolean) as string[];
}

function formatRange(startMs: number, endMs: number, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
  return `${new Date(startMs).toLocaleString(locale, opts)} → ${new Date(endMs).toLocaleString(locale, opts)}`;
}

const STATUSES: JobStatus[] = ['planned', 'inProgress', 'done', 'delayed'];

export function MachineBoardMobile({ lanes, machineByName, statusLabels, statusOptionLabels, t, removeLabel, locale, conflicts, laneLoadPercent, getJobConflicts, onRemove, onShiftLater, onSetStatus }: MachineBoardMobileProps) {
  const [bannerOpen, setBannerOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapse(machine: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(machine)) next.delete(machine);
      else next.add(machine);
      return next;
    });
  }

  return (
    <div className="board-mobile-list">
      {/* Sticky conflict banner — resolving a real conflict from a phone is the headline feature. */}
      <div className={`board-mobile-conflict-banner${conflicts.length > 0 ? ' has-conflicts' : ''}`}>
        <button type="button" className="board-mobile-conflict-banner-head" onClick={() => setBannerOpen((v) => !v)} aria-expanded={bannerOpen}>
          <span className="board-conflict-chip-dot" />
          {conflicts.length > 0 ? `${t.conflictsTitle} (${conflicts.length})` : t.noConflicts}
          {conflicts.length > 0 && <b>{bannerOpen ? '▴' : '▾'}</b>}
        </button>
        {bannerOpen && conflicts.length > 0 && (
          <ul className="board-mobile-conflict-list">
            {conflicts.map((conflict) => (
              <li key={conflict.key}>
                <span>{conflict.a.order}{conflict.a.opName ? ` · ${conflict.a.opName}` : ''} ⟷ {conflict.b.order}{conflict.b.opName ? ` · ${conflict.b.opName}` : ''} · {conflict.machineName}</span>
                <button type="button" className="btn btn-blue btn-sm" onClick={() => onShiftLater(conflict)}>{t.shiftLater}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lanes.map((lane) => {
        const machine = machineByName.get(lane.machine);
        const loadPercent = Math.round(laneLoadPercent.get(lane.machine) ?? 0);
        const isCollapsed = collapsed.has(lane.machine);
        return (
          <section className="board-mobile-lane" key={lane.machine}>
            <header className="board-mobile-lane-header" onClick={() => toggleCollapse(lane.machine)}>
              <div>
                <strong>{isCollapsed ? '▸ ' : '▾ '}{lane.machine}</strong>
                {machine && <small>{machine.type === 'mill' ? (machine.axis ? `${machine.axis}-axis mill` : 'Mill') : machine.type}</small>}
              </div>
              <span className="board-mobile-load" data-over={loadPercent > 100 || undefined}>{loadPercent}%</span>
            </header>

            {!isCollapsed && (lane.slots.length === 0 ? (
              <p className="board-mobile-empty">{t.emptyLane}</p>
            ) : (
              <div className="board-mobile-cards">
                {lane.slots.map(({ slot }) => {
                  const job = slot.job;
                  const messages = slot.isFirstSlot ? jobLevelMessages(getJobConflicts(job)) : [];
                  const hasOverlap = conflicts.some((c) => c.a.slotKey === slot.key || c.b.slotKey === slot.key);
                  const stepLabel = slot.isOperation ? slot.name : slot.operator || job.operator;
                  const sheetOpen = sheetKey === slot.key;
                  return (
                    <article className="board-mobile-card" key={slot.key} style={{ borderLeftColor: STATUS_COLORS[job.status] }}>
                      <button type="button" className="board-mobile-card-tap" onClick={() => setSheetKey(sheetOpen ? null : slot.key)}>
                        <div className="board-mobile-card-top">
                          <strong>{job.order || slot.machine}</strong>
                          <span className={`status-pill status-${job.status}`}>{statusLabels[job.status]}</span>
                        </div>
                        <small className="board-mobile-card-time">{formatRange(slot.startMs, slot.endMs, locale)}</small>
                        {stepLabel && <small className="board-mobile-card-operator">{stepLabel}</small>}
                        <div className="progress-bar-track">
                          <div className="progress-bar-fill" style={{ width: `${job.progress}%`, background: job.status === 'done' ? 'var(--success-color)' : STATUS_COLORS[job.status] }} />
                        </div>
                        {(hasOverlap || messages.length > 0) && (
                          <div className="board-mobile-card-warnings">
                            <IconAlert style={{ width: 12, height: 12 }} />
                            <span>{[hasOverlap ? t.legendConflict : null, ...messages].filter(Boolean).join(' · ')}</span>
                          </div>
                        )}
                      </button>
                      {sheetOpen && (
                        <div className="board-mobile-card-sheet">
                          <select value={job.status} onChange={(e) => onSetStatus(job.id, e.target.value as JobStatus)} aria-label={job.order}>
                            {STATUSES.map((status) => <option key={status} value={status}>{statusOptionLabels[status]}</option>)}
                          </select>
                          {slot.isFirstSlot && (
                            <button type="button" className="board-mobile-card-remove" onClick={() => onRemove(job.id)} aria-label={removeLabel}>
                              {removeLabel}
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
