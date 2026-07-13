import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconPlus, IconTrash } from '../components/Icons';
import { useScheduling, type OperationStep } from '../scheduling/SchedulingContext';

let nextOpId = 1;

export default function WorkOrderCreator() {
  const { t } = useLanguage();
  const { jobs, addJob } = useScheduling();

  const [orderNumber, setOrderNumber] = useState('');
  const [product, setProduct] = useState('');
  const [startDateTime, setStartDateTime] = useState('');

  const [operations, setOperations] = useState<OperationStep[]>([]);
  const [opForm, setOpForm] = useState({ name: '', machine: '', hours: '' });

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalHours = operations.reduce((sum, op) => sum + op.hours, 0);

  function addOperation() {
    const hours = parseFloat(opForm.hours);
    if (!opForm.name || !opForm.machine || !hours || hours <= 0) return;
    setOperations((prev) => [...prev, { id: nextOpId++, name: opForm.name, machine: opForm.machine, hours }]);
    setOpForm({ name: '', machine: '', hours: '' });
  }

  function removeOperation(id: number) {
    setOperations((prev) => prev.filter((op) => op.id !== id));
  }

  function createOrder() {
    setMessage(null);
    setError(null);
    if (!orderNumber.trim() || operations.length === 0 || !startDateTime) {
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

    addJob({
      machine: operations.map((op) => op.machine).join(' → '),
      order: orderNumber.trim(),
      operator: product.trim(),
      start: startDateTime,
      end: endLocal,
      operations,
    });

    setMessage(t.workOrders.created);
    setOrderNumber('');
    setProduct('');
    setStartDateTime('');
    setOperations([]);
  }

  const createdOrders = jobs.filter((j) => j.operations && j.operations.length > 0);

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.workOrders.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 13 }}>{t.workOrders.subtitle}</p>

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
            <label>{t.workOrders.startDateTime}</label>
            <input
              type="datetime-local"
              value={startDateTime}
              onChange={(e) => setStartDateTime(e.target.value)}
            />
          </div>
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
                  </div>
                  {i < operations.length - 1 && <span className="flow-arrow">→</span>}
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
      {message && <p style={{ color: '#16a34a', fontSize: 13, marginTop: 10 }}>{message}</p>}
      {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{error}</p>}

      <div className="step-box" style={{ marginTop: 20 }}>
        <div className="step-title">{t.workOrders.createdOrders}</div>
        {createdOrders.length === 0 ? (
          <p className="subtitle-text" style={{ fontSize: 13 }}>{t.workOrders.noCreatedOrders}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.workOrders.orderNumber}</th>
                <th>{t.workOrders.product}</th>
                <th>{t.workOrders.buildRoute}</th>
                <th>{t.common.status}</th>
              </tr>
            </thead>
            <tbody>
              {createdOrders.map((job) => (
                <tr key={job.id}>
                  <td>{job.order}</td>
                  <td>{job.operator || '-'}</td>
                  <td>{job.operations?.map((op) => op.name).join(' → ')}</td>
                  <td>
                    <span className={`status-pill status-${job.status}`}>
                      {t.progress.statusOptions[job.status]}
                    </span>
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
