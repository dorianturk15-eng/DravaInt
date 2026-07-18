import { useState } from 'react';
import type { Job } from '../../scheduling/SchedulingContext';
import type { JobConflicts } from '../../scheduling/cpm';
import { STATUS_COLORS } from '../../scheduling/boardData';
import type { TranslationShape } from '../../i18n/translations';
import { IconAlert } from '../Icons';
import {
  formatTimeRange,
  matchesSpotlight,
  isSpotlightActive,
  type MobileMachineSection,
  type SpotlightFilter,
} from './ganttMobileData';

interface GanttAgendaViewProps {
  sections: MobileMachineSection[];
  filter: SpotlightFilter;
  statusLabels: TranslationShape['progress']['statusOptions'];
  locale: string;
  lang: string;
  jobById: Map<number, Job>;
  getJobConflicts: (job: Job) => JobConflicts;
  onOpenJob: (jobId: number) => void;
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
 * Phone-first "Today + Agenda" view: machines as collapsible sections, jobs as cards ordered by
 * time — same visual language as the Machine Board's mobile card list.
 */
export function GanttAgendaView({ sections, filter, statusLabels, locale, lang, jobById, getJobConflicts, onOpenJob }: GanttAgendaViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openLinksJobId, setOpenLinksJobId] = useState<number | null>(null);
  const spotlightOn = isSpotlightActive(filter);
  const hr = lang === 'hr';

  const toggleSection = (machine: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(machine)) next.delete(machine); else next.add(machine);
      return next;
    });
  };

  return (
    <div className="gmb-agenda">
      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.machine);
        return (
          <section className="board-mobile-lane gmb-agenda-section" key={section.machine}>
            <header className="board-mobile-lane-header gmb-agenda-header" onClick={() => toggleSection(section.machine)}>
              <div>
                <strong>{section.machine}</strong>
                <small>{section.items.length} {hr ? 'naloga' : 'orders'}</small>
              </div>
              <div className="gmb-agenda-header-right">
                <span className="board-mobile-load" data-over={section.loadPercent > 100 || undefined}>{section.loadPercent}%</span>
                <i className="gmb-collapse-caret">{isCollapsed ? '›' : '⌄'}</i>
              </div>
            </header>

            {!isCollapsed && (
              section.items.length === 0 ? (
                <p className="board-mobile-empty">{hr ? 'Nema dodijeljenih naloga' : 'No assigned work orders'}</p>
              ) : (
                <div className="board-mobile-cards">
                  {section.items.map((item) => {
                    const { job } = item;
                    const conflicts = getJobConflicts(job);
                    const messages = conflictMessages(conflicts);
                    const dimmed = spotlightOn && !matchesSpotlight(item, filter);
                    const linksOpen = openLinksJobId === job.id;
                    return (
                      <article
                        key={job.id}
                        className={`board-mobile-card gmb-agenda-card${dimmed ? ' gmb-dimmed' : ''}${item.critical ? ' gmb-critical' : ''}`}
                        style={{ borderLeftColor: item.critical ? 'var(--danger-color)' : STATUS_COLORS[job.status] }}
                        onClick={() => onOpenJob(job.id)}
                      >
                        <div className="board-mobile-card-top">
                          <strong>{item.critical && <span className="gmb-critical-flag" title={hr ? 'Kritični put' : 'Critical path'}>⚡</span>}{job.order || job.machine}</strong>
                          <span className={`status-pill status-${job.status}`}>{statusLabels[job.status]}</span>
                        </div>
                        <small className="board-mobile-card-time">{formatTimeRange(item.effectiveStart, item.effectiveEnd, locale)}</small>
                        {job.operator && <small className="board-mobile-card-operator">{job.operator}</small>}
                        <div className="progress-bar-track">
                          <div className="progress-bar-fill" style={{ width: `${job.progress}%`, background: job.status === 'done' ? 'var(--success-color)' : STATUS_COLORS[job.status] }} />
                        </div>
                        {messages.length > 0 && (
                          <div className="board-mobile-card-warnings">
                            <IconAlert style={{ width: 12, height: 12 }} />
                            <span>{messages.join(' · ')}</span>
                          </div>
                        )}
                        {item.dependencyCount > 0 && (
                          <>
                            <button
                              type="button"
                              className="gmb-links-chip"
                              onClick={(event) => { event.stopPropagation(); setOpenLinksJobId(linksOpen ? null : job.id); }}
                            >
                              🔗 {item.dependencyCount}
                            </button>
                            {linksOpen && (
                              <ul className="gmb-links-list" onClick={(event) => event.stopPropagation()}>
                                {(job.dependencies ?? []).map((dependency) => {
                                  const predecessor = jobById.get(dependency.jobId);
                                  return (
                                    <li key={dependency.jobId}>
                                      {predecessor?.order || predecessor?.machine || `#${dependency.jobId}`}
                                      <em> ({dependency.type}{dependency.lagHours ? `, ${dependency.lagHours > 0 ? '+' : ''}${dependency.lagHours}h` : ''})</em>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
