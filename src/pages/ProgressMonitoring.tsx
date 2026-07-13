import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus, IconTrash } from '../components/Icons';

type Status = 'planned' | 'inProgress' | 'done' | 'delayed';

interface TaskItem {
  id: number;
  name: string;
  status: Status;
  progress: number;
}

let nextId = 1;

export default function ProgressMonitoring() {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<TaskItem[]>([
    { id: nextId++, name: 'Nabava sirovine - Alatnica', status: 'done', progress: 100 },
    { id: nextId++, name: 'Izrada kalupa RN-2026-014', status: 'inProgress', progress: 65 },
    { id: nextId++, name: 'Montaža stroja CNC-2', status: 'delayed', progress: 30 },
    { id: nextId++, name: 'Kontrola kvalitete serije 220', status: 'planned', progress: 0 },
  ]);

  const [name, setName] = useState('');

  function addTask() {
    if (!name.trim()) return;
    setTasks((prev) => [...prev, { id: nextId++, name: name.trim(), status: 'planned', progress: 0 }]);
    setName('');
  }

  function updateStatus(id: number, status: Status) {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, status } : task)));
  }

  function updateProgress(id: number, progress: number) {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, progress } : task)));
  }

  function removeTask(id: number) {
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.progress.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 13 }}>{t.progress.subtitle}</p>

      <div className="step-box">
        <div className="step-title">
          <span className="step-number">1</span>
          {t.progress.addTask}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.progress.task}
            />
          </div>
          <button className="btn btn-green" onClick={addTask}>
            <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.common.add}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 20, overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.progress.task}</th>
              <th>{t.common.status}</th>
              <th>{t.common.progressLabel}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.name}</td>
                <td>
                  <select
                    value={task.status}
                    onChange={(e) => updateStatus(task.id, e.target.value as Status)}
                    style={{ width: 'auto' }}
                  >
                    {(['planned', 'inProgress', 'done', 'delayed'] as Status[]).map((s) => (
                      <option key={s} value={s}>
                        {t.progress.statusOptions[s]}
                      </option>
                    ))}
                  </select>
                  <div style={{ marginTop: 4 }}>
                    <span className={`status-pill status-${task.status}`}>
                      {t.progress.statusOptions[task.status]}
                    </span>
                  </div>
                </td>
                <td style={{ minWidth: 180 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="progress-bar-track" style={{ flex: 1 }}>
                      <div className="progress-bar-fill" style={{ width: `${task.progress}%` }} />
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={task.progress}
                      style={{ width: 60 }}
                      onChange={(e) => updateProgress(task.id, Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                    />
                  </div>
                </td>
                <td>
                  <button
                    className="btn btn-red"
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    onClick={() => removeTask(task.id)}
                  >
                    <IconTrash style={{ marginRight: 4, verticalAlign: -2, width: 12, height: 12 }} />
                    {t.common.remove}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
