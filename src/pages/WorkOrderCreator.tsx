import { useState, useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus, IconTrash, IconPrint } from '../components/Icons';
import { useScheduling, type OperationStep, type JobPriority } from '../scheduling/SchedulingContext';
import { hasChildren } from '../scheduling/hierarchy';
import { useLogo } from '../logo/LogoContext';
import { useWorkers } from '../workers/WorkersContext';
import { priorityLabel, priorityMeta } from '../scheduling/priority';

let nextOpId = 1;

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}.`;
}

function formatDateTime(value: string): string {
  if (!value) return '-';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function WorkOrderCreator() {
  const { t, lang } = useLanguage();
  const { jobs, addJob, restoreBackup, getJobConflicts } = useScheduling();
  const { logo } = useLogo();
  const { activeWorkers, displayName } = useWorkers();
  const [printOrderId, setPrintOrderId] = useState<number | null>(null);

  const [creatorTab, setCreatorTab] = useState<'create' | 'timemachine'>('create');

  // Load and manage backups
  const [backups, setBackups] = useState<{ timestamp: string; label: string; jobs: typeof jobs }[]>(() => {
    try {
      const raw = localStorage.getItem('dravaint-document-backups');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Automatically record a backup version when jobs change
  useEffect(() => {
    if (jobs.length === 0) return;
    const jobsStr = JSON.stringify(jobs);
    setBackups((current) => {
      const latest = current[current.length - 1];
      if (latest && JSON.stringify(latest.jobs) === jobsStr) return current;
      const updated = [...current, { timestamp: new Date().toISOString(), label: `Backup Snapshot #${current.length + 1} (${jobs.length} Active Docs)`, jobs: JSON.parse(jobsStr) }].slice(-30);
      localStorage.setItem('dravaint-document-backups', JSON.stringify(updated));
      return updated;
    });
  }, [jobs]);

  const [orderNumber, setOrderNumber] = useState('');
  const [product, setProduct] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [priority, setPriority] = useState<JobPriority>('normal');
  const [comments, setComments] = useState('');
  const [startDateTime, setStartDateTime] = useState('');
  const [parentId, setParentId] = useState('');

  const [operations, setOperations] = useState<OperationStep[]>([]);
  const [opForm, setOpForm] = useState({ name: '', machine: '', hours: '', operatorId: '' });
  const [orderSearch, setOrderSearch] = useState('');

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // CAD Blueprint upload state
  const [cadFile, setCadFile] = useState<File | null>(null);
  const [cadError, setCadError] = useState<string | null>(null);

  function handleCadUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setCadError(null);
    setCadFile(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.step', '.stp', '.pdf'].includes(ext)) {
      setCadError(lang === 'hr' ? 'Nedopušten format! Dozvoljeni su samo .step, .stp i .pdf.' : 'Invalid format! Only .step, .stp and .pdf are allowed.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setCadError(lang === 'hr' ? 'Maksimalna veličina datoteke je 10MB!' : 'Maximum file size is 10MB!');
      return;
    }

    setCadFile(file);
  }

  const totalHours = operations.reduce((sum, op) => sum + op.hours, 0);

  function addOperation() {
    const hours = parseFloat(opForm.hours);
    if (!opForm.name || !opForm.machine || !hours || hours <= 0) return;
    const opWorker = activeWorkers.find((worker) => worker.id === Number(opForm.operatorId));
    setOperations((prev) => [...prev, {
      id: nextOpId++,
      name: opForm.name,
      machine: opForm.machine,
      hours,
      operator: opWorker ? displayName(opWorker) : undefined,
      operatorId: opWorker?.id ?? null,
    }]);
    setOpForm({ name: '', machine: '', hours: '', operatorId: '' });
  }

  function removeOperation(id: number) {
    setOperations((prev) => prev.filter((op) => op.id !== id));
  }

  function createOrder() {
    setMessage(null);
    setError(null);
    if (!orderNumber.trim() || !startDateTime) {
      setError(t.workOrders.missingFields);
      return;
    }
    const startMs = new Date(startDateTime).getTime();
    const endMs = startMs + totalHours * 60 * 60 * 1000;
    const end = new Date(endMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    const endLocal = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(
      end.getHours(),
    )}:${pad(end.getMinutes())}`;

    const selectedWorker = activeWorkers.find((worker) => worker.id === Number(operatorId));
    const draft = {
      id: -1,
      machine: operations.map((op) => op.machine).join(' → '),
      order: orderNumber.trim(),
      operator: selectedWorker ? displayName(selectedWorker) : '',
      operatorId: selectedWorker?.id ?? null,
      product: product.trim(),
      start: startDateTime,
      end: endLocal,
      status: 'planned' as const,
      progress: 0,
      color: '#2563eb',
      operations: operations.length > 0 ? operations : undefined,
      parentId: parentId ? Number(parentId) : undefined,
      comments: comments.trim(),
      materialStatus: 'ready' as const,
      setupHours: 0,
      priority,
    };
    const conflicts = getJobConflicts(draft);
    addJob(draft);

    setMessage(t.workOrders.created);
    setOrderNumber('');
    setProduct('');
    setOperatorId('');
    setPriority('normal');
    setComments('');
    setStartDateTime('');
    setParentId('');
    setOperations([]);
    setCadFile(null);
    setCadError(null);
    if (conflicts.machineOverlap || conflicts.operatorOverlap || conflicts.shiftOutside || conflicts.hoursExceeded || conflicts.unqualified) {
      setMessage(lang === 'hr' ? 'Nalog je kreiran uz upozorenja rasporeda. Provjerite vremenski plan.' : 'Order created with scheduling warnings. Review the timeline.');
    }
  }

  function restoreSnapshot(snapshotJobs: typeof jobs) {
    restoreBackup(snapshotJobs);
  }

  // Recursive tree view component
  function DocumentTreeNode({ job, level = 0 }: { job: typeof jobs[0]; level: number }) {
    const children = jobs.filter((j) => j.parentId === job.id);
    return (
      <div style={{ marginLeft: level * 20, borderLeft: level > 0 ? '1px dashed var(--border-color-strong)' : 'none', paddingLeft: level > 0 ? 15 : 0, marginTop: 8 }}>
        <div style={{ padding: '8px 12px', background: 'var(--bg-step)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border-color)' }}>
          <div>
            <span style={{ fontWeight: 700, color: 'var(--primary-color)' }}>📄 {job.order}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>({job.machine || 'General'})</span>
            {job.operator && <span style={{ fontSize: 11, background: 'var(--primary-light)', color: 'var(--primary-color)', padding: '2px 6px', borderRadius: 4, marginLeft: 8 }}>{job.operator}</span>}
          </div>
          <button className="btn btn-blue" onClick={() => setPrintOrderId(job.id)} style={{ padding: '4px 8px', fontSize: 11, width: 'auto' }}>
            <IconPrint style={{ width: 11, height: 11, marginRight: 4 }} />
            {t.workOrders.print}
          </button>
        </div>
        {children.map((child) => (
          <DocumentTreeNode key={child.id} job={child} level={level + 1} />
        ))}
      </div>
    );
  }

  const createdOrders = jobs.filter(
    (j) => (j.operations && j.operations.length > 0) || j.parentId !== undefined || hasChildren(jobs, j.id),
  );
  const search = orderSearch.trim().toLowerCase();
  const visibleOrders = search
    ? createdOrders.filter((job) =>
        job.order.toLowerCase().includes(search) ||
        (job.product ?? '').toLowerCase().includes(search) ||
        (job.operations ?? []).some((op) => op.name.toLowerCase().includes(search) || op.machine.toLowerCase().includes(search)))
    : createdOrders;

  /** Prefills the creation form with an existing order's product and operations route. */
  function duplicateOrder(id: number) {
    const source = jobs.find((job) => job.id === id);
    if (!source) return;
    setOrderNumber(`${source.order}-KOPIJA`);
    setProduct(source.product ?? '');
    setOperations((source.operations ?? []).map((op) => ({ ...op, id: nextOpId++ })));
    setCreatorTab('create');
    setMessage(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const printOrder = createdOrders.find((j) => j.id === printOrderId) ?? null;
  const printOpsTotal = printOrder?.operations?.reduce((s, op) => s + op.hours, 0) ?? 0;

  return (
    <>
    <div className="wizard-container no-print">
      <h2 style={{ marginBottom: 5 }}>{t.workOrders.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 13 }}>{t.workOrders.subtitle}</p>

      <div className="view-toggle" style={{ marginBottom: 20 }}>
        <button className={creatorTab === 'create' ? 'active' : ''} onClick={() => setCreatorTab('create')}>
          📐 {lang === 'hr' ? 'Izrada Naloga' : 'Create & Orders'}
        </button>
        <button className={creatorTab === 'timemachine' ? 'active' : ''} onClick={() => setCreatorTab('timemachine')}>
          ⏳ {lang === 'hr' ? 'Time Machine & Stablo' : 'Time Machine & Hierarchy'}
        </button>
      </div>

      {creatorTab === 'create' && (
        <>
        <div className="step-box">
        <div className="step-title">
          <span className="step-number">1</span>
          {t.workOrders.orderInfo}
        </div>
        <div className="grid-inputs time-settings">
          <div>
            <label>{t.workOrders.orderNumber}</label>
            <input type="text" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          </div>
          <div>
            <label>{t.workOrders.product}</label>
            <input type="text" value={product} onChange={(e) => setProduct(e.target.value)} />
          </div>
          <div>
            <label>{lang === 'hr' ? 'Dodijeljeni operater' : 'Assigned operator'}</label>
            <select value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
              <option value="">{lang === 'hr' ? 'Nije dodijeljen' : 'Unassigned'}</option>
              {activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{displayName(worker)} · {worker.qualifications.length ? worker.qualifications.join(', ') : (lang === 'hr' ? 'nema upisanih kvalifikacija' : 'no qualifications set')}</option>)}
            </select>
          </div>
          <div>
            <label>{lang === 'hr' ? 'Prioritet' : 'Priority'}</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)}>
              <option value="low">{lang === 'hr' ? 'Nizak' : 'Low'}</option>
              <option value="normal">{lang === 'hr' ? 'Normalan' : 'Normal'}</option>
              <option value="high">{lang === 'hr' ? 'Visok' : 'High'}</option>
              <option value="urgent">{lang === 'hr' ? 'Hitno' : 'Urgent'}</option>
            </select>
          </div>
          <div>
            <label>{t.workOrders.startDateTime}</label>
            <input
              type="datetime-local"
              value={startDateTime}
              onChange={(e) => setStartDateTime(e.target.value)}
            />
          </div>
          <div>
            <label>{t.workOrders.parentOrder}</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">{t.workOrders.noParent}</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.order || j.machine}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{lang === 'hr' ? 'Napomene' : 'Comments'}</label>
            <input type="text" value={comments} onChange={(e) => setComments(e.target.value)} placeholder={lang === 'hr' ? 'Materijal, tolerancije, prioritet…' : 'Material, tolerances, priority…'} />
          </div>
        </div>

        {/* CAD Blueprint Upload */}
        <div className="cad-upload-panel">
          <label className="premium-upload">
            <input type="file" accept=".stp,.step,.pdf" onChange={handleCadUpload} />
            <span className="premium-upload-icon">⌁</span>
            <span><strong>{lang === 'hr' ? 'Dodajte CAD nacrt' : 'Attach CAD blueprint'}</strong><small>.STEP, .STP ili .PDF · max 10 MB</small></span>
            <b>{lang === 'hr' ? 'Odaberi' : 'Choose'}</b>
          </label>
          {cadFile && (
            <div className="upload-file-success">
              <span>✓</span><strong>{cadFile.name}</strong><small>{(cadFile.size / 1024 / 1024).toFixed(2)} MB</small>
            </div>
          )}
          {cadError && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger-color)', fontWeight: 'bold' }}>
              ⚠️ {cadError}
            </div>
          )}
        </div>
      </div>

      <div className="step-box">
        <div className="step-title">
          <span className="step-number">2</span>
          {t.workOrders.buildRoute}
        </div>
        <div className="grid-inputs workers-ruster">
          <div>
            <label>{t.workOrders.operationName}</label>
            <input type="text" value={opForm.name} onChange={(e) => setOpForm({ ...opForm, name: e.target.value })} />
          </div>
          <div>
            <label>{t.workOrders.operationMachine}</label>
            <input
              type="text"
              value={opForm.machine}
              onChange={(e) => setOpForm({ ...opForm, machine: e.target.value })}
            />
          </div>
          <div>
            <label>{t.workOrders.operationHours}</label>
            <input
              type="number"
              min={0}
              step="0.5"
              value={opForm.hours}
              onChange={(e) => setOpForm({ ...opForm, hours: e.target.value })}
            />
          </div>
          <div>
            <label>{lang === 'hr' ? 'Operater (korak)' : 'Operator (step)'}</label>
            <select value={opForm.operatorId} onChange={(e) => setOpForm({ ...opForm, operatorId: e.target.value })}>
              <option value="">{lang === 'hr' ? 'Nije dodijeljen' : 'Unassigned'}</option>
              {activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{displayName(worker)}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-blue" onClick={addOperation} style={{ width: '100%' }}>
              <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
              {t.workOrders.addOperation}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 15 }}>
          {operations.length === 0 ? (
            <p className="subtitle-text" style={{ fontSize: 13 }}>{t.workOrders.noOperations}</p>
          ) : (
            <div className="flow-row">
              {operations.map((op, i) => (
                <div key={op.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <div className="flow-block">
                    <button className="flow-remove" onClick={() => removeOperation(op.id)} title="Remove">
                      <IconTrash style={{ width: 10, height: 10 }} />
                    </button>
                    <div className="flow-name">{op.name}</div>
                    <div className="flow-meta">{op.machine}</div>
                    <div className="flow-meta">{op.hours} h</div>
                    {op.operator && <div className="flow-meta">👤 {op.operator}</div>}
                  </div>
                  {i < operations.length - 1 && (
                    <span className="flow-arrow">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {operations.length > 0 && (
            <p style={{ fontSize: 13, marginTop: 10 }}>
              <strong>{t.workOrders.totalHours}:</strong> {totalHours} h
            </p>
          )}
        </div>
      </div>

      <div className="action-bar">
        <button className="btn btn-green" onClick={createOrder}>
          <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
          {t.workOrders.createOrder}
        </button>
      </div>
      {message && <p style={{ color: 'var(--success-color)', fontSize: 13, marginTop: 10 }}>{message}</p>}
      {error && <p style={{ color: 'var(--danger-color)', fontSize: 13, marginTop: 10 }}>{error}</p>}

      <div className="step-box" style={{ marginTop: 20 }}>
        <div className="step-title" style={{ justifyContent: 'space-between' }}>
          <span>{t.workOrders.createdOrders}</span>
          <input
            type="text"
            value={orderSearch}
            onChange={(event) => setOrderSearch(event.target.value)}
            placeholder={lang === 'hr' ? 'Traži po broju, proizvodu ili operaciji…' : 'Search by number, product, or operation…'}
            style={{ width: 'min(280px, 50%)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}
          />
        </div>
        {visibleOrders.length === 0 ? (
          <p className="subtitle-text" style={{ fontSize: 13 }}>{t.workOrders.noCreatedOrders}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.workOrders.orderNumber}</th>
                  <th>{t.workOrders.product}</th>
                  <th>{t.workOrders.buildRoute}</th>
                  <th>{lang === 'hr' ? 'Prioritet' : 'Priority'}</th>
                  <th>{t.common.status}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((job) => {
                  const parent = jobs.find((p) => p.id === job.parentId);
                  return (
                  <tr key={job.id}>
                    <td>
                      {parent && <span className="subtitle-text" style={{ fontSize: 11 }}>{parent.order} → </span>}
                      {job.order}
                    </td>
                    <td>{job.product || '-'}</td>
                    <td>{job.operations?.map((op) => op.name).join(' → ') || '-'}</td>
                    <td>
                      <span style={{ background: priorityMeta(job.priority).color, color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                        {priorityLabel(job.priority, lang)}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill status-${job.status}`}>
                        {t.progress.statusOptions[job.status]}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-blue btn-sm"
                          onClick={() => setPrintOrderId(job.id)}
                        >
                          <IconPrint style={{ marginRight: 4, verticalAlign: -2, width: 12, height: 12 }} />
                          {t.workOrders.print}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          title={lang === 'hr' ? 'Kopiraj rutu u novi nalog' : 'Copy this route into a new order'}
                          onClick={() => duplicateOrder(job.id)}
                        >
                          {lang === 'hr' ? 'Dupliciraj' : 'Duplicate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
    )}

      {creatorTab === 'timemachine' && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 15 }}>
          {/* Tree View (Left Pane) */}
          <div className="step-box" style={{ flex: 1.3, minWidth: 320, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', padding: 24 }}>
            <div className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 15 }}>
              🌳 {lang === 'hr' ? 'Stablo Radnih Naloga' : 'Work Order Hierarchy Tree'}
            </div>
            <p className="subtitle-text" style={{ marginBottom: 15, fontSize: 12 }}>
              {lang === 'hr' ? 'Prikaz odnosa nadređenih i podređenih naloga:' : 'View nested relationships of parent and child work orders:'}
            </p>
            {jobs.filter(j => !j.parentId).length === 0 ? (
              <p className="subtitle-text" style={{ fontSize: 13 }}>{lang === 'hr' ? 'Nema kreiranih dokumenata.' : 'No documents created yet.'}</p>
            ) : (
              jobs.filter(j => !j.parentId).map((rootJob) => (
                <DocumentTreeNode key={rootJob.id} job={rootJob} level={0} />
              ))
            )}
          </div>

          {/* Time Machine Archive (Right Pane) */}
          <div className="step-box" style={{ flex: 1, minWidth: 300, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', padding: 24 }}>
            <div className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 15 }}>
              ⏳ {lang === 'hr' ? 'Time Machine Sigurnosne Kopije' : 'Time Machine Snapshots'}
            </div>
            <p className="subtitle-text" style={{ marginBottom: 15, fontSize: 12 }}>
              {lang === 'hr' ? 'Vratite sustav i dokumente na bilo koju točku u vremenu:' : 'Restore database states and active documents to any past backup point:'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 400, overflowY: 'auto', paddingRight: 5 }}>
              {backups.length === 0 ? (
                <p className="subtitle-text" style={{ fontSize: 12 }}>{lang === 'hr' ? 'Nema snimljenih sigurnosnih kopija.' : 'No snapshots recorded yet.'}</p>
              ) : (
                backups.map((snap, idx) => (
                  <div key={idx} style={{ padding: 12, background: 'var(--bg-step)', borderRadius: 8, border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{snap.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{new Date(snap.timestamp).toLocaleString()}</div>
                    </div>
                    <button className="btn btn-blue" onClick={() => restoreSnapshot(snap.jobs)} style={{ padding: '6px 10px', fontSize: 11, width: 'auto' }}>
                      ⏳ {lang === 'hr' ? 'Vrati' : 'Restore'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>

    {printOrder && (
      <div className="print-preview-scroll">
        <div className="print-document">
          <table className="header-table">
            <tbody>
              <tr>
                <td>
                  <h1 className="doc-title">{t.workOrders.printTitle}</h1>
                  <p className="subtitle-text" style={{ fontSize: 11, marginTop: 4 }}>ID: {printOrder.id}</p>
                </td>
                <td className="logo-container" style={{ textAlign: 'right', display: 'flex', gap: 12, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {/* Mock Barcode */}
                  <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                    <svg width="120" height="35" viewBox="0 0 100 40" style={{ background: 'white' }}>
                      <rect x="0" y="0" width="3" height="35" fill="black" />
                      <rect x="5" y="0" width="1" height="35" fill="black" />
                      <rect x="8" y="0" width="2" height="35" fill="black" />
                      <rect x="13" y="0" width="4" height="35" fill="black" />
                      <rect x="19" y="0" width="1" height="35" fill="black" />
                      <rect x="22" y="0" width="3" height="35" fill="black" />
                      <rect x="27" y="0" width="2" height="35" fill="black" />
                      <rect x="32" y="0" width="4" height="35" fill="black" />
                      <rect x="38" y="0" width="1" height="35" fill="black" />
                      <rect x="42" y="0" width="3" height="35" fill="black" />
                      <rect x="47" y="0" width="2" height="35" fill="black" />
                      <rect x="52" y="0" width="4" height="35" fill="black" />
                      <rect x="58" y="0" width="1" height="35" fill="black" />
                      <rect x="62" y="0" width="3" height="35" fill="black" />
                      <rect x="67" y="0" width="2" height="35" fill="black" />
                      <rect x="72" y="0" width="4" height="35" fill="black" />
                      <rect x="78" y="0" width="1" height="35" fill="black" />
                      <rect x="82" y="0" width="3" height="35" fill="black" />
                      <rect x="87" y="0" width="2" height="35" fill="black" />
                      <rect x="92" y="0" width="4" height="35" fill="black" />
                    </svg>
                    <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'black', marginTop: 2 }}>*{printOrder.order}*</span>
                  </div>
                  {/* Mock QR */}
                  <svg width="45" height="45" viewBox="0 0 29 29" style={{ background: 'white', padding: 2, border: '1px solid #cbd5e1', borderRadius: 4 }}>
                    <path d="M0 0h7v7H0zm0 22h7v7H0zm22 0h7v7h-7zM2 2h3v3H2zm0 22h3v3H2zm22 0h3v3h-3z" fill="black" />
                    <path d="M10 0h2v4h-2zm3 2h4v2h-4zm2 5h4v2h-4zM0 10h4v2H0zm5 1h3v3H5zm6 2h4v2h-4zm3-5h2v4h-2zm12 5h3v4h-3zm-5 6h4v2h-4zm3 4h3v2h-3z" fill="black" />
                  </svg>
                  {logo ? <img src={logo} className="logo-img" alt="Logo" style={{ maxHeight: 45 }} /> : null}
                </td>
              </tr>
            </tbody>
          </table>

          <table className="meta-table">
            <tbody>
              <tr>
                <td className="meta-label">{t.workOrders.orderNumber.toUpperCase()}:</td>
                <td className="meta-value">{printOrder.order}</td>
              </tr>
              <tr>
                <td className="meta-label">{t.workOrders.product.toUpperCase()}:</td>
                <td className="meta-value">{printOrder.product || '-'}</td>
              </tr>
              <tr>
                <td className="meta-label">{t.common.start.toUpperCase()}:</td>
                <td className="meta-value">{formatDateTime(printOrder.start)}</td>
              </tr>
              <tr>
                <td className="meta-label">{t.common.end.toUpperCase()}:</td>
                <td className="meta-value">{formatDateTime(printOrder.end)}</td>
              </tr>
              <tr>
                <td className="meta-label">{t.common.status.toUpperCase()}:</td>
                <td className="meta-value">{t.progress.statusOptions[printOrder.status]}</td>
              </tr>
              <tr>
                <td className="meta-label">{t.common.documentDate.toUpperCase()}:</td>
                <td className="meta-value">{formatDate(new Date())}</td>
              </tr>
            </tbody>
          </table>

          <table className="meta-table">
            <thead>
              <tr>
                <th className="meta-label">{t.workOrders.opNumber}</th>
                <th className="meta-label">{t.workOrders.operationName}</th>
                <th className="meta-label">{t.workOrders.operationMachine}</th>
                <th className="meta-label">{t.workOrders.operationHours}</th>
              </tr>
            </thead>
            <tbody>
              {printOrder.operations?.map((op, i) => (
                <tr key={op.id}>
                  <td className="meta-value">{i + 1}</td>
                  <td className="meta-value">{op.name}</td>
                  <td className="meta-value">{op.machine}</td>
                  <td className="meta-value">{op.hours} h</td>
                </tr>
              ))}
              <tr>
                <td className="meta-value" colSpan={3} style={{ textAlign: 'right', fontWeight: 'bold' }}>
                  {t.workOrders.totalHours}:
                </td>
                <td className="meta-value" style={{ fontWeight: 'bold' }}>
                  {printOpsTotal} h
                </td>
              </tr>
            </tbody>
          </table>

          <div className="action-bar no-print" style={{ borderTop: 'none', marginTop: 20 }}>
            <button className="btn btn-blue" onClick={() => window.print()}>
              <IconPrint style={{ marginRight: 6, verticalAlign: -3 }} />
              {t.workOrders.print}
            </button>
            <button className="btn btn-red" onClick={() => setPrintOrderId(null)}>
              {t.workOrders.closePreview}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
