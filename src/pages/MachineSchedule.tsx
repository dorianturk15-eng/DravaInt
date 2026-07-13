import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus, IconTrash } from '../components/Icons';

interface MachineJob {
  id: number;
  machine: string;
  order: string;
  operator: string;
  start: string;
  end: string;
}

let nextId = 1;

export default function MachineSchedule() {
  const { t } = useLanguage();
  const [jobs, setJobs] = useState<MachineJob[]>([
    { id: nextId++, machine: 'CNC-1', order: 'RN-2026-014', operator: 'Goran Ć.', start: '2026-07-13T06:00', end: '2026-07-13T14:00' },
    { id: nextId++, machine: 'CNC-2', order: 'RN-2026-015', operator: 'Alen M.', start: '2026-07-13T14:00', end: '2026-07-13T22:00' },
    { id: nextId++, machine: 'Glodalica-1', order: 'RN-2026-016', operator: 'Damir M.', start: '2026-07-13T06:00', end: '2026-07-13T13:00' },
  ]);

  const [form, setForm] = useState({ machine: '', order: '', operator: '', start: '', end: '' });

  function addJob() {
    if (!form.machine || !form.order) return;
    setJobs((prev) => [...prev, { id: nextId++, ...form }]);
    setForm({ machine: '', order: '', operator: '', start: '', end: '' });
  }

  function removeJob(id: number) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
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
        <button className="btn btn-green" onClick={addJob}>
          <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
          {t.common.add}
        </button>
      </div>

      <div style={{ marginTop: 20, overflowX: 'auto' }}>
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
