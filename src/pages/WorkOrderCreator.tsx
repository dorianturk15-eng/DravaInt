import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus, IconTrash, IconPrint, IconAlert, IconList, IconFlow, IconUser, IconGantt, IconRefresh } from '../components/Icons';
import { useScheduling, type Job, type OperationStep, type JobPriority } from '../scheduling/SchedulingContext';
import { hasChildren, collectDescendants } from '../scheduling/hierarchy';
import { useLogo } from '../logo/LogoContext';
import { useWorkers } from '../workers/WorkersContext';
import { useMachines } from '../machines/MachinesContext';
import { buildMachineLookup, resolveMachineId } from '../scheduling/machineIdentity';
import { priorityLabel, priorityMeta } from '../scheduling/priority';
import { suggestOrderNumber } from '../scheduling/orderNumber';

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
  const { jobs, loading, addJob, updateJob, restoreBackup, getJobConflicts } = useScheduling();
  const { logo } = useLogo();
  const { activeWorkers, displayName } = useWorkers();
  const { machines } = useMachines();
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
  // Next id in the shop's RN-YYYY-NNN convention, derived from the live job list. Filled in
  // only on explicit request (the Generiraj button) — the field itself stays free-form.
  const suggestedOrder = useMemo(() => suggestOrderNumber(jobs.map((job) => job.order)), [jobs]);
  const [product, setProduct] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [priority, setPriority] = useState<JobPriority>('normal');
  const [comments, setComments] = useState('');
  const [startDateTime, setStartDateTime] = useState('');
  const [parentId, setParentId] = useState('');

  const [operations, setOperations] = useState<OperationStep[]>([]);
  const [opForm, setOpForm] = useState({ name: '', machine: '', hours: '', operatorId: '' });
  const [orderSearch, setOrderSearch] = useState('');

  // Edit mode: the id of an existing order loaded into the form. Saving updates that row via
  // updateJob (optimistic-locked) instead of inserting a duplicate.
  const [editingJobId, setEditingJobId] = useState<number | null>(null);
  // The route step currently loaded into the operation form for in-place editing.
  const [editingOpId, setEditingOpId] = useState<number | null>(null);

  // Deep link from other pages (e.g. Praćenje napretka): /workOrders?edit=<id> opens that order
  // in edit mode once the job list is available, then strips the param so refresh/back stays clean.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const editParam = searchParams.get('edit');
    if (!editParam) return;
    const id = Number(editParam);
    if (!jobs.some((job) => job.id === id)) {
      if (loading) return; // jobs still loading — retry when they arrive
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({}, { replace: true });
    startEdit(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, jobs, loading]);

  const editingJob = editingJobId !== null ? (jobs.find((job) => job.id === editingJobId) ?? null) : null;
  // A job can't become its own descendant's child — exclude the edited order and its subtree from
  // the parent selector.
  const blockedParentIds = useMemo(
    () => (editingJobId !== null ? collectDescendants(jobs, editingJobId) : new Set<number>()),
    [jobs, editingJobId],
  );

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

  /** Adds a new route step, or — when a step is loaded via editOperation — saves it in place. */
  function addOperation() {
    const hours = parseFloat(opForm.hours);
    if (!opForm.name || !opForm.machine || !hours || hours <= 0) return;
    const opWorker = activeWorkers.find((worker) => worker.id === Number(opForm.operatorId));
    // Phase C: record the machine's stable id (source of truth) alongside its display name, so a
    // later rename in Admin can't orphan this step. Unregistered free-text names resolve to null and
    // surface in the Admin "unmapped machines" report.
    const machineId = resolveMachineId(opForm.machine, null, buildMachineLookup(machines));
    const step = {
      name: opForm.name,
      machine: opForm.machine,
      machineId,
      hours,
      operator: opWorker ? displayName(opWorker) : undefined,
      operatorId: opWorker?.id ?? null,
    };
    if (editingOpId !== null) {
      setOperations((prev) => prev.map((op) => (op.id === editingOpId ? { ...op, ...step } : op)));
      setEditingOpId(null);
    } else {
      setOperations((prev) => [...prev, { id: nextOpId++, ...step }]);
    }
    setOpForm({ name: '', machine: '', hours: '', operatorId: '' });
  }

  function removeOperation(id: number) {
    setOperations((prev) => prev.filter((op) => op.id !== id));
    if (editingOpId === id) {
      setEditingOpId(null);
      setOpForm({ name: '', machine: '', hours: '', operatorId: '' });
    }
  }

  /** Loads an existing route step into the operation form for in-place editing. */
  function editOperation(id: number) {
    const op = operations.find((item) => item.id === id);
    if (!op) return;
    setEditingOpId(id);
    setOpForm({
      name: op.name,
      machine: op.machine,
      hours: String(op.hours),
      operatorId: op.operatorId != null ? String(op.operatorId) : '',
    });
  }

  function moveOperation(id: number, delta: -1 | 1) {
    setOperations((prev) => {
      const index = prev.findIndex((op) => op.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function resetForm() {
    setOrderNumber('');
    setProduct('');
    setOperatorId('');
    setPriority('normal');
    setComments('');
    setStartDateTime('');
    setParentId('');
    setOperations([]);
    setOpForm({ name: '', machine: '', hours: '', operatorId: '' });
    setEditingOpId(null);
    setCadFile(null);
    setCadError(null);
  }

  /** Loads an existing order into the form; saving then updates that row instead of inserting. */
  function startEdit(id: number) {
    const source = jobs.find((job) => job.id === id);
    if (!source) return;
    setEditingJobId(id);
    setOrderNumber(source.order);
    setProduct(source.product ?? '');
    setOperatorId(source.operatorId != null ? String(source.operatorId) : '');
    setPriority(source.priority ?? 'normal');
    setComments(source.comments ?? '');
    setStartDateTime(source.start ? source.start.slice(0, 16) : '');
    setParentId(source.parentId != null ? String(source.parentId) : '');
    const ops = (source.operations ?? []).map((op) => ({ ...op }));
    // Keep original step ids (stable Gantt op ids) but make sure newly added steps can't collide.
    nextOpId = Math.max(nextOpId, ...ops.map((op) => op.id + 1));
    setOperations(ops);
    setOpForm({ name: '', machine: '', hours: '', operatorId: '' });
    setEditingOpId(null);
    setCadFile(null);
    setCadError(null);
    setCreatorTab('create');
    setMessage(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingJobId(null);
    resetForm();
    setMessage(null);
    setError(null);
  }

  async function submitOrder() {
    setMessage(null);
    setError(null);
    const original = editingJobId !== null ? jobs.find((job) => job.id === editingJobId) : undefined;
    const isEdit = editingJobId !== null;
    if (isEdit && !original) {
      setError(lang === 'hr' ? 'Nalog koji uređujete više ne postoji (uklonjen je na drugom terminalu).' : 'The order being edited no longer exists (it was removed on another terminal).');
      return;
    }
    // Container/plain orders (parents with children, no route of their own) may legitimately have
    // zero operations — only require a route where one existed or is being created from scratch.
    const requiresOps = !isEdit || Boolean(original?.operations?.length);
    if (!orderNumber.trim() || (requiresOps && operations.length === 0)) {
      setError(t.workOrders.missingFields);
      return;
    }
    if (!startDateTime) {
      setError(t.workOrders.missingStartDateTime);
      return;
    }
    const startMs = new Date(startDateTime).getTime();
    // A route derives its end from the summed step hours; an op-less order keeps its own duration.
    const originalDurationMs = original ? Math.max(0, new Date(original.end).getTime() - new Date(original.start).getTime()) : 0;
    const endMs = operations.length > 0 ? startMs + totalHours * 60 * 60 * 1000 : startMs + (isNaN(originalDurationMs) ? 0 : originalDurationMs);
    const end = new Date(endMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    const endLocal = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(
      end.getHours(),
    )}:${pad(end.getMinutes())}`;

    const selectedWorker = activeWorkers.find((worker) => worker.id === Number(operatorId));
    // On routed orders the top-level `operator` is often a product/assembly label, not a person.
    // Preserve it unless the planner actually picked (or had picked) a worker in the selector.
    const keepOperatorLabel = isEdit && !selectedWorker && original!.operatorId == null;
    const operatorName = keepOperatorLabel ? original!.operator : (selectedWorker ? displayName(selectedWorker) : '');
    const operatorIdValue = keepOperatorLabel ? null : (selectedWorker?.id ?? null);
    const machineChain = operations.length > 0 ? operations.map((op) => op.machine).join(' → ') : (original?.machine ?? '');

    const draft: Job = {
      id: editingJobId ?? -1,
      machine: machineChain,
      order: orderNumber.trim(),
      operator: operatorName,
      operatorId: operatorIdValue,
      product: product.trim(),
      start: startDateTime,
      end: endLocal,
      status: original?.status ?? ('planned' as const),
      progress: original?.progress ?? 0,
      color: original?.color ?? '#2563eb',
      operations: operations.length > 0 ? operations : undefined,
      parentId: parentId ? Number(parentId) : undefined,
      comments: comments.trim(),
      materialStatus: original?.materialStatus ?? ('ready' as const),
      setupHours: original?.setupHours ?? 0,
      priority,
    };
    // Same conflict engine as creation: the draft carries the edited id so the order's own current
    // booking doesn't collide with itself.
    const conflicts = getJobConflicts(draft);
    // Await the write and honour its result: a DB rejection (double-booking DR001, RLS denial, a
    // schema mismatch) or a version conflict must NOT show the green success banner. Only a real
    // success (or a safely-queued offline write) clears the form.
    const result = isEdit
      ? await updateJob(editingJobId!, {
          machine: machineChain,
          order: orderNumber.trim(),
          operator: operatorName,
          operatorId: operatorIdValue,
          product: product.trim(),
          start: startDateTime,
          end: endLocal,
          ...(operations.length > 0 ? { operations } : {}),
          parentId: parentId ? Number(parentId) : null,
          comments: comments.trim(),
          priority,
        })
      : await addJob(draft);
    if (!result.ok && (result.reason === 'rejected' || result.reason === 'version-conflict')) {
      setError(result.reason === 'rejected'
        ? (result.message || (lang === 'hr' ? 'Baza je odbila nalog (npr. dvostruka rezervacija termina). Nalog nije spremljen.' : 'The database rejected the order (e.g. a double-booked slot). Nothing was saved.'))
        : (lang === 'hr' ? 'Nalog je u međuvremenu izmijenjen na drugom terminalu. Osvježite i pokušajte ponovno.' : 'This order was changed on another terminal meanwhile. Refresh and try again.'));
      return; // keep the form intact so the planner can correct and resubmit
    }

    setMessage(result.ok
      ? (isEdit ? t.workOrders.updated : t.workOrders.created)
      : (lang === 'hr' ? 'Izvan mreže — nalog je spremljen u red čekanja i sinkronizirat će se po povratku veze.' : 'Offline — the order was queued and will sync when the connection returns.'));
    resetForm();
    setEditingJobId(null);
    if (result.ok && (conflicts.machineOverlap || conflicts.operatorOverlap || conflicts.shiftOutside || conflicts.hoursExceeded || conflicts.unqualified)) {
      setMessage(isEdit
        ? (lang === 'hr' ? 'Izmjene su spremljene uz upozorenja rasporeda. Provjerite vremenski plan.' : 'Changes saved with scheduling warnings. Review the timeline.')
        : (lang === 'hr' ? 'Nalog je kreiran uz upozorenja rasporeda. Provjerite vremenski plan.' : 'Order created with scheduling warnings. Review the timeline.'));
    }
  }

  function restoreSnapshot(snapshotJobs: typeof jobs) {
    restoreBackup(snapshotJobs);
  }

  // Recursive tree view component
  function DocumentTreeNode({ job, level = 0 }: { job: typeof jobs[0]; level: number }) {
    const children = jobs.filter((j) => j.parentId === job.id);
    return (
      <div className={`woc-tree-row${level > 0 ? ' is-nested' : ''}`} style={{ '--tree-level': level } as React.CSSProperties}>
        <div className="woc-tile is-compact">
          <div>
            <span className="text-accent-strong"><IconList className="inline-icon-sm icon-xs" /> {job.order}</span>
            <span className="text-xs-muted has-inset">({job.machine || 'General'})</span>
            {job.operator && <span className="woc-chip">{job.operator}</span>}
          </div>
          <button className="btn btn-blue btn-mini" onClick={() => setPrintOrderId(job.id)}>
            <IconPrint className="icon-xs has-gap-r" />
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
    setEditingJobId(null); // duplicating always creates a new order, even mid-edit
    setEditingOpId(null);
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
      <h2 className="mb-xs">{t.workOrders.title}</h2>
      <p className="subtitle-text text-md woc-lead">{t.workOrders.subtitle}</p>

      <div className="view-toggle stack-gap">
        <button className={creatorTab === 'create' ? 'active' : ''} onClick={() => setCreatorTab('create')}>
          <IconFlow className="panel-title-icon" /> {lang === 'hr' ? 'Izrada Naloga' : 'Create & Orders'}
        </button>
        <button className={creatorTab === 'timemachine' ? 'active' : ''} onClick={() => setCreatorTab('timemachine')}>
          <IconRefresh className="panel-title-icon" /> {lang === 'hr' ? 'Time Machine & Stablo' : 'Time Machine & Hierarchy'}
        </button>
      </div>

      {creatorTab === 'create' && (
        <>
        {editingJob && (
          <div className="step-box woc-callout">
            <div>
              <strong className="text-accent">✏️ {t.workOrders.editingOrder}: {editingJob.order}</strong>
              <div className="subtitle-text text-sm has-gap-xs">
                {lang === 'hr' ? 'Spremanjem se ažurira postojeći nalog — ne stvara se kopija.' : 'Saving updates the existing order — no copy is created.'}
              </div>
            </div>
            <button className="btn btn-ghost btn-inline" onClick={cancelEdit}>
              {t.workOrders.cancelEdit}
            </button>
          </div>
        )}
        <div className="step-box">
        <div className="step-title">
          <span className="step-number">1</span>
          {t.workOrders.orderInfo}
        </div>
        <div className="grid-inputs time-settings">
          <div>
            <label>{t.workOrders.orderNumber}</label>
            <div className="row-gap-sm">
              <input type="text" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder={suggestedOrder} className="flex-1-min" />
              <button type="button" className="btn btn-ghost nowrap" onClick={() => setOrderNumber(suggestedOrder)} title={lang === 'hr' ? `Sljedeći broj: ${suggestedOrder}` : `Next number: ${suggestedOrder}`}>
                {lang === 'hr' ? 'Generiraj' : 'Generate'}
              </button>
            </div>
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
            <label>{t.workOrders.startDateTime} *</label>
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
              {jobs.filter((j) => j.id !== editingJobId && !blockedParentIds.has(j.id)).map((j) => (
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
            <div className="woc-error">
              <IconAlert className="panel-title-icon" /> {cadError}
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
              list="wo-machine-options"
              value={opForm.machine}
              onChange={(e) => setOpForm({ ...opForm, machine: e.target.value })}
            />
            <datalist id="wo-machine-options">
              {machines.map((machine) => <option key={machine.id} value={machine.name} />)}
            </datalist>
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
          <div className="row-end-tight">
            <button className="btn btn-blue w-full" onClick={addOperation}>
              <IconPlus className="inline-icon" />
              {editingOpId !== null ? (lang === 'hr' ? 'Spremi korak' : 'Save step') : t.workOrders.addOperation}
            </button>
            {editingOpId !== null && (
              <button
                className="btn btn-ghost btn-inline nowrap"
                onClick={() => { setEditingOpId(null); setOpForm({ name: '', machine: '', hours: '', operatorId: '' }); }}
              >
                {lang === 'hr' ? 'Odustani' : 'Cancel'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-md">
          {operations.length === 0 ? (
            <p className="subtitle-text text-md">{t.workOrders.noOperations}</p>
          ) : (
            <div className="flow-row">
              {operations.map((op, i) => (
                <div key={op.id} className="row-center">
                  <div className="flow-block" style={editingOpId === op.id ? { outline: '2px solid var(--primary-color)', outlineOffset: 1 } : undefined}>
                    <button className="flow-remove" onClick={() => removeOperation(op.id)} title="Remove">
                      <IconTrash className="icon-xxs" />
                    </button>
                    <div className="flow-name">{op.name}</div>
                    <div className="flow-meta">{op.machine}</div>
                    <div className="flow-meta">{op.hours} h</div>
                    {op.operator && <div className="flow-meta"><IconUser className="inline-icon-sm icon-xs" /> {op.operator}</div>}
                    <div className="row-center-tight">
                      <button
                        className="btn btn-ghost btn-micro"
                        onClick={() => moveOperation(op.id, -1)}
                        disabled={i === 0}
                        title={lang === 'hr' ? 'Pomakni ranije u slijedu' : 'Move earlier in the sequence'}
                        aria-label={lang === 'hr' ? `Pomakni "${op.name}" ranije` : `Move "${op.name}" earlier`}
                      >
                        ◀
                      </button>
                      <button
                        className="btn btn-ghost btn-micro"
                        onClick={() => editOperation(op.id)}
                        title={lang === 'hr' ? 'Uredi korak' : 'Edit step'}
                        aria-label={lang === 'hr' ? `Uredi korak "${op.name}"` : `Edit step "${op.name}"`}
                      >
                        ✎
                      </button>
                      <button
                        className="btn btn-ghost btn-micro"
                        onClick={() => moveOperation(op.id, 1)}
                        disabled={i === operations.length - 1}
                        title={lang === 'hr' ? 'Pomakni kasnije u slijedu' : 'Move later in the sequence'}
                        aria-label={lang === 'hr' ? `Pomakni "${op.name}" kasnije` : `Move "${op.name}" later`}
                      >
                        ▶
                      </button>
                    </div>
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
            <p className="woc-status">
              <strong>{t.workOrders.totalHours}:</strong> {totalHours} h
            </p>
          )}
        </div>
      </div>

      <div className="action-bar">
        <button className="btn btn-green" onClick={submitOrder}>
          <IconPlus className="inline-icon" />
          {editingJob ? t.workOrders.saveChanges : t.workOrders.createOrder}
        </button>
        {editingJob && (
          <button className="btn btn-ghost" onClick={cancelEdit}>
            {t.workOrders.cancelEdit}
          </button>
        )}
      </div>
      {message && <p className="woc-status is-success">{message}</p>}
      {error && <p className="woc-status is-error">{error}</p>}

      <div className="step-box mt-lg">
        <div className="step-title justify-between">
          <span>{t.workOrders.createdOrders}</span>
          <input
            type="text"
            value={orderSearch}
            onChange={(event) => setOrderSearch(event.target.value)}
            placeholder={lang === 'hr' ? 'Traži po broju, proizvodu ili operaciji…' : 'Search by number, product, or operation…'}
            className="woc-secondary-action"
          />
        </div>
        {visibleOrders.length === 0 ? (
          <p className="subtitle-text text-md">{t.workOrders.noCreatedOrders}</p>
        ) : (
          <div className="table-scroll">
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
                      {parent && <span className="subtitle-text text-xs">{parent.order} → </span>}
                      {job.order}
                    </td>
                    <td>{job.product || '-'}</td>
                    <td>{job.operations?.map((op) => op.name).join(' → ') || '-'}</td>
                    <td>
                      <span className="woc-priority-chip" style={{ '--chip-color': priorityMeta(job.priority).color } as React.CSSProperties}>
                        {priorityLabel(job.priority, lang)}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill status-${job.status}`}>
                        {t.progress.statusOptions[job.status]}
                      </span>
                    </td>
                    <td>
                      <div className="row-gap-xs">
                        <button
                          className="btn btn-blue btn-sm"
                          onClick={() => setPrintOrderId(job.id)}
                        >
                          <IconPrint className="icon-xs inline-icon-sm" />
                          {t.workOrders.print}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          title={lang === 'hr' ? 'Uredi postojeći nalog (podaci, ruta, operateri)' : 'Edit this order (details, route, operators)'}
                          onClick={() => startEdit(job.id)}
                        >
                          {t.workOrders.edit}
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
        <div className="woc-columns">
          {/* Tree View (Left Pane) */}
          <div className="step-box woc-panel is-primary">
            <div className="step-title woc-section-title">
              <IconGantt className="panel-title-icon" /> {lang === 'hr' ? 'Stablo Radnih Naloga' : 'Work Order Hierarchy Tree'}
            </div>
            <p className="subtitle-text woc-note">
              {lang === 'hr' ? 'Prikaz odnosa nadređenih i podređenih naloga:' : 'View nested relationships of parent and child work orders:'}
            </p>
            {jobs.filter(j => !j.parentId).length === 0 ? (
              <p className="subtitle-text text-md">{lang === 'hr' ? 'Nema kreiranih dokumenata.' : 'No documents created yet.'}</p>
            ) : (
              jobs.filter(j => !j.parentId).map((rootJob) => (
                <DocumentTreeNode key={rootJob.id} job={rootJob} level={0} />
              ))
            )}
          </div>

          {/* Time Machine Archive (Right Pane) */}
          <div className="step-box woc-panel">
            <div className="step-title woc-section-title">
              <IconRefresh className="panel-title-icon" /> {lang === 'hr' ? 'Time Machine Sigurnosne Kopije' : 'Time Machine Snapshots'}
            </div>
            <p className="subtitle-text woc-note">
              {lang === 'hr' ? 'Vratite sustav i dokumente na bilo koju točku u vremenu:' : 'Restore database states and active documents to any past backup point:'}
            </p>

            <div className="woc-scroll-list">
              {backups.length === 0 ? (
                <p className="subtitle-text text-sm">{lang === 'hr' ? 'Nema snimljenih sigurnosnih kopija.' : 'No snapshots recorded yet.'}</p>
              ) : (
                backups.map((snap, idx) => (
                  <div key={idx} className="woc-tile">
                    <div>
                      <div className="text-sm-strong">{snap.label}</div>
                      <div className="text-xxs-muted">{new Date(snap.timestamp).toLocaleString()}</div>
                    </div>
                    <button className="btn btn-blue btn-mini is-md" onClick={() => restoreSnapshot(snap.jobs)}>
                      <IconRefresh className="inline-icon-sm icon-xs" /> {lang === 'hr' ? 'Vrati' : 'Restore'}
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
