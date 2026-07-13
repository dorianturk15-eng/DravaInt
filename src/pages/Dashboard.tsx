import { useLanguage } from '../i18n/LanguageContext';
import { useScheduling, type JobStatus } from '../scheduling/SchedulingContext';

const STATUS_COLORS: Record<JobStatus, string> = {
  planned: '#64748b',
  inProgress: '#2b6cb0',
  done: '#16a34a',
  delayed: '#dc2626',
};

export default function Dashboard() {
  const { t } = useLanguage();
  const { jobs } = useScheduling();

  const total = jobs.length;
  const avgProgress = total === 0 ? 0 : Math.round(jobs.reduce((s, j) => s + j.progress, 0) / total);
  const counts: Record<JobStatus, number> = { planned: 0, inProgress: 0, done: 0, delayed: 0 };
  jobs.forEach((j) => {
    counts[j.status]++;
  });

  const recent = [...jobs].sort((a, b) => b.id - a.id).slice(0, 6);

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.dashboard.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 13 }}>{t.dashboard.subtitle}</p>

      <div className="stat-grid">
        <div className="stat-tile" style={{ borderLeftColor: '#1a365d' }}>
          <div className="stat-value">{total}</div>
          <div className="stat-label">{t.dashboard.totalJobs}</div>
        </div>
        <div className="stat-tile" style={{ borderLeftColor: '#16a34a' }}>
          <div className="stat-value">{avgProgress}%</div>
          <div className="stat-label">{t.dashboard.avgProgress}</div>
        </div>
        {(['planned', 'inProgress', 'done', 'delayed'] as JobStatus[]).map((s) => (
          <div className="stat-tile" key={s} style={{ borderLeftColor: STATUS_COLORS[s] }}>
            <div className="stat-value">{counts[s]}</div>
            <div className="stat-label">{t.progress.statusOptions[s]}</div>
          </div>
        ))}
      </div>

      <div className="step-box">
        <div className="step-title">{t.dashboard.recentJobs}</div>
        {recent.length === 0 ? (
          <p className="subtitle-text" style={{ fontSize: 13 }}>{t.dashboard.noJobs}</p>
        ) : (
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
                  <td>{job.order || '-'}</td>
                  <td>{job.machine || '-'}</td>
                  <td>
                    <span className={`status-pill status-${job.status}`}>
                      {t.progress.statusOptions[job.status]}
                    </span>
                  </td>
                  <td style={{ minWidth: 140 }}>
                    <div className="progress-bar-track">
                      <div className="progress-bar-fill" style={{ width: `${job.progress}%` }} />
                    </div>
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
