import { useLanguage } from '../i18n/LanguageContext';
import { IconTrash } from '../components/Icons';
import { useScheduling, type JobStatus } from '../scheduling/SchedulingContext';

export default function ProgressMonitoring() {
  const { t } = useLanguage();
  const { jobs, updateJob, removeJob } = useScheduling();

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.progress.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 8px 0', fontSize: 13 }}>{t.progress.subtitle}</p>
      <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 12 }}>{t.progress.sharedNote}</p>

      <div style={{ overflowX: 'auto' }}>
        {jobs.length === 0 ? (
          <p className="subtitle-text" style={{ fontSize: 13 }}>{t.machines.noJobs}</p>
        ) : (
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
                      {(['planned', 'inProgress', 'done', 'delayed'] as JobStatus[]).map((s) => (
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
        )}
      </div>
    </div>
  );
}
