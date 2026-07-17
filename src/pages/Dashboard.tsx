import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { useScheduling, type JobStatus } from '../scheduling/SchedulingContext';
import { hasChildren } from '../scheduling/hierarchy';
import {
  IconFlow,
  IconChart,
  IconCalendar,
  IconRefresh,
} from '../components/Icons';
import { useWorkers } from '../workers/WorkersContext';
import { useMachines } from '../machines/MachinesContext';
import { useShifts } from '../shifts/ShiftsContext';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../settings/SettingsContext';
import { calculateMachineLoads, getWeeklyCapacityHours, weekWindow, jobIntersectsWeek } from '../scheduling/capacity';
import { computeEffectiveSchedule, jobsToScheduleInput, getJobConflicts } from '../scheduling/cpm';

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
  const machineLoads = calculateMachineLoads(weekJobs, effectiveSchedule);
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

  // Routing Node Map: lets the user step through the routing of any work order that has operations
  const jobsWithOps = jobs.filter((j) => j.operations && j.operations.length > 0);
  const [routingOrderId, setRoutingOrderId] = useState<number | null>(null);
  const routingJob = jobsWithOps.find((j) => j.id === routingOrderId) ?? jobsWithOps[0];
  const routingIndex = routingJob ? jobsWithOps.findIndex((j) => j.id === routingJob.id) : -1;
  const routingOps = routingJob?.operations ?? [];
  const stepRoutingOrder = (delta: number) => {
    if (jobsWithOps.length === 0) return;
    const nextIndex = (routingIndex + delta + jobsWithOps.length) % jobsWithOps.length;
    setRoutingOrderId(jobsWithOps[nextIndex].id);
  };

  // Icons
  const IconCheck = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  const IconAlert = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );

  const statIcons: Record<string, React.ReactNode> = {
    total: <IconFlow style={{ width: 20, height: 20 }} />,
    avg: <IconChart style={{ width: 20, height: 20 }} />,
    planned: <IconCalendar style={{ width: 20, height: 20 }} />,
    inProgress: <IconRefresh style={{ width: 20, height: 20 }} />,
    done: <IconCheck />,
    delayed: <IconAlert />,
  };

  return (
    <div className="wizard-container">
      <div style={{ marginBottom: 25 }}>
        <h2 style={{ margin: '0 0 6px 0', fontSize: 24, fontFamily: 'var(--font-title)', fontWeight: 800 }}>{t.dashboard.title}</h2>
        <p className="subtitle-text" style={{ margin: 0 }}>{t.dashboard.subtitle}</p>
      </div>

      <section className="dashboard-command-strip glass-panel">
        <div className="dashboard-today"><span className="eyebrow">{lang === 'hr' ? 'Današnji fokus' : 'Today’s focus'}</span><strong>{todayLabel}</strong><small>{exceptionCount ? (lang === 'hr' ? `${delayedCount} kašnjenja · ${materialRisks} rizika materijala · ${hasMachineOverlap ? 1 : 0} konflikt · ${overloadedMachineCount} iznad kapaciteta` : `${delayedCount} delayed · ${materialRisks} material risks · ${hasMachineOverlap ? 1 : 0} conflict · ${overloadedMachineCount} over capacity`) : (lang === 'hr' ? 'Plan je stabilan i bez aktivnih iznimki' : 'Plan is stable with no active exceptions')}</small></div>
        <div className="dashboard-quick-actions">
          <button onClick={() => navigate('/workOrders')}><IconFlow /><span><strong>{lang === 'hr' ? 'Novi nalog' : 'New order'}</strong><small>{lang === 'hr' ? 'Izradi i ispiši' : 'Create and print'}</small></span></button>
          <button onClick={() => navigate('/shifts')}><IconCalendar /><span><strong>{lang === 'hr' ? 'Plan smjena' : 'Shift plan'}</strong><small>{lang === 'hr' ? 'Rasporedi tim' : 'Schedule the team'}</small></span></button>
          <button onClick={() => navigate('/gantt')}><IconChart /><span><strong>Gantt</strong><small>{lang === 'hr' ? 'Optimiziraj plan' : 'Optimize the plan'}</small></span></button>
        </div>
      </section>

      {/* Stats Summary Grid */}
      <div className="stat-grid" style={{ marginBottom: 30 }}>
        <div className="stat-tile" style={{ '--accent': '#2563eb' } as React.CSSProperties}>
          <div>
            <div className="stat-value">{total}</div>
            <div className="stat-label">{t.dashboard.totalJobs}</div>
          </div>
          <div style={{ color: '#2563eb', opacity: 0.85, alignSelf: 'flex-end', marginTop: 10 }}>{statIcons.total}</div>
        </div>

        <div className="stat-tile" style={{ '--accent': '#10b981' } as React.CSSProperties}>
          <div>
            <div className="stat-value">{avgProgress}%</div>
            <div className="stat-label">{t.dashboard.avgProgress}</div>
          </div>
          <div style={{ color: '#10b981', opacity: 0.85, alignSelf: 'flex-end', marginTop: 10 }}>{statIcons.avg}</div>
        </div>

        {(['planned', 'inProgress', 'done', 'delayed'] as JobStatus[]).map((s) => (
          <div className="stat-tile" key={s} style={{ '--accent': STATUS_COLORS[s] } as React.CSSProperties}>
            <div>
              <div className="stat-value">{counts[s]}</div>
              <div className="stat-label">{t.progress.statusOptions[s]}</div>
            </div>
            <div style={{ color: STATUS_COLORS[s], opacity: 0.85, alignSelf: 'flex-end', marginTop: 10 }}>{statIcons[s]}</div>
          </div>
        ))}
      </div>

      {/* Split visual columns: Capacity Heatmap & Routing Node Map */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(400px, 100%), 1fr))', gap: 20, marginBottom: 25 }}>

        {/* Capacity Heatmap */}
        <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: 24, borderRadius: 'var(--radius-card)', margin: 0 }}>
          <div className="step-title" style={{ fontSize: 16, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>📊 {lang === 'hr' ? 'Kapacitet Strojeva (Tjedni opterećenje)' : 'Machine Capacities (Weekly Load)'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500 }}>
              <button type="button" className="routing-order-nav" onClick={() => setCapacityWeekOffset((o) => o - 1)} aria-label={lang === 'hr' ? 'Prethodni tjedan' : 'Previous week'}>‹</button>
              <span style={{ minWidth: 92, textAlign: 'center' }}>{capacityWeekOffset === 0 ? (lang === 'hr' ? 'Ovaj tjedan' : 'This week') : `${lang === 'hr' ? 'Tjedan' : 'Week'} ${capacityWeekLabel}`}</span>
              <button type="button" className="routing-order-nav" onClick={() => setCapacityWeekOffset((o) => o + 1)} aria-label={lang === 'hr' ? 'Sljedeći tjedan' : 'Next week'}>›</button>
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            {machinesList.length === 0 && (
              <small style={{ color: 'var(--text-secondary)' }}>
                {lang === 'hr' ? 'Nema registriranih strojeva — dodajte ih u Administraciji.' : 'No machines registered yet — add them in Administration.'}
              </small>
            )}
            {machinesList.map((m) => {
              const hours = Math.round((machineLoads.get(m) || 0) * 10) / 10;
              const loadPercent = Math.min(100, Math.round((hours / weeklyCapacityHours) * 100));
              const color = loadPercent > 90 ? 'var(--danger-color)' : loadPercent > 60 ? '#f59e0b' : 'var(--success-color)';

              return (
                <div key={m}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{m}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{hours}h / {weeklyCapacityHours}h ({loadPercent}%)</span>
                  </div>
                  <div className="progress-bar-track" style={{ height: 10 }}>
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${loadPercent}%`,
                        background: color,
                        boxShadow: `0 0 6px ${color}55`,
                        borderRadius: 5,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Routing Node Map */}
        <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: 24, borderRadius: 'var(--radius-card)', margin: 0 }}>
          <div className="step-title" style={{ fontSize: 16, marginBottom: 20, color: 'var(--text-primary)' }}>
            ⛓️ {lang === 'hr' ? 'Dijagram Toga Procesa' : 'Routing Process Map'}
          </div>
          {routingJob && (
            <div className="routing-order-switcher">
              <button type="button" className="routing-order-nav" onClick={() => stepRoutingOrder(-1)} disabled={jobsWithOps.length < 2} aria-label={lang === 'hr' ? 'Prethodni nalog' : 'Previous order'}>‹</button>
              <select value={routingJob.id} onChange={(event) => setRoutingOrderId(Number(event.target.value))} aria-label={lang === 'hr' ? 'Odaberi nalog' : 'Select order'}>
                {jobsWithOps.map((job) => <option key={job.id} value={job.id}>{job.order}</option>)}
              </select>
              <button type="button" className="routing-order-nav" onClick={() => stepRoutingOrder(1)} disabled={jobsWithOps.length < 2} aria-label={lang === 'hr' ? 'Sljedeći nalog' : 'Next order'}>›</button>
              <small>{routingIndex + 1} / {jobsWithOps.length}</small>
            </div>
          )}
          {!routingJob && (
            <div style={{ padding: '10px 0' }}>
              <small style={{ color: 'var(--text-secondary)' }}>
                {lang === 'hr' ? 'Još nema naloga s definiranom rutom — kreirajte radni nalog s operacijama.' : 'No work orders with a routing yet — create a work order with operations.'}
              </small>
            </div>
          )}
          {routingJob && <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
            <svg width="100%" height="90" viewBox="0 0 450 90" style={{ maxWidth: 450 }}>
              {routingOps.map((op, i) => {
                const x = 50 + i * 110;
                const y = 40;
                const isLast = i === routingOps.length - 1;
                const statusColor = routingJob?.status === 'done' ? 'var(--success-color)' : i === 1 ? '#3b82f6' : '#cbd5e1';

                return (
                  <g key={op.id}>
                    {/* Connection line */}
                    {!isLast && (
                      <line
                        x1={x + 15}
                        y1={y}
                        x2={x + 95}
                        y2={y}
                        stroke={statusColor}
                        strokeWidth="3"
                        strokeDasharray={i === 1 ? '4,4' : 'none'}
                        style={i === 1 ? { animation: 'dash 1s linear infinite' } : {}}
                      />
                    )}
                    {/* Node circle */}
                    <circle
                      cx={x}
                      cy={y}
                      r="14"
                      fill="var(--bg-card)"
                      stroke={statusColor}
                      strokeWidth="3"
                      style={i === 1 && routingJob?.status !== 'done' ? { animation: 'pulse-glow 1.5s infinite' } : {}}
                    />
                    <text x={x} y={y + 4} fontSize="9" fontWeight="bold" textAnchor="middle" fill="var(--text-primary)">
                      {i + 1}
                    </text>
                    {/* Label */}
                    <text x={x} y={y + 30} fontSize="9" fontWeight="700" textAnchor="middle" fill="var(--text-primary)">
                      {op.name}
                    </text>
                    <text x={x} y={y + 42} fontSize="8" textAnchor="middle" fill="var(--text-secondary)">
                      {op.machine}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>}
        </div>

      </div>

      <div className="step-box allocation-panel">
        <div className="section-title-row"><div className="step-title">{lang === 'hr' ? 'Ravnoteža operatera i smjena' : 'Operator and shift balance'}</div><span>{lang === 'hr' ? `Prosjek ${averageWorkerHours.toFixed(1)} h` : `Average ${averageWorkerHours.toFixed(1)}h`}</span></div>
        {workerLoads.length === 0 && (
          <small style={{ color: 'var(--text-secondary)' }}>
            {lang === 'hr' ? 'Nema registriranih radnika — dodajte ih u Administraciji.' : 'No workers registered yet — add them in Administration.'}
          </small>
        )}
        <div className="allocation-grid">{workerLoads.map(({ worker, hours, jobs: jobCount }) => {
          const variance = averageWorkerHours ? (hours - averageWorkerHours) / averageWorkerHours * 100 : 0;
          const warning = Math.abs(variance) > 25;
          return <article key={worker.id} className={`allocation-card${warning ? ' allocation-warning' : ''}`}><div className="worker-avatar">{worker.firstName[0]}{worker.lastName[0]}</div><div><strong>{displayName(worker)}</strong><small>{worker.roleName} · {jobCount} {lang === 'hr' ? 'naloga' : 'jobs'}</small></div><div className="allocation-value"><strong>{hours.toFixed(0)}h</strong><small>{variance > 0 ? '+' : ''}{variance.toFixed(0)}%</small></div><span className={`presence-dot presence-${worker.status}`} /></article>;
        })}</div>
      </div>

      {/* Recent Jobs Table */}
      <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: 24, borderRadius: 'var(--radius-card)' }}>
        <div className="step-title" style={{ fontSize: 16, marginBottom: 20, color: 'var(--text-primary)' }}>
          {t.dashboard.recentJobs}
        </div>
        {recent.length === 0 ? (
          <p className="subtitle-text" style={{ margin: 0 }}>{t.dashboard.noJobs}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
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
                  <td style={{ fontWeight: 600 }}>{job.order || '-'}</td>
                  <td>{job.machine || '-'}</td>
                  <td>
                    <span className={`status-pill status-${job.status}`}>
                      {t.progress.statusOptions[job.status]}
                    </span>
                  </td>
                  <td style={{ minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="progress-bar-track" style={{ flex: 1 }}>
                        <div className="progress-bar-fill" style={{ width: `${job.progress}%`, background: job.status === 'done' ? 'var(--success-color)' : 'var(--primary-color)' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, width: 35, textAlign: 'right' }}>{job.progress}%</span>
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
