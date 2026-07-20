import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus } from '../components/Icons';
import { useScheduling } from '../scheduling/SchedulingContext';
import { useMachines } from '../machines/MachinesContext';
import { useWorkers } from '../workers/WorkersContext';
import { buildMachineLookup, resolveMachineId } from '../scheduling/machineIdentity';
import { MachineBoard } from '../components/machine-board/MachineBoard';

export default function MachineSchedule() {
  const { t, lang } = useLanguage();
  const { addJob } = useScheduling();
  const { machines } = useMachines();
  const { activeWorkers, displayName } = useWorkers();

  const [form, setForm] = useState({ machine: '', order: '', operator: '', operatorId: null as number | null, start: '', end: '' });
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function handleAdd() {
    if (!form.machine || !form.order) return;
    setFeedback(null);
    // Write the modern single-operation shape (carries machineId) rather than a legacy route-less job,
    // so the board's own manual-add path produces the same data Phases C/D expect. Hours come from the
    // start/end span; a missing end defaults to an 8 h block.
    const startMs = form.start ? new Date(form.start).getTime() : Date.now();
    const endMs = form.end ? new Date(form.end).getTime() : startMs + 8 * 3_600_000;
    const hours = Math.max(0.25, (endMs - startMs) / 3_600_000);
    const machineId = resolveMachineId(form.machine, null, buildMachineLookup(machines));
    // Honour the write result: a rejected/version-conflict write must not silently look successful.
    const result = await addJob({
      ...form,
      operations: [{ id: 1, name: form.order, machine: form.machine, machineId, hours, operator: form.operator, operatorId: form.operatorId }],
    });
    if (!result.ok && (result.reason === 'rejected' || result.reason === 'version-conflict')) {
      setFeedback({ tone: 'error', text: result.reason === 'rejected'
        ? (result.message || (lang === 'hr' ? 'Baza je odbila nalog (npr. zauzet termin). Nalog nije spremljen.' : 'The database rejected the job (e.g. a booked slot). Nothing was saved.'))
        : (lang === 'hr' ? 'Nalog je izmijenjen drugdje. Pokušajte ponovno.' : 'The job changed elsewhere. Please try again.') });
      return; // keep the form so it can be corrected
    }
    setFeedback({ tone: 'ok', text: result.ok
      ? (lang === 'hr' ? 'Nalog dodan.' : 'Job added.')
      : (lang === 'hr' ? 'Izvan mreže — nalog je u redu čekanja.' : 'Offline — job queued to sync later.') });
    setForm({ machine: '', order: '', operator: '', operatorId: null, start: '', end: '' });
  }

  return (
    <div className="wizard-container">
      <h2 className="mb-xs">{t.machines.title}</h2>
      <p className="subtitle-text text-md woc-lead">{t.machines.subtitle}</p>

      <details className="step-box board-add-manually">
        <summary className="step-title">
          <span className="step-number">1</span>
          {t.machines.addJob} · {t.machineBoard.addManually}
        </summary>
        <div className="grid-inputs workers-ruster">
          <div>
            <label>{t.machines.machine}</label>
            <select value={form.machine} onChange={(e) => setForm({ ...form, machine: e.target.value })}>
              <option value="">{t.machines.selectMachine}</option>
              {machines.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name} ({m.type === 'mill' ? t.machines.typeMill : t.machines.typeLathe}
                  {m.axis ? `, ${m.axis} ${t.machines.axisShort}` : ''})
                </option>
              ))}
            </select>
            {machines.length === 0 && (
              <p className="subtitle-text text-xs has-gap-xs">
                {t.machines.noMachinesDefined}
              </p>
            )}
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
            <select value={form.operatorId ?? ''} onChange={(e) => { const worker = activeWorkers.find((item) => item.id === Number(e.target.value)); setForm({ ...form, operatorId: worker?.id ?? null, operator: worker ? displayName(worker) : '' }); }}>
              <option value="">{lang === 'hr' ? 'Nije dodijeljen' : 'Unassigned'}</option>
              {activeWorkers.map((worker) => <option key={worker.id} value={worker.id} disabled={Boolean(form.machine && worker.qualifications.length && !worker.qualifications.includes(form.machine))}>{displayName(worker)} · {worker.qualifications.join(', ') || worker.roleName}</option>)}
            </select>
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
        <div className="grid-inputs workers-ruster mt-md">
          <div>
            <label>{t.common.end}</label>
            <input
              type="datetime-local"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </div>
        </div>

        {feedback && <p role={feedback.tone === 'error' ? 'alert' : 'status'} className={`woc-status ${feedback.tone === 'error' ? 'is-error' : 'is-success'}`}>{feedback.text}</p>}

        <div className="action-bar">
          <button className="btn btn-green" onClick={handleAdd}>
            <IconPlus className="inline-icon" />
            {t.common.add}
          </button>
        </div>
      </details>

      <p className="subtitle-text text-sm mt-lg">
        {t.machines.sharedNote}
      </p>

      <div className="step-title mt-lg">
        <span className="step-number">2</span>
        {t.machines.title}
      </div>
      <MachineBoard />
    </div>
  );
}
