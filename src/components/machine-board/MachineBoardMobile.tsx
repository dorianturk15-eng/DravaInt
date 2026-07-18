import type { Machine } from '../../machines/MachinesContext';
import type { Job } from '../../scheduling/SchedulingContext';
import type { JobConflicts } from '../../scheduling/cpm';
import type { BoardLane } from '../../scheduling/boardData';
import { STATUS_COLORS } from '../../scheduling/boardData';
import { getWeeklyCapacityHours } from '../../scheduling/capacity';
import type { TranslationShape } from '../../i18n/translations';
import { IconAlert } from '../Icons';

interface MachineBoardMobileProps {
  lanes: BoardLane[];
  machineByName: Map<string, Machine>;
  statusLabels: TranslationShape['progress']['statusOptions'];
  t: TranslationShape['machineBoard'];
  removeLabel: string;
  locale: string;
  getJobConflicts: (job: Job) => JobConflicts;
  onRemove: (id: number) => void;
}

function conflictMessages(conflicts: JobConflicts): string[] {
  return [
    conflicts.machineOverlap && `${conflicts.machineOverlap.otherOrder}`,
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

export function MachineBoardMobile({ lanes, machineByName, statusLabels, t, removeLabel, locale, getJobConflicts, onRemove }: MachineBoardMobileProps) {
  return (
    <div className="board-mobile-list">
      {lanes.map((lane) => {
        const machine = machineByName.get(lane.machine);
        const hours = lane.slots.reduce((sum, item) => sum + (item.slot.endMs - item.slot.startMs) / 3_600_000, 0);
        const loadPercent = Math.round((hours / getWeeklyCapacityHours()) * 100);
        return (
          <section className="board-mobile-lane" key={lane.machine}>
            <header className="board-mobile-lane-header">
              <div>
                <strong>{lane.machine}</strong>
                {machine && <small>{machine.type === 'mill' ? (machine.axis ? `${machine.axis}-axis mill` : 'Mill') : 'Lathe'}</small>}
              </div>
              <span className="board-mobile-load" data-over={loadPercent > 100 || undefined}>{loadPercent}%</span>
            </header>

            {lane.slots.length === 0 ? (
              <p className="board-mobile-empty">{t.emptyLane}</p>
            ) : (
              <div className="board-mobile-cards">
                {lane.slots.map(({ slot }) => {
                  const job = slot.job;
                  const conflicts = getJobConflicts(job);
                  const messages = conflictMessages(conflicts);
                  const stepLabel = slot.isOperation ? slot.name : slot.operator || job.operator;
                  return (
                    <article className="board-mobile-card" key={slot.key} style={{ borderLeftColor: STATUS_COLORS[job.status] }}>
                      <div className="board-mobile-card-top">
                        <strong>{job.order || slot.machine}</strong>
                        <span className={`status-pill status-${job.status}`}>{statusLabels[job.status]}</span>
                      </div>
                      <small className="board-mobile-card-time">{formatRange(slot.startMs, slot.endMs, locale)}</small>
                      {stepLabel && <small className="board-mobile-card-operator">{stepLabel}</small>}
                      <div className="progress-bar-track">
                        <div className="progress-bar-fill" style={{ width: `${job.progress}%`, background: job.status === 'done' ? 'var(--success-color)' : STATUS_COLORS[job.status] }} />
                      </div>
                      {messages.length > 0 && (
                        <div className="board-mobile-card-warnings">
                          <IconAlert style={{ width: 12, height: 12 }} />
                          <span>{messages.join(' · ')}</span>
                        </div>
                      )}
                      {slot.isFirstSlot && (
                        <button type="button" className="board-mobile-card-remove" onClick={() => onRemove(job.id)} aria-label={removeLabel}>
                          {removeLabel}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
