import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus, IconTrash } from '../components/Icons';
import { useScheduling, type JobStatus } from '../scheduling/SchedulingContext';

export default function MachineSchedule() {
  const { t } = useLanguage();
  const { jobs, addJob, updateJob, removeJob } = useScheduling();

  const [form, setForm] = useState({ machine: '', order: '', operator: '', start: '', end: '' });

  function handleAdd() {
    if (!form.machine || !form.order) return;
    addJob(form);
    setForm({ machine: '', order: '', operator: '', start: '', end: '' });
  }

  function durationHours(start: string, end: string) {
    if (!start || !end) return '-';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (isNaN(ms) || ms <= 0) return '-';
    return (ms / (1000 * 60 * 60)).toFixed(1);
  }

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.machines.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 13 }}>{t.machines.subtitle}</p>

      <div className="step-box">
        <div className="step-title">
          <span className="step-number">1</span>
          {t.machines.addJob}
        </div>
        <div className="grid-inputs workers-ruster">
          <div>
            <label>{t.machines.machine}</label>
            <input
              type="text"
              value={form.machine}
              onChange={(e) => setForm({ ...form, machine: e.target.value })}
            />
          </div>
          <div>
            <label>{t.machines.order}</label>
            <input
              type="text"
              value={form.order}
              onChange={(e) => setForm({ ...form, order: e.target.value })}
            />
          </div>
          <div>
            <label>{t.machines.operator}</label>
            <input
              type="text"
              value={form.operator}
              onChange={(e) => setForm({ ...form, operator: e.target.value })}
            />
          </div>
          <div>
            <label>{t.common.start}</label>
            <input
              type="datetime-local"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </div>
        </div>
        <div className="grid-inputs workers-ruster" style={{ marginTop: 15 }}>
          <div>
            <label>{t.common.end}</label>
            <input
              type="datetime-local"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="action-bar">
        <button className="btn btn-green" onClick={handleAdd}>
          <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
          {t.common.add}
        </button>
      </div>

      <p className="subtitle-text" style={{ fontSize: 12, marginTop: 20 }}>
        {t.machines.sharedNote}
      </p>

      <div style={{ marginTop: 8, overflowX: 'auto' }}>
        {jobs.length === 0 ? (
          <p className="subtitle-text" style={{ fontSize: 13 }}>{t.machines.noJobs}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.machines.machine}</th>
                <th>{t.machines.order}</th>
                <th>{t.machines.operator}</th>
                <th>{t.common.start}</th>
                <th>{t.common.end}</th>
                <th>{t.machines.hours}</th>
                <th>{t.common.status}</th>
                <th>{t.common.progressLabel}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.machine}</td>
                  <td>{job.order}</td>
                  <td>{job.operator}</td>
                  <td>{job.start ? new Date(job.start).toLocaleString() : '-'}</td>
                  <td>{job.end ? new Date(job.end).toLocaleString() : '-'}</td>
                  <td>{durationHours(job.start, job.end)}</td>
                  <td>
                    <select
                      value={job.status}
                      style={{ width: 'auto' }}
                      onChange={(e) => updateJob(job.id, { status: e.target.value as JobStatus })}
                    >
                      {(['planned', 'inProgress', 'done', 'delayed'] as JobStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {t.progress.statusOptions[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div className="progress-bar-track" style={{ width: 60 }}>
                        <div className="progress-bar-fill" style={{ width: `${job.progress}%` }} />
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={job.progress}
                        style={{ width: 55 }}
                        onChange={(e) =>
                          updateJob(job.id, {
                            progress: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
                          })
                        }
                      />
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn btn-red"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={() => removeJob(job.id)}
                    >
                      <IconTrash style={{ marginRight: 4, verticalAlign: -2, width: 12, height: 12 }} />
                      {t.common.remove}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
