import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { useScheduling, type JobStatus } from '../scheduling/SchedulingContext';
import { hasChildren } from '../scheduling/hierarchy';
import {
  IconFlow,
  IconChart,
  IconCalendar,
  IconRefresh,
  IconCheck,
  IconAlertOutline,
} from '../components/Icons';
import { useWorkers } from '../workers/WorkersContext';
import { useMachines } from '../machines/MachinesContext';
import { useShifts } from '../shifts/ShiftsContext';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../settings/SettingsContext';
import { calculateMachineLoads, getWeeklyCapacityHours, weekWindow, jobIntersectsWeek } from '../scheduling/capacity';
import { computeEffectiveSchedule, jobsToScheduleInput, getJobConflicts } from '../scheduling/cpm';
import { requestFocus } from '../navigation/focusTarget';
import { EmptyState, PageHeader, StatTile } from '../components/Page';
import { routingStates } from '../scheduling/routingProgress';

const STATUS_COLORS: Record<JobStatus, string> = {
  planned: 'var(--primary-color)',
  inProgress: 'var(--primary-color)',
  done: 'var(--success-color)',
  delayed: 'var(--danger-color)',
};

export default function Dashboard() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { jobs: allJobs } = useScheduling();
  const { activeWorkers, displayName } = useWorkers();
  const { machines } = useMachines();
  const { schedules, definitions } = useShifts();
  const jobs = allJobs.filter((j) => !hasChildren(allJobs, j.id));

  const total = jobs.length;
  const avgProgress = total === 0 ? 0 : Math.round(jobs.reduce((s, j) => s + j.progress, 0) / total);
  const counts: Record<JobStatus, number> = { planned: 0, inProgress: 0, done: 0, delayed: 0 };
  jobs.forEach((j) => {
    counts[j.status]++;
  });

  const recent = [...jobs].sort((a, b) => b.id - a.id).slice(0, 6);
  const materialRisks = settings.materialAlertsEnabled ? jobs.filter((job) => job.materialStatus === 'waiting' || job.materialStatus === 'delayed').length : 0;
  const delayedCount = jobs.filter((job) => job.status === 'delayed' || (job.status !== 'done' && job.end && new Date(job.end).getTime() < Date.now() - settings.delayAlertMinutes * 60_000)).length;
  // Same conflict engine as the Gantt/board (cpm.getJobConflicts) so the dashboard exception count
  // agrees with what planners see, including routed orders and per-operation machine windows.
  const hasMachineOverlap = settings.scheduleConflictAlertsEnabled && jobs.some((job) => Boolean(getJobConflicts(job, allJobs).machineOverlap));
  const todayLabel = new Intl.DateTimeFormat(lang === 'hr' ? 'hr-HR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  // Capacity heatmap is scoped to a single week (default: current), so it reflects load for the
  // week being viewed instead of summing every job ever assigned — including completed history.
  const [capacityWeekOffset, setCapacityWeekOffset] = useState(0);
  const capacityWindow = weekWindow(new Date(), capacityWeekOffset);
  const weekJobs = jobs.filter((job) => jobIntersectsWeek(job, capacityWindow));

  const effectiveSchedule = computeEffectiveSchedule(jobsToScheduleInput(weekJobs), { workdayStart: settings.workdayStart, workdayEnd: settings.workdayEnd, holidays: settings.holidays, skipWeekends: true });
  const machineLoads = calculateMachineLoads(weekJobs, effectiveSchedule, machines);
  const weeklyCapacityHours = getWeeklyCapacityHours();
  const capacityWeekLabel = new Intl.DateTimeFormat(lang === 'hr' ? 'hr-HR' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(capacityWindow.start));
  const overloadedMachineCount = [...machineLoads.values()].filter((hours) => hours / weeklyCapacityHours * 100 >= settings.capacityAlertPercent).length;
  const exceptionCount = delayedCount + materialRisks + Number(hasMachineOverlap) + overloadedMachineCount;

  const uniqueMachines = [...machineLoads.keys()];
  // Fall back to the registered machine list (idle machines still deserve a 0h row);
  // never invent machine names — a fresh database genuinely has none.
  const machinesList = uniqueMachines.length > 0 ? uniqueMachines : machines.map((machine) => machine.name);

  const definitionHours = new Map(definitions.map((definition) => {
    const [startHour, startMinute] = definition.startTime.split(':').map(Number);
    const [endHour, endMinute] = definition.endTime.split(':').map(Number);
    let hours = endHour + endMinute / 60 - (startHour + startMinute / 60);
    if (hours <= 0) hours += 24;
    return [definition.id, hours];
  }));
  const workerLoads = activeWorkers.map((worker) => ({
    worker,
    hours: schedules.flatMap((schedule) => schedule.assignments).filter((assignment) => assignment.workerId === worker.id).reduce((sum, assignment) => sum + (definitionHours.get(assignment.shiftDefinitionId) ?? 0), 0),
    jobs: jobs.filter((job) => job.operatorId === worker.id || job.operator === displayName(worker)).length,
  }));
  const averageWorkerHours = workerLoads.length ? workerLoads.reduce((sum, item) => sum + item.hours, 0) / workerLoads.length : 0;

  // Routing Node Map: shows the routing of as many work orders (with operations) as comfortably
  // fit, stacked as compact rows, most recent first — scrolling covers the rest instead of paging.
  const jobsWithOps = [...jobs].filter((j) => j.operations && j.operations.length > 0).sort((a, b) => b.id - a.id);


  const statIcons: Record<string, React.ReactNode> = {
    total: <IconFlow className="stat-tile-icon" />,
    avg: <IconChart className="stat-tile-icon" />,
    planned: <IconCalendar className="stat-tile-icon" />,
    inProgress: <IconRefresh className="stat-tile-icon" />,
    done: <IconCheck />,
    delayed: <IconAlertOutline />,
  };

  return (
    <div className="wizard-container">
      <PageHeader title={t.dashboard.title} subtitle={t.dashboard.subtitle} />

      <section className="dashboard-command-strip glass-panel">
        <div className="dashboard-today"><span className="eyebrow">{lang === 'hr' ? 'Današnji fokus' : 'Today’s focus'}</span><strong>{todayLabel}</strong><small>{exceptionCount ? (lang === 'hr' ? `${delayedCount} kašnjenja · ${materialRisks} rizika materijala · ${hasMachineOverlap ? 1 : 0} konflikt · ${overloadedMachineCount} iznad kapaciteta` : `${delayedCount} delayed · ${materialRisks} material risks · ${hasMachineOverlap ? 1 : 0} conflict · ${overloadedMachineCount} over capacity`) : (lang === 'hr' ? 'Plan je stabilan i bez aktivnih iznimki' : 'Plan is stable with no active exceptions')}</small></div>
        <div className="dashboard-quick-actions">
          <button onClick={() => navigate('/workOrders')}><IconFlow /><span><strong>{lang === 'hr' ? 'Novi nalog' : 'New order'}</strong><small>{lang === 'hr' ? 'Izradi i ispiši' : 'Create and print'}</small></span></button>
          <button onClick={() => navigate('/shifts')}><IconCalendar /><span><strong>{lang === 'hr' ? 'Plan smjena' : 'Shift plan'}</strong><small>{lang === 'hr' ? 'Rasporedi tim' : 'Schedule the team'}</small></span></button>
          <button onClick={() => navigate('/gantt')}><IconChart /><span><strong>Gantt</strong><small>{lang === 'hr' ? 'Optimiziraj plan' : 'Optimize the plan'}</small></span></button>
        </div>
      </section>

      {/* Stats Summary Grid */}
      <div className="stat-grid">
        {/* Total and average progress are rarely actionable, so they read as
            quiet tiles rather than competing with the status counts. */}
        <StatTile quiet value={total} label={t.dashboard.totalJobs} icon={statIcons.total} accent="var(--primary-color)" />
        <StatTile quiet value={`${avgProgress}%`} label={t.dashboard.avgProgress} icon={statIcons.avg} accent="var(--success-color)" />
        {(['planned', 'inProgress', 'done', 'delayed'] as JobStatus[]).map((s) => (
          <StatTile key={s} value={counts[s]} label={t.progress.statusOptions[s]} icon={statIcons[s]} accent={STATUS_COLORS[s]} />
        ))}
      </div>

      {/* Split visual columns: Capacity Heatmap & Routing Node Map */}
      <div className="dashboard-panel-columns">

        {/* Capacity Heatmap */}
        <div className="dashboard-panel">
          <div className="dashboard-panel-title has-controls">
            <span><IconChart className="panel-title-icon" /> {lang === 'hr' ? 'Kapacitet Strojeva (Tjedni opterećenje)' : 'Machine Capacities (Weekly Load)'}</span>
            <span className="capacity-week-nav">
              <button type="button" className="routing-order-nav" onClick={() => setCapacityWeekOffset((o) => o - 1)} aria-label={lang === 'hr' ? 'Prethodni tjedan' : 'Previous week'}>‹</button>
              <span className="capacity-week-label">{capacityWeekOffset === 0 ? (lang === 'hr' ? 'Ovaj tjedan' : 'This week') : `${lang === 'hr' ? 'Tjedan' : 'Week'} ${capacityWeekLabel}`}</span>
              <button type="button" className="routing-order-nav" onClick={() => setCapacityWeekOffset((o) => o + 1)} aria-label={lang === 'hr' ? 'Sljedeći tjedan' : 'Next week'}>›</button>
            </span>
          </div>
          <div className="capacity-machine-list">
            {machinesList.length === 0 && (
              <small className="muted-note">
                {lang === 'hr' ? 'Nema registriranih strojeva — dodajte ih u Administraciji.' : 'No machines registered yet — add them in Administration.'}
              </small>
            )}
            {machinesList.map((m) => {
              const hours = Math.round((machineLoads.get(m) || 0) * 10) / 10;
              const loadPercent = Math.min(100, Math.round((hours / weeklyCapacityHours) * 100));
              const color = loadPercent > 90 ? 'var(--danger-color)' : loadPercent > 60 ? '#f59e0b' : 'var(--success-color)';

              return (
                <div key={m}>
                  <div className="capacity-machine-row">
                    <button type="button" className="dashboard-machine-link" onClick={() => requestFocus({ tab: 'machines', machineName: m })} title={lang === 'hr' ? 'Prikaži na rasporedu strojeva' : 'Show on machine board'}>{m}</button>
                    <span className="capacity-machine-load">{hours}h / {weeklyCapacityHours}h ({loadPercent}%)</span>
                  </div>
                  <div className="progress-bar-track">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${loadPercent}%`, '--bar-color': color } as React.CSSProperties}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Routing Node Map */}
        <div className="dashboard-panel is-column">
          <div className="dashboard-panel-title">
            <IconFlow className="panel-title-icon" /> {lang === 'hr' ? 'Dijagram Toga Procesa' : 'Routing Process Map'}
          </div>
          {jobsWithOps.length === 0 && (
            <EmptyState compact>
              {lang === 'hr' ? 'Još nema naloga s definiranom rutom — kreirajte radni nalog s operacijama.' : 'No work orders with a routing yet — create a work order with operations.'}
            </EmptyState>
          )}
          {jobsWithOps.length > 0 && (
            <div className="routing-order-list">
              {jobsWithOps.map((job) => {
                const ops = job.operations ?? [];
                const states = routingStates(job);
                const viewBoxWidth = Math.max(220, 40 + ops.length * 100);
                return (
                  <div className="routing-order-row" key={job.id}>
                    <div className="routing-order-row-label">{job.order}</div>
                    <svg width="100%" height="64" viewBox={`0 0 ${viewBoxWidth} 64`} preserveAspectRatio="xMinYMid meet">
                      {ops.map((op, i) => {
                        const x = 40 + i * 100;
                        const y = 26;
                        const isLast = i === ops.length - 1;
                        const state = states[i];
                        const isActive = state === 'active';
                        const statusColor = state === 'done'
                          ? 'var(--success-color)'
                          : isActive
                            ? 'var(--primary-color)'
                            : 'var(--accent-muted-stroke)';

                        return (
                          <g key={op.id}>
                            {/* Connection line */}
                            {!isLast && (
                              <line
                                x1={x + 13}
                                y1={y}
                                x2={x + 87}
                                y2={y}
                                stroke={statusColor}
                                strokeWidth="3"
                                strokeDasharray={isActive ? '4,4' : 'none'}
                                style={isActive ? { animation: 'dash 1s linear infinite' } : {}}
                              />
                            )}
                            {/* Node circle */}
                            <circle
                              cx={x}
                              cy={y}
                              r="12"
                              fill="var(--bg-card)"
                              stroke={statusColor}
                              strokeWidth="3"
                              style={isActive ? { animation: 'pulse-glow 1.5s infinite' } : {}}
                            />
                            <text x={x} y={y + 4} fontSize="8" fontWeight="bold" textAnchor="middle" fill="var(--text-primary)">
                              {i + 1}
                            </text>
                            {/* Label */}
                            <text x={x} y={y + 26} fontSize="8" fontWeight="700" textAnchor="middle" fill="var(--text-primary)">
                              {op.name}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      <div className="step-box allocation-panel">
        <div className="section-title-row"><div className="step-title">{lang === 'hr' ? 'Ravnoteža operatera i smjena' : 'Operator and shift balance'}</div><span>{lang === 'hr' ? `Prosjek ${averageWorkerHours.toFixed(1)} h` : `Average ${averageWorkerHours.toFixed(1)}h`}</span></div>
        {workerLoads.length === 0 && (
          <EmptyState compact>
            {lang === 'hr' ? 'Nema registriranih radnika — dodajte ih u Administraciji.' : 'No workers registered yet — add them in Administration.'}
          </EmptyState>
        )}
        <div className="allocation-grid">{workerLoads.map(({ worker, hours, jobs: jobCount }) => {
          const variance = averageWorkerHours ? (hours - averageWorkerHours) / averageWorkerHours * 100 : 0;
          const warning = Math.abs(variance) > 25;
          return <article key={worker.id} className={`allocation-card${warning ? ' allocation-warning' : ''}`}><div className="worker-avatar">{worker.firstName[0]}{worker.lastName[0]}</div><div><strong>{displayName(worker)}</strong><small>{worker.roleName} · {jobCount} {lang === 'hr' ? 'naloga' : 'jobs'}</small></div><div className="allocation-value"><strong>{hours.toFixed(0)}h</strong><small>{variance > 0 ? '+' : ''}{variance.toFixed(0)}%</small></div><span className={`presence-dot presence-${worker.status}`} /></article>;
        })}</div>
      </div>

      {/* Recent Jobs Table */}
      <div className="dashboard-panel">
        <div className="dashboard-panel-title">
          {t.dashboard.recentJobs}
        </div>
        {recent.length === 0 ? (
          <EmptyState compact>{t.dashboard.noJobs}</EmptyState>
        ) : (
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.machines.order}</th>
                <th>{t.machines.machine}</th>
                <th>{t.common.status}</th>
                <th>{t.common.progressLabel}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((job) => (
                <tr key={job.id}>
                  <td className="cell-strong">{job.order || '-'}</td>
                  <td>{job.machine || '-'}</td>
                  <td>
                    <span className={`status-pill status-${job.status}`}>
                      {t.progress.statusOptions[job.status]}
                    </span>
                  </td>
                  <td className="cell-progress">
                    <div className="cell-progress-row">
                      <div className="progress-bar-track is-flex">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${job.progress}%`, '--bar-color': job.status === 'done' ? 'var(--success-color)' : 'var(--primary-color)' } as React.CSSProperties}
                        />
                      </div>
                      <span className="cell-progress-value">{job.progress}%</span>
                    </div>
                  </td>
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
