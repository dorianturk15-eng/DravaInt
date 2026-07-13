import { useMemo, useState } from 'react';
import { Gantt, ViewMode, type Task } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus } from '../components/Icons';
import { useScheduling, type DependencyType } from '../scheduling/SchedulingContext';
import { buildGanttTasks, jobIdFromTaskId, hasChildren } from '../scheduling/hierarchy';

const DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export default function GanttChart() {
  const { t } = useLanguage();
  const { jobs, addJob, updateJob, removeJob } = useScheduling();

  const [form, setForm] = useState({ name: '', start: '', end: '' });
  const [depForm, setDepForm] = useState({ jobId: '', predecessorId: '', type: 'FS' as DependencyType, lagHours: '0' });
  const [depError, setDepError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);

  const validJobs = jobs.filter((j) => j.start);
  const hasAnyDependency = validJobs.some((j) => (j.dependencies?.length ?? 0) > 0);
  const tasks: Task[] = useMemo(() => buildGanttTasks(jobs), [jobs]);
  const schedulableJobs = validJobs.filter((j) => !hasChildren(jobs, j.id));

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

  function handleDateChange(task: Task) {
    const jobId = jobIdFromTaskId(task.id);
    if (!jobId) return;
    updateJob(jobId, {
      start: toLocalDateTimeString(task.start),
      end: toLocalDateTimeString(task.end),
    });
  }

  function handleProgressChange(task: Task) {
    const jobId = jobIdFromTaskId(task.id);
    if (!jobId) return;
    updateJob(jobId, { progress: Math.round(task.progress) });
  }

  function handleDelete(task: Task): boolean {
    const jobId = jobIdFromTaskId(task.id);
    if (!jobId) return false;
    removeJob(jobId);
    return true;
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

  const typeLabel: Record<DependencyType, string> = {
    FS: t.gantt.typeFS,
    SS: t.gantt.typeSS,
    FF: t.gantt.typeFF,
    SF: t.gantt.typeSF,
  };

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
              {schedulableJobs.map((j) => (
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
              {schedulableJobs.map((j) => (
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

      <div className="view-toggle" style={{ marginTop: 20 }}>
        {[ViewMode.Day, ViewMode.Week, ViewMode.Month].map((mode) => (
          <button key={mode} className={viewMode === mode ? 'active' : ''} onClick={() => setViewMode(mode)}>
            {mode}
          </button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <p className="subtitle-text" style={{ fontSize: 13 }}>{t.machines.noJobs}</p>
      ) : (
        <div className="gantt-lib-wrapper">
          <Gantt
            tasks={tasks}
            viewMode={viewMode}
            onDateChange={handleDateChange}
            onProgressChange={handleProgressChange}
            onDelete={handleDelete}
            columnWidth={viewMode === ViewMode.Month ? 300 : viewMode === ViewMode.Week ? 250 : 65}
            todayColor="rgba(220, 38, 38, 0.15)"
          />
        </div>
      )}
    </div>
  );
}
