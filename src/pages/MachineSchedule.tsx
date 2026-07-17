import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus } from '../components/Icons';
import { useScheduling } from '../scheduling/SchedulingContext';
import { useMachines } from '../machines/MachinesContext';
import { useWorkers } from '../workers/WorkersContext';
import { MachineBoard, QUICK_CREATE_EVENT, type QuickCreateDetail } from '../components/machine-board/MachineBoard';

export default function MachineSchedule() {
  const { t, lang } = useLanguage();
  const { addJob } = useScheduling();
  const { machines } = useMachines();
  const { activeWorkers, displayName } = useWorkers();
  const formRef = useRef<HTMLDivElement | null>(null);

  const [form, setForm] = useState({ machine: '', order: '', operator: '', operatorId: null as number | null, start: '', end: '' });

  useEffect(() => {
    const onQuickCreate = (event: Event) => {
      const detail = (event as CustomEvent<QuickCreateDetail>).detail;
      setForm((current) => ({ ...current, machine: detail.machine, start: detail.start, end: detail.end }));
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener(QUICK_CREATE_EVENT, onQuickCreate);
    return () => window.removeEventListener(QUICK_CREATE_EVENT, onQuickCreate);
  }, []);

  function handleAdd() {
    if (!form.machine || !form.order) return;
    addJob(form);
    setForm({ machine: '', order: '', operator: '', operatorId: null, start: '', end: '' });
  }

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.machines.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 13 }}>{t.machines.subtitle}</p>

      <div className="step-box" ref={formRef}>
        <div className="step-title">
          <span className="step-number">1</span>
          {t.machines.addJob}
        </div>
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
              <p className="subtitle-text" style={{ fontSize: 11, marginTop: 4 }}>
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

      <div className="step-title" style={{ marginTop: 20 }}>
        <span className="step-number">2</span>
        {t.machines.title}
      </div>
      <MachineBoard />
    </div>
  );
}
