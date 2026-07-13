import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconTrash, IconList, IconBoard } from '../components/Icons';
import { useScheduling, type JobStatus } from '../scheduling/SchedulingContext';
import { hasChildren } from '../scheduling/hierarchy';

const STATUSES: JobStatus[] = ['planned', 'inProgress', 'done', 'delayed'];

export default function ProgressMonitoring() {
  const { t } = useLanguage();
  const { jobs: allJobs, updateJob, removeJob } = useScheduling();
  const jobs = allJobs.filter((j) => !hasChildren(allJobs, j.id));
  const [view, setView] = useState<'list' | 'board'>('list');

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.progress.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 8px 0', fontSize: 13 }}>{t.progress.subtitle}</p>
      <p className="subtitle-text" style={{ margin: '0 0 15px 0', fontSize: 12 }}>{t.progress.sharedNote}</p>

      <div className="view-toggle">
        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
          <IconList style={{ marginRight: 6, verticalAlign: -3 }} />
          {t.progress.viewList}
        </button>
        <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>
          <IconBoard style={{ marginRight: 6, verticalAlign: -3 }} />
          {t.progress.viewBoard}
        </button>
      </div>

      {jobs.length === 0 ? (
        <p className="subtitle-text" style={{ fontSize: 13 }}>{t.machines.noJobs}</p>
      ) : view === 'list' ? (
        <div style={{ overflowX: 'auto' }}>
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
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div style={{ fontWeight: 'bold' }}>{job.order || job.machine}</div>
                    <div className="subtitle-text" style={{ fontSize: 11 }}>
                      {job.machine}
                      {job.operator ? ` · ${job.operator}` : ''}
                    </div>
                  </td>
                  <td>
                    <select
                      value={job.status}
                      onChange={(e) => updateJob(job.id, { status: e.target.value as JobStatus })}
                      style={{ width: 'auto' }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t.progress.statusOptions[s]}
                        </option>
                      ))}
                    </select>
                    <div style={{ marginTop: 4 }}>
                      <span className={`status-pill status-${job.status}`}>
                        {t.progress.statusOptions[job.status]}
                      </span>
                    </div>
                  </td>
                  <td style={{ minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="progress-bar-track" style={{ flex: 1 }}>
                        <div className="progress-bar-fill" style={{ width: `${job.progress}%` }} />
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={job.progress}
                        style={{ width: 60 }}
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
        </div>
      ) : (
        <div className="board-columns">
          {STATUSES.map((status) => {
            const columnJobs = jobs.filter((j) => j.status === status);
            return (
              <div className="board-column" key={status}>
                <div className="board-column-title">
                  <span>{t.progress.statusOptions[status]}</span>
                  <span>{columnJobs.length}</span>
                </div>
                {columnJobs.map((job) => (
                  <div className="board-card" key={job.id}>
                    <div className="board-card-title">{job.order || job.machine}</div>
                    <div className="board-card-meta">
                      {job.machine}
                      {job.operator ? ` · ${job.operator}` : ''}
                    </div>
                    <div className="progress-bar-track" style={{ marginBottom: 8 }}>
                      <div className="progress-bar-fill" style={{ width: `${job.progress}%` }} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        value={job.status}
                        style={{ width: 'auto', fontSize: 11, padding: 4 }}
                        onChange={(e) => updateJob(job.id, { status: e.target.value as JobStatus })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t.progress.statusOptions[s]}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-red"
                        style={{ padding: '4px 8px', fontSize: 11, width: 'auto' }}
                        onClick={() => removeJob(job.id)}
                      >
                        <IconTrash style={{ width: 11, height: 11 }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
