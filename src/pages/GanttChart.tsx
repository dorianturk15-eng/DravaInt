import { Fragment, useMemo, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';

interface GanttTask {
  id: number;
  name: string;
  start: string; // ISO date
  end: string; // ISO date
  color: string;
}

let nextId = 1;

const COLORS = ['#1a365d', '#2b6cb0', '#16a34a', '#d97706', '#7c3aed', '#dc2626'];

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
  const [tasks, setTasks] = useState<GanttTask[]>([
    { id: nextId++, name: 'Nabava sirovine', start: '2026-07-10', end: '2026-07-14', color: COLORS[0] },
    { id: nextId++, name: 'Izrada kalupa RN-2026-014', start: '2026-07-12', end: '2026-07-20', color: COLORS[1] },
    { id: nextId++, name: 'Montaža CNC-2', start: '2026-07-15', end: '2026-07-18', color: COLORS[2] },
    { id: nextId++, name: 'Kontrola kvalitete', start: '2026-07-19', end: '2026-07-24', color: COLORS[3] },
  ]);

  const [form, setForm] = useState({ name: '', start: '', end: '' });

  const { rangeStart, totalDays } = useMemo(() => {
    if (tasks.length === 0) {
      const today = dateOnly(new Date());
      return { rangeStart: today, totalDays: 14 };
    }
    const starts = tasks.map((t) => dateOnly(new Date(t.start)));
    const ends = tasks.map((t) => dateOnly(new Date(t.end)));
    const min = new Date(Math.min(...starts.map((d) => d.getTime())));
    const max = new Date(Math.max(...ends.map((d) => d.getTime())));
    const days = Math.max(diffDays(min, max) + 1, 7);
    return { rangeStart: min, totalDays: days };
  }, [tasks]);

  const today = dateOnly(new Date());
  const todayOffset = diffDays(rangeStart, today);

  function addTask() {
    if (!form.name || !form.start || !form.end) return;
    setTasks((prev) => [
      ...prev,
      { id: nextId++, name: form.name, start: form.start, end: form.end, color: COLORS[prev.length % COLORS.length] },
    ]);
    setForm({ name: '', start: '', end: '' });
  }

  function removeTask(id: number) {
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  const dayWidth = 28;

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.gantt.title}</h2>
      <p style={{ margin: '0 0 20px 0', fontSize: 13, color: '#64748b' }}>{t.gantt.subtitle}</p>

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
        <button className="btn btn-green" onClick={addTask}>
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

          {tasks.map((task) => {
            const startOffset = diffDays(rangeStart, dateOnly(new Date(task.start)));
            const length = diffDays(new Date(task.start), new Date(task.end)) + 1;
            return (
              <Fragment key={task.id}>
                <div className="gantt-row-label">
                  {task.name}
                  <button
                    className="btn btn-red"
                    style={{ padding: '2px 8px', fontSize: 10, width: 'auto', marginLeft: 'auto' }}
                    onClick={() => removeTask(task.id)}
                  >
                    ✕
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
                      background: task.color,
                    }}
                  >
                    {task.name}
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
