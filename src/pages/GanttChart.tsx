import { Fragment, useMemo, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus, IconTrash } from '../components/Icons';
import { useScheduling, type JobStatus, type DependencyType } from '../scheduling/SchedulingContext';
import { computeEffectiveSchedule, computeCriticalPath, jobsToScheduleInput } from '../scheduling/cpm';

const STATUS_COLORS: Record<JobStatus, string> = {
  planned: '#64748b',
  inProgress: '#2b6cb0',
  done: '#16a34a',
  delayed: '#dc2626',
};

const DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

function dateOnly(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function diffDays(a: Date, b: Date) {
  return Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86400000);
}

export default function GanttChart() {
  const { t } = useLanguage();
  const { jobs, addJob, updateJob, removeJob } = useScheduling();

  const [form, setForm] = useState({ name: '', start: '', end: '' });
  const [depForm, setDepForm] = useState({ jobId: '', predecessorId: '', type: 'FS' as DependencyType, lagHours: '0' });
  const [depError, setDepError] = useState('');

  const validJobs = jobs.filter((j) => j.start && j.end);

  const scheduleInput = useMemo(() => jobsToScheduleInput(validJobs), [validJobs]);
  const effective = useMemo(() => computeEffectiveSchedule(scheduleInput), [scheduleInput]);
  const criticalIds = useMemo(() => computeCriticalPath(scheduleInput, effective), [scheduleInput, effective]);
  const hasAnyDependency = validJobs.some((j) => (j.dependencies?.length ?? 0) > 0);

  const { rangeStart, totalDays } = useMemo(() => {
    if (validJobs.length === 0) {
      const today = dateOnly(new Date());
      return { rangeStart: today, totalDays: 14 };
    }
    const starts = validJobs.map((j) => dateOnly(new Date(effective.get(j.id)?.start ?? new Date(j.start).getTime())));
    const ends = validJobs.map((j) => dateOnly(new Date(effective.get(j.id)?.end ?? new Date(j.end).getTime())));
    const min = new Date(Math.min(...starts.map((d) => d.getTime())));
    const max = new Date(Math.max(...ends.map((d) => d.getTime())));
    const days = Math.max(diffDays(min, max) + 1, 7);
    return { rangeStart: min, totalDays: days };
  }, [validJobs, effective]);

  const today = dateOnly(new Date());
  const todayOffset = diffDays(rangeStart, today);

  function handleAdd() {
    if (!form.name || !form.start || !form.end) return;
    addJob({
      machine: '',
      order: form.name,
      operator: '',
      start: `${form.start}T00:00`,
      end: `${form.end}T00:00`,
    });
    setForm({ name: '', start: '', end: '' });
  }

  function addDependency() {
    setDepError('');
    const jobId = Number(depForm.jobId);
    const predecessorId = Number(depForm.predecessorId);
    const lagHours = parseFloat(depForm.lagHours) || 0;
    if (!jobId || !predecessorId || jobId === predecessorId) {
      setDepError(t.gantt.dependencyError);
      return;
    }
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (job.dependencies?.some((d) => d.jobId === predecessorId)) return;
    updateJob(jobId, {
      dependencies: [...(job.dependencies ?? []), { jobId: predecessorId, type: depForm.type, lagHours }],
    });
    setDepForm({ jobId: '', predecessorId: '', type: 'FS', lagHours: '0' });
  }

  function removeDependency(jobId: number, predecessorId: number) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    updateJob(jobId, { dependencies: (job.dependencies ?? []).filter((d) => d.jobId !== predecessorId) });
  }

  const dayWidth = 28;
  const rowHeight = 34;
  const typeLabel: Record<DependencyType, string> = {
    FS: t.gantt.typeFS,
    SS: t.gantt.typeSS,
    FF: t.gantt.typeFF,
    SF: t.gantt.typeSF,
  };

  const rowIndex = new Map(validJobs.map((j, i) => [j.id, i]));

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.gantt.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 8px 0', fontSize: 13 }}>{t.gantt.subtitle}</p>
      <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 12 }}>{t.gantt.sharedNote}</p>

      <div className="step-box">
        <div className="step-title">
          <span className="step-number">1</span>
          {t.progress.addTask}
        </div>
        <div className="grid-inputs workers-ruster">
          <div>
            <label>{t.progress.task}</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>{t.common.start}</label>
            <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          </div>
          <div>
            <label>{t.common.end}</label>
            <input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="action-bar">
        <button className="btn btn-green" onClick={handleAdd}>
          <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
          {t.common.add}
        </button>
      </div>

      <div className="step-box" style={{ marginTop: 20 }}>
        <div className="step-title">
          <span className="step-number">2</span>
          {t.gantt.dependencies}
        </div>
        <div className="grid-inputs workers-ruster">
          <div>
            <label>{t.progress.task}</label>
            <select value={depForm.jobId} onChange={(e) => setDepForm({ ...depForm, jobId: e.target.value })}>
              <option value="">{t.gantt.selectPredecessor}</option>
              {validJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.order || j.machine}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{t.gantt.predecessor}</label>
            <select
              value={depForm.predecessorId}
              onChange={(e) => setDepForm({ ...depForm, predecessorId: e.target.value })}
            >
              <option value="">{t.gantt.selectPredecessor}</option>
              {validJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.order || j.machine}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{t.gantt.dependencyType}</label>
            <select
              value={depForm.type}
              onChange={(e) => setDepForm({ ...depForm, type: e.target.value as DependencyType })}
            >
              {DEPENDENCY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeLabel[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{t.gantt.lagHours}</label>
            <input
              type="number"
              step="0.5"
              value={depForm.lagHours}
              onChange={(e) => setDepForm({ ...depForm, lagHours: e.target.value })}
            />
          </div>
        </div>
        <div className="action-bar" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-blue" onClick={addDependency}>
            <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.gantt.addDependency}
          </button>
        </div>
        {depError && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{depError}</p>}

        <div style={{ marginTop: 15 }}>
          {!hasAnyDependency ? (
            <p className="subtitle-text" style={{ fontSize: 13 }}>{t.gantt.noDependencies}</p>
          ) : (
            validJobs
              .filter((j) => (j.dependencies?.length ?? 0) > 0)
              .map((j) => (
                <div key={j.id} style={{ marginBottom: 8, fontSize: 12 }}>
                  <strong>{j.order || j.machine}</strong>:{' '}
                  {j.dependencies!.map((dep) => {
                    const predJob = jobs.find((p) => p.id === dep.jobId);
                    return (
                      <span key={dep.jobId} className="role-chip" style={{ marginRight: 6 }}>
                        {predJob?.order || predJob?.machine || dep.jobId} ({typeLabel[dep.type]}
                        {dep.lagHours ? `, +${dep.lagHours}h` : ''})
                        <button onClick={() => removeDependency(j.id, dep.jobId)}>✕</button>
                      </span>
                    );
                  })}
                </div>
              ))
          )}
        </div>
      </div>

      {hasAnyDependency && (
        <p className="subtitle-text" style={{ fontSize: 12, marginTop: 15 }}>
          {t.gantt.criticalPathLegend}
        </p>
      )}

      <div className="gantt-wrapper" style={{ marginTop: 10 }}>
        <div
          className="gantt-grid"
          style={{ gridTemplateColumns: `200px repeat(${totalDays}, ${dayWidth}px)`, position: 'relative' }}
        >
          <div className="gantt-header-cell" style={{ textAlign: 'left', paddingLeft: 10 }}>
            {t.progress.task}
          </div>
          {Array.from({ length: totalDays }).map((_, i) => {
            const day = addDays(rangeStart, i);
            return (
              <div className="gantt-header-cell" key={i}>
                {day.getDate()}/{day.getMonth() + 1}
              </div>
            );
          })}

          {validJobs.map((job) => {
            const eff = effective.get(job.id);
            const jobStart = eff ? new Date(eff.start) : new Date(job.start);
            const jobEnd = eff ? new Date(eff.end) : new Date(job.end);
            const startOffset = diffDays(rangeStart, dateOnly(jobStart));
            const length = diffDays(jobStart, jobEnd) + 1;
            const label = job.order || job.machine;
            const isCritical = criticalIds.has(job.id);
            return (
              <Fragment key={job.id}>
                <div className="gantt-row-label">
                  {label}
                  <button
                    className="btn btn-red"
                    style={{ padding: '3px 8px', width: 'auto', marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}
                    onClick={() => removeJob(job.id)}
                  >
                    <IconTrash style={{ width: 12, height: 12 }} />
                  </button>
                </div>
                <div
                  className="gantt-row-track"
                  style={{ gridColumn: `2 / span ${totalDays}`, position: 'relative' }}
                >
                  <div
                    className="gantt-bar"
                    style={{
                      left: startOffset * dayWidth,
                      width: Math.max(length, 1) * dayWidth - 4,
                      background: `${STATUS_COLORS[job.status]}55`,
                      border: isCritical ? '2px solid #dc2626' : `1px solid ${STATUS_COLORS[job.status]}`,
                    }}
                  >
                    <div
                      className="gantt-bar-fill"
                      style={{ width: `${job.progress}%`, background: STATUS_COLORS[job.status] }}
                    />
                    <span className="gantt-bar-label">{label}</span>
                  </div>
                  {todayOffset >= 0 && todayOffset < totalDays && (
                    <div className="gantt-today-line" style={{ left: todayOffset * dayWidth }} title={t.gantt.today} />
                  )}
                </div>
              </Fragment>
            );
          })}

          <svg
            style={{
              position: 'absolute',
              top: rowHeight,
              left: 200,
              width: totalDays * dayWidth,
              height: validJobs.length * rowHeight,
              pointerEvents: 'none',
            }}
          >
            {validJobs.flatMap((job) =>
              (job.dependencies ?? []).map((dep) => {
                const predRow = rowIndex.get(dep.jobId);
                const succRow = rowIndex.get(job.id);
                const predEff = effective.get(dep.jobId);
                const succEff = effective.get(job.id);
                if (predRow === undefined || succRow === undefined || !predEff || !succEff) return null;
                const predEndOffset = diffDays(rangeStart, dateOnly(new Date(predEff.end)));
                const succStartOffset = diffDays(rangeStart, dateOnly(new Date(succEff.start)));
                const x1 = predEndOffset * dayWidth;
                const y1 = predRow * rowHeight + rowHeight / 2;
                const x2 = succStartOffset * dayWidth;
                const y2 = succRow * rowHeight + rowHeight / 2;
                return (
                  <path
                    key={`${job.id}-${dep.jobId}`}
                    d={`M ${x1} ${y1} L ${(x1 + x2) / 2} ${y1} L ${(x1 + x2) / 2} ${y2} L ${x2} ${y2}`}
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    fill="none"
                    markerEnd="url(#gantt-arrow)"
                  />
                );
              }),
            )}
            <defs>
              <marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
              </marker>
            </defs>
          </svg>
        </div>
      </div>
    </div>
  );
}
