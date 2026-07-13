import { Fragment, useMemo, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus, IconTrash } from '../components/Icons';
import { useScheduling, type JobStatus } from '../scheduling/SchedulingContext';

const STATUS_COLORS: Record<JobStatus, string> = {
  planned: '#64748b',
  inProgress: '#2b6cb0',
  done: '#16a34a',
  delayed: '#dc2626',
};

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
  const { jobs, addJob, removeJob } = useScheduling();

  const [form, setForm] = useState({ name: '', start: '', end: '' });

  const validJobs = jobs.filter((j) => j.start && j.end);

  const { rangeStart, totalDays } = useMemo(() => {
    if (validJobs.length === 0) {
      const today = dateOnly(new Date());
      return { rangeStart: today, totalDays: 14 };
    }
    const starts = validJobs.map((j) => dateOnly(new Date(j.start)));
    const ends = validJobs.map((j) => dateOnly(new Date(j.end)));
    const min = new Date(Math.min(...starts.map((d) => d.getTime())));
    const max = new Date(Math.max(...ends.map((d) => d.getTime())));
    const days = Math.max(diffDays(min, max) + 1, 7);
    return { rangeStart: min, totalDays: days };
  }, [validJobs]);

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

  const dayWidth = 28;

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

      <div className="gantt-wrapper" style={{ marginTop: 20 }}>
        <div
          className="gantt-grid"
          style={{ gridTemplateColumns: `200px repeat(${totalDays}, ${dayWidth}px)` }}
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
            const startOffset = diffDays(rangeStart, dateOnly(new Date(job.start)));
            const length = diffDays(new Date(job.start), new Date(job.end)) + 1;
            const label = job.order || job.machine;
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
                      border: `1px solid ${STATUS_COLORS[job.status]}`,
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
        </div>
      </div>
    </div>
  );
}
