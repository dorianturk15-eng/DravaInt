import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconTrash, IconList, IconBoard } from '../components/Icons';
import { useScheduling, type JobStatus } from '../scheduling/SchedulingContext';
import { hasChildren } from '../scheduling/hierarchy';

const STATUSES: JobStatus[] = ['planned', 'inProgress', 'done', 'delayed'];

export default function ProgressMonitoring() {
  const { t, lang } = useLanguage();
  const { jobs: allJobs, updateJob, removeJob } = useScheduling();
  const jobs = allJobs.filter((j) => !hasChildren(allJobs, j.id));
  const [view, setView] = useState<'list' | 'board'>('list');
  const [searchQuery, setSearchQuery] = useState('');

  // Custom states
  const [detailJobId, setDetailJobId] = useState<number | null>(null);

  const filteredJobs = jobs.filter((job) => {
    const q = searchQuery.toLowerCase();
    const orderMatch = (job.order || '').toLowerCase().includes(q);
    const machineMatch = (job.machine || '').toLowerCase().includes(q);
    const operatorMatch = (job.operator || '').toLowerCase().includes(q);
    return orderMatch || machineMatch || operatorMatch;
  });

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
    updateJob(jobId, { status });
    if (status === 'done') {
      triggerConfetti();
    }
  }

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5, fontFamily: 'var(--font-title)', fontWeight: 800 }}>{t.progress.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 8px 0', fontSize: 13 }}>{t.progress.subtitle}</p>
      <p className="subtitle-text" style={{ margin: '0 0 15px 0', fontSize: 12 }}>{t.progress.sharedNote}</p>

      <div style={{ display: 'flex', gap: 15, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <div className="view-toggle" style={{ marginBottom: 0 }}>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            <IconList style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.progress.viewList}
          </button>
          <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>
            <IconBoard style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.progress.viewBoard}
          </button>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <input
            type="text"
            placeholder={lang === 'hr' ? 'Pretraži po nalogu, stroju, operateru...' : 'Search by order, machine, operator...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color-strong)' }}
          />
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <p className="subtitle-text" style={{ fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
          {lang === 'hr' ? 'Nema rezultata pretrage.' : 'No search results found.'}
        </p>
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
              {filteredJobs.map((job) => (
                <tr key={job.id}>
                  <td onClick={() => setDetailJobId(job.id)} style={{ cursor: 'pointer' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>{job.order || job.machine}</div>
                    <div className="subtitle-text" style={{ fontSize: 11 }}>
                      {job.machine}
                      {job.operator ? ` · ${job.operator}` : ''}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <select
                        value={job.status}
                        onChange={(e) => handleStatusChange(job.id, e.target.value as JobStatus)}
                        style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
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
                    </div>
                  </td>
                  <td style={{ minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="progress-bar-track" style={{ flex: 1 }}>
                        <div className="progress-bar-fill" style={{ width: `${job.progress}%`, background: job.status === 'done' ? 'var(--success-color)' : 'var(--primary-color)' }} />
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={job.progress}
                        style={{ width: 60, padding: 4 }}
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
                      style={{ padding: '6px 12px', fontSize: 11, width: 'auto' }}
                      onClick={() => removeJob(job.id)}
                    >
                      <IconTrash style={{ width: 12, height: 12 }} />
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
            const columnJobs = filteredJobs.filter((j) => j.status === status);
            return (
              <div className="board-column" key={status} style={{ borderTop: `4px solid ${status === 'done' ? 'var(--success-color)' : status === 'delayed' ? 'var(--danger-color)' : 'var(--primary-color)'}` }}>
                <div className="board-column-title" style={{ padding: '4px 0 8px 0', borderBottom: '1px solid var(--border-color)', marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t.progress.statusOptions[status]}</span>
                  <span style={{ background: 'var(--border-color-strong)', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: 999, fontSize: 11 }}>{columnJobs.length}</span>
                </div>
                {columnJobs.map((job) => (
                  <div className="board-card" key={job.id} style={{ borderLeft: `3px solid ${status === 'done' ? 'var(--success-color)' : status === 'delayed' ? 'var(--danger-color)' : 'var(--primary-color)'}`, cursor: 'pointer' }} onClick={() => setDetailJobId(job.id)}>
                    <div className="board-card-title" style={{ fontWeight: 700, color: 'var(--primary-color)' }}>{job.order || job.machine}</div>
                    <div className="board-card-meta">
                      {job.machine}
                      {job.operator ? ` · ${job.operator}` : ''}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <div className="progress-bar-track" style={{ flex: 1, height: 6 }}>
                        <div className="progress-bar-fill" style={{ width: `${job.progress}%`, background: status === 'done' ? 'var(--success-color)' : 'var(--primary-color)' }} />
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700 }}>{job.progress}%</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between' }} onClick={(e) => e.stopPropagation()}>
                      <select
                        value={job.status}
                        style={{ width: 'auto', fontSize: 11, padding: '2px 6px' }}
                        onChange={(e) => handleStatusChange(job.id, e.target.value as JobStatus)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t.progress.statusOptions[s]}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-red"
                        style={{ padding: 4, width: 24, height: 24, minWidth: 24, borderRadius: 4 }}
                        onClick={() => removeJob(job.id)}
                      >
                        <IconTrash style={{ width: 12, height: 12 }} />
                      </button>
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
          <div className="login-page" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="wizard-container login-card" style={{ maxWidth: 400, textAlign: 'left', background: 'var(--bg-card)', padding: 24, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-hover)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--font-title)', fontWeight: 800 }}>🔍 {lang === 'hr' ? 'Detalji Radnog Naloga' : 'Work Order Details'}</h3>
                <button onClick={() => setDetailJobId(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                <div><strong style={{ color: 'var(--text-secondary)' }}>{t.workOrders.orderNumber}:</strong> <span style={{ fontWeight: 700 }}>{job.order}</span></div>
                <div><strong style={{ color: 'var(--text-secondary)' }}>{t.workOrders.product}:</strong> {job.operator || '-'}</div>
                <div><strong style={{ color: 'var(--text-secondary)' }}>{t.machines.machine}:</strong> {job.machine}</div>
                <div><strong style={{ color: 'var(--text-secondary)' }}>{t.common.status}:</strong> <span className={`status-pill status-${job.status}`} style={{ fontSize: 11 }}>{t.progress.statusOptions[job.status]}</span></div>
                <div><strong style={{ color: 'var(--text-secondary)' }}>{t.common.progressLabel}:</strong> <span style={{ fontWeight: 700 }}>{job.progress}%</span></div>
                <div><strong style={{ color: 'var(--text-secondary)' }}>{t.common.start}:</strong> {job.start ? new Date(job.start).toLocaleString() : '-'}</div>
                <div><strong style={{ color: 'var(--text-secondary)' }}>{t.common.end}:</strong> {job.end ? new Date(job.end).toLocaleString() : '-'}</div>
              </div>
              <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-blue" onClick={() => setDetailJobId(null)} style={{ width: 'auto', padding: '6px 16px' }}>
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
