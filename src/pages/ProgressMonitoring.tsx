import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { IconTrash, IconList, IconBoard } from '../components/Icons';
import { InlineNotice } from '../components/Page';
import { useScheduling, type JobStatus } from '../scheduling/SchedulingContext';
import { hasChildren } from '../scheduling/hierarchy';
import { priorityLabel, priorityMeta, priorityRank } from '../scheduling/priority';
import { isJobOverdue } from '../scheduling/status';
import { useAuth } from '../auth/AuthContext';
import { canAccessTab } from '../auth/access';
import { requestFocus } from '../navigation/focusTarget';

const STATUSES: JobStatus[] = ['planned', 'inProgress', 'done', 'delayed'];

/** The board's per-status accent. Was an inline nested ternary repeated four times. */
function statusColor(status: string) {
  if (status === 'done') return 'var(--success-color)';
  if (status === 'delayed') return 'var(--danger-color)';
  return 'var(--primary-color)';
}

export default function ProgressMonitoring() {
  const { t, lang } = useLanguage();
  const { jobs: allJobs, updateJob, removeJob } = useScheduling();
  const { username, users } = useAuth();
  const navigate = useNavigate();
  const jobs = allJobs.filter((j) => !hasChildren(allJobs, j.id));
  // Only roles that can open the creator get the edit deep link — same derivation as the App shell.
  const currentUser = users.find((user) => user.username.toLowerCase() === (username ?? '').toLowerCase());
  const canEditOrders = canAccessTab(currentUser?.role || 'workers', 'workOrders');
  const openEditor = (jobId: number) => navigate(`/workOrders?edit=${jobId}`);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [searchQuery, setSearchQuery] = useState('');

  // Custom states
  const [detailJobId, setDetailJobId] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Wraps updateJob so a rejected DB write / version conflict is surfaced instead of silently
  // lost — the input would otherwise snap back on the next refetch with no explanation.
  async function applyUpdate(jobId: number, patch: Parameters<typeof updateJob>[1]) {
    const result = await updateJob(jobId, patch);
    if (!result.ok && (result.reason === 'rejected' || result.reason === 'version-conflict')) {
      setUpdateError(result.reason === 'rejected'
        ? (result.message || (lang === 'hr' ? 'Baza je odbila izmjenu.' : 'The database rejected the change.'))
        : (lang === 'hr' ? 'Nalog je izmijenjen na drugom terminalu — osvježite prikaz.' : 'This order changed on another terminal — refresh to see the latest.'));
    } else {
      setUpdateError(null);
    }
    return result;
  }

  const filteredJobs = jobs.filter((job) => {
    const q = searchQuery.toLowerCase();
    const orderMatch = (job.order || '').toLowerCase().includes(q);
    const machineMatch = (job.machine || '').toLowerCase().includes(q);
    const operatorMatch = (job.operator || '').toLowerCase().includes(q);
    return orderMatch || machineMatch || operatorMatch;
  }).sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));

  // Auto-flag shown when a job's dates say it is overdue but its manual status hasn't been updated.
  const overdueBadge = (
    <span className="overdue-badge">
      {lang === 'hr' ? 'KAŠNJENJE (auto)' : 'LATE (auto)'}
    </span>
  );

  // Client-side physics confetti burst
  function triggerConfetti() {
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '99999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const colors = ['#f43f5e', '#3b82f6', '#10b981', '#eab308', '#a855f7', '#ff7849'];
    const particles = Array.from({ length: 80 }).map(() => ({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 15,
      vy: (Math.random() - 0.5) * 15 - 5,
      radius: Math.random() * 4 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      decay: Math.random() * 0.015 + 0.015,
    }));

    function anim() {
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      particles.forEach((p) => {
        if (p.alpha > 0) {
          alive = true;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.2; // gravity
          p.alpha -= p.decay;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx!.fillStyle = p.color;
          ctx!.globalAlpha = Math.max(0, p.alpha);
          ctx!.fill();
        }
      });
      if (alive) {
        requestAnimationFrame(anim);
      } else {
        canvas.remove();
      }
    }
    anim();
  }

  function handleStatusChange(jobId: number, status: JobStatus) {
    void applyUpdate(jobId, { status });
    if (status === 'done') {
      triggerConfetti();
    }
  }

  return (
    <div className="wizard-container">
      <h2 className="pm-heading">{t.progress.title}</h2>
      <p className="subtitle-text text-md pm-lead">{t.progress.subtitle}</p>
      <p className="subtitle-text text-sm pm-lead is-lg">{t.progress.sharedNote}</p>
      {updateError && <InlineNotice tone="error">{updateError}</InlineNotice>}

      <div className="pm-toolbar">
        <div className="view-toggle mb-0">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            <IconList className="inline-icon" />
            {t.progress.viewList}
          </button>
          <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>
            <IconBoard className="inline-icon" />
            {t.progress.viewBoard}
          </button>
        </div>

        <div className="flex-1-wide">
          <input
            type="text"
            placeholder={lang === 'hr' ? 'Pretraži po nalogu, stroju, operateru...' : 'Search by order, machine, operator...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pm-search-input"
          />
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <p className="subtitle-text pm-empty">
          {lang === 'hr' ? 'Nema rezultata pretrage.' : 'No search results found.'}
        </p>
      ) : view === 'list' ? (
        <div className="table-scroll">
          <table className="data-table is-cards">
            <thead>
              <tr>
                <th>{t.progress.task}</th>
                <th>{t.common.status}</th>
                <th>{t.common.progressLabel}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => (
                <tr key={job.id}>
                  <td onClick={() => setDetailJobId(job.id)} className="is-clickable-cell">
                    <div className="text-accent-strong">{job.order || job.machine}</div>
                    <div className="subtitle-text text-xs">
                      {job.machine}
                      {job.operator ? ` · ${job.operator}` : ''}
                    </div>
                  </td>
                  <td data-label={t.common.status}>
                    <div className="row-center-sm">
                      <select
                        value={job.status}
                        onChange={(e) => handleStatusChange(job.id, e.target.value as JobStatus)}
                        className="btn-mini is-sm"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t.progress.statusOptions[s]}
                          </option>
                        ))}
                      </select>
                      <span className={`status-pill status-${job.status}`}>
                        {t.progress.statusOptions[job.status]}
                      </span>
                      <span className="priority-chip" style={{ '--chip-color': priorityMeta(job.priority).color } as React.CSSProperties}>
                        {priorityLabel(job.priority, lang)}
                      </span>
                      {job.status !== 'delayed' && isJobOverdue(job) && overdueBadge}
                    </div>
                  </td>
                  <td className="min-w-md" data-label={t.common.progressLabel}>
                    <div className="row-center-xs">
                      <div className="progress-bar-track flex-1">
                        <div className="progress-bar-fill" style={{ width: `${job.progress}%`, '--bar-color': job.status === 'done' ? 'var(--success-color)' : 'var(--primary-color)' } as React.CSSProperties} />
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={job.progress}
                        className="input-narrow"
                        onChange={(e) =>
                          void applyUpdate(job.id, {
                            progress: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
                          })
                        }
                      />
                    </div>
                  </td>
                  <td>
                    <div className="row-gap-xs">
                      <button
                        className="btn btn-ghost btn-mini is-md"
                        title={t.machineBoard.showOnBoard}
                        onClick={() => requestFocus({ tab: 'machines', jobId: job.id })}
                      >
                        <IconBoard className="icon-xs" />
                      </button>
                      {canEditOrders && (
                        <button
                          className="btn btn-ghost btn-mini is-md"
                          title={lang === 'hr' ? 'Otvori nalog u kreatoru za uređivanje' : 'Open this order in the creator for editing'}
                          onClick={() => openEditor(job.id)}
                        >
                          {t.workOrders.edit}
                        </button>
                      )}
                      <button
                        className="btn btn-red btn-mini is-md"
                        onClick={() => removeJob(job.id)}
                      >
                        <IconTrash className="icon-xs" />
                        {t.common.remove}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="board-columns">
          {STATUSES.map((status) => {
            const columnJobs = filteredJobs.filter((j) => j.status === status);
            return (
              <div className="board-column" key={status} style={{ '--status-color': statusColor(status) } as React.CSSProperties}>
                <div className="board-column-title pm-group-head">
                  <span className="text-strong">{t.progress.statusOptions[status]}</span>
                  <span className="pm-count-pill">{columnJobs.length}</span>
                </div>
                {columnJobs.map((job) => (
                  <div className="board-card" key={job.id} style={{ '--status-color': statusColor(status) } as React.CSSProperties} onClick={() => setDetailJobId(job.id)}>
                    <div className="board-card-title pm-group-title">
                      {job.order || job.machine}
                      <span className="priority-chip is-xs" style={{ '--chip-color': priorityMeta(job.priority).color } as React.CSSProperties}>
                        {priorityLabel(job.priority, lang)}
                      </span>
                      {job.status !== 'delayed' && isJobOverdue(job) && overdueBadge}
                    </div>
                    <div className="board-card-meta">
                      {job.machine}
                      {job.operator ? ` · ${job.operator}` : ''}
                    </div>
                    <div className="row-center-xxs has-gap-b">
                      <div className="progress-bar-track flex-1 bar-thin">
                        <div className="progress-bar-fill" style={{ width: `${job.progress}%`, '--bar-color': status === 'done' ? 'var(--success-color)' : 'var(--primary-color)' } as React.CSSProperties} />
                      </div>
                      <span className="text-xxs-strong">{job.progress}%</span>
                    </div>
                    <div className="pm-row-between" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={job.status}
                        className="btn-micro"
                        onChange={(e) => handleStatusChange(job.id, e.target.value as JobStatus)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t.progress.statusOptions[s]}
                          </option>
                        ))}
                      </select>
                      <div className="row-gap-xxs">
                        {canEditOrders && (
                          <button
                            className="btn btn-ghost btn-micro is-tall"
                            title={lang === 'hr' ? 'Otvori nalog u kreatoru za uređivanje' : 'Open this order in the creator for editing'}
                            onClick={() => openEditor(job.id)}
                          >
                            {t.workOrders.edit}
                          </button>
                        )}
                        <button
                          className="btn btn-red btn-icon-square"
                          onClick={() => removeJob(job.id)}
                        >
                          <IconTrash className="icon-xs" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Detail Spec Card Modal */}
      {detailJobId && (() => {
        const job = jobs.find((j) => j.id === detailJobId);
        if (!job) return null;
        return (
          <div className="modal-backdrop" onClick={() => setDetailJobId(null)}>
            <div className="modal-content" onClick={(event) => event.stopPropagation()}>
              <div className="modal-header">
                <h3 className="m-0">{lang === 'hr' ? 'Detalji radnog naloga' : 'Work order details'}</h3>
                <button onClick={() => setDetailJobId(null)} className="modal-close-button" aria-label={lang === 'hr' ? 'Zatvori' : 'Close'}>✕</button>
              </div>
              <div className="modal-body pm-detail-body">
                <div><strong className="text-muted">{t.workOrders.orderNumber}:</strong> <span className="text-strong">{job.order}</span></div>
                <div><strong className="text-muted">{t.workOrders.product}:</strong> {job.operator || '-'}</div>
                <div><strong className="text-muted">{t.machines.machine}:</strong> {job.machine}</div>
                <div><strong className="text-muted">{t.common.status}:</strong> <span className={`status-pill status-${job.status}`} className="text-xs">{t.progress.statusOptions[job.status]}</span></div>
                <div><strong className="text-muted">{t.common.progressLabel}:</strong> <span className="text-strong">{job.progress}%</span></div>
                <div><strong className="text-muted">{t.common.start}:</strong> {job.start ? new Date(job.start).toLocaleString() : '-'}</div>
                <div><strong className="text-muted">{t.common.end}:</strong> {job.end ? new Date(job.end).toLocaleString() : '-'}</div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-blue btn-sm" onClick={() => setDetailJobId(null)}>
                  {lang === 'hr' ? 'Zatvori' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
