import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { useLogo } from '../logo/LogoContext';
import { SyncDiagnostics } from '../components/SyncDiagnostics';
import { useAuth, getLastLogins } from '../auth/AuthContext';
import { useMachines, type MachineType, type MillAxis } from '../machines/MachinesContext';
import { useRoles } from '../roles/RolesContext';
import { IconUpload, IconTrash, IconEdit, IconPlus } from '../components/Icons';
import { useWorkers, type Worker } from '../workers/WorkersContext';

export default function Admin() {
  const { t, lang } = useLanguage();
  const { logo, setLogo } = useLogo();
  const { users, username: currentUsername, addUser, updateUser, deleteUser } = useAuth();
  const lastLogins = getLastLogins();
  const { machines, addMachine, updateMachine, removeMachine } = useMachines();
  const { roles, addRole, removeRole, setRoleActive } = useRoles();
  const { workers: workersList, addWorker, updateWorker, archiveWorker, displayName } = useWorkers();

  const [pendingLogo, setPendingLogo] = useState<string | null>(logo);
  const [savedMsg, setSavedMsg] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('');
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [userError, setUserError] = useState('');

  const [machineName, setMachineName] = useState('');
  const [machineType, setMachineType] = useState<MachineType>('mill');
  const [machineAxis, setMachineAxis] = useState<MillAxis>(3);
  const [editingMachineId, setEditingMachineId] = useState<number | null>(null);
  const [machineError, setMachineError] = useState('');

  const [newRoleName, setNewRoleName] = useState('');
  const [roleError, setRoleError] = useState('');

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPendingLogo(ev.target?.result as string);
      setSavedMsg(false);
    };
    reader.readAsDataURL(file);
  }

  function saveLogo() {
    setLogo(pendingLogo);
    setSavedMsg(true);
  }

  function clearLogo() {
    setPendingLogo(null);
    setLogo(null);
    setSavedMsg(false);
  }

  function resetUserForm() {
    setNewUsername('');
    setNewPassword('');
    setNewRole('');
    setEditingUsername(null);
    setUserError('');
  }

  async function submitUser() {
    setUserError('');
    const role = newRole || null;
    const ok = editingUsername
      ? await updateUser(editingUsername, newUsername, newPassword, role)
      : await addUser(newUsername, newPassword, role);
    if (!ok) {
      setUserError(t.admin.userExists);
      return;
    }
    resetUserForm();
  }

  function startEdit(username: string, password: string, role: string | null) {
    setEditingUsername(username);
    setNewUsername(username);
    setNewPassword(password);
    setNewRole(role ?? '');
    setUserError('');
  }

  async function handleDelete(username: string) {
    setUserError('');
    if (username === currentUsername) {
      setUserError(t.admin.cannotDeleteSelf);
      return;
    }
    if (users.length <= 1) {
      setUserError(t.admin.cannotDeleteLast);
      return;
    }
    await deleteUser(username);
    if (editingUsername === username) resetUserForm();
  }

  function resetMachineForm() {
    setMachineName('');
    setMachineType('mill');
    setMachineAxis(3);
    setEditingMachineId(null);
    setMachineError('');
  }

  async function submitMachine() {
    setMachineError('');
    const ok = editingMachineId
      ? await updateMachine(editingMachineId, { name: machineName, type: machineType, axis: machineAxis })
      : await addMachine({ name: machineName, type: machineType, axis: machineAxis });
    if (!ok) {
      setMachineError(t.admin.machineExists);
      return;
    }
    resetMachineForm();
  }

  function startEditMachine(id: number, name: string, type: MachineType, axis: MillAxis | null) {
    setEditingMachineId(id);
    setMachineName(name);
    setMachineType(type);
    setMachineAxis(axis ?? 3);
    setMachineError('');
  }

  async function submitRole() {
    setRoleError('');
    const ok = await addRole(newRoleName);
    if (!ok) {
      setRoleError(t.admin.machineExists);
      return;
    }
    setNewRoleName('');
  }

  const [adminTab, setAdminTab] = useState<'logo' | 'machines' | 'workers' | 'roles' | 'users' | 'system'>('logo');

  const [workerName, setWorkerName] = useState('');
  const [workerRole, setWorkerRole] = useState('');
  const [workerAccount, setWorkerAccount] = useState('');
  const [workerQualifications, setWorkerQualifications] = useState('');
  const [editingWorkerId, setEditingWorkerId] = useState<number | null>(null);
  const [workerError, setWorkerError] = useState('');

  async function handleAddWorker() {
    setWorkerError('');
    if (!workerName.trim() || !workerRole) {
      setWorkerError(lang === 'hr' ? 'Ime i uloga su obavezni.' : 'Name and role are required.');
      return;
    }

    const [firstName, ...lastNameParts] = workerName.trim().split(/\s+/);
    const role = roles.find((item) => item.name === workerRole);
    if (!lastNameParts.length) {
      setWorkerError(lang === 'hr' ? 'Unesite ime i prezime.' : 'Enter first and last name.');
      return;
    }

    if (editingWorkerId !== null) {
      await updateWorker(editingWorkerId, {
        firstName,
        lastName: lastNameParts.join(' '),
        roleId: role?.id ?? null,
        roleName: workerRole,
        email: workerAccount ? `${workerAccount}@dravaint.local` : '',
        qualifications: workerQualifications.split(',').map((value) => value.trim()).filter(Boolean),
      });
      setEditingWorkerId(null);
    } else {
      const ok = await addWorker({
        firstName,
        lastName: lastNameParts.join(' '),
        roleId: role?.id ?? null,
        roleName: workerRole,
        email: workerAccount ? `${workerAccount}@dravaint.local` : '',
        appUserId: null,
        isActive: true,
        qualifications: workerQualifications.split(',').map((value) => value.trim()).filter(Boolean),
      });
      if (!ok) {
        setWorkerError(lang === 'hr' ? 'Radnik već postoji ili podaci nisu ispravni.' : 'Worker already exists or the data is invalid.');
        return;
      }
    }

    setWorkerName('');
    setWorkerRole('');
    setWorkerAccount('');
    setWorkerQualifications('');
  }

  function handleEditWorker(w: Worker) {
    setEditingWorkerId(w.id);
    setWorkerName(displayName(w));
    setWorkerRole(w.roleName);
    setWorkerAccount(w.email.endsWith('@dravaint.local') ? w.email.replace('@dravaint.local', '') : '');
    setWorkerQualifications(w.qualifications.join(', '));
  }

  async function handleDeleteWorker(id: number) {
    await archiveWorker(id);
  }

  // System Key-Value configs
  const [shiftHours, setShiftHours] = useState(() => localStorage.getItem('cfg-shift-hours') || '8');
  const [maxHours, setMaxHours] = useState(() => localStorage.getItem('cfg-max-hours') || '48');
  const [bottleneckHrs, setBottleneckHrs] = useState(() => localStorage.getItem('cfg-bottleneck-hours') || '40');
  const [cfgSaved, setCfgSaved] = useState(false);

  function saveSystemConfigs() {
    localStorage.setItem('cfg-shift-hours', shiftHours);
    localStorage.setItem('cfg-max-hours', maxHours);
    localStorage.setItem('cfg-bottleneck-hours', bottleneckHrs);
    setCfgSaved(true);
    setTimeout(() => setCfgSaved(false), 3000);
  }

  // JSON Backup utilities
  function handleExportBackup() {
    const backupData: Record<string, string | null> = {};
    const keysToBackup = [
      'dravaint-shift-schedule',
      'dravaint-machines',
      'dravaint-roles',
      'dravaint-users-fallback',
      'dravaint-schedule',
      'cfg-shift-hours',
      'cfg-max-hours',
      'cfg-bottleneck-hours',
      'gantt-baseline'
    ];
    keysToBackup.forEach((k) => {
      backupData[k] = localStorage.getItem(k);
    });

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dravaint-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleImportBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        Object.entries(parsed).forEach(([k, v]) => {
          if (v !== null) {
            localStorage.setItem(k, v as string);
          }
        });
        alert(lang === 'hr' ? 'Sigurnosna kopija uspješno učitana! Ponovno učitajte aplikaciju.' : 'Backup successfully imported! Please reload the application.');
        window.location.reload();
      } catch {
        alert(lang === 'hr' ? 'Greška pri čitanju datoteke.' : 'Error reading backup file.');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="wizard-container">
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 6px 0', fontFamily: 'var(--font-title)', fontWeight: 800 }}>{t.admin.title}</h2>
        <p className="subtitle-text" style={{ margin: 0 }}>
          {t.admin.subtitle}
        </p>
      </div>

      <div className="view-toggle" style={{ marginBottom: 25 }}>
        <button className={adminTab === 'logo' ? 'active' : ''} onClick={() => setAdminTab('logo')}>
          {t.admin.logoSection}
        </button>
        <button className={adminTab === 'machines' ? 'active' : ''} onClick={() => setAdminTab('machines')}>
          {t.admin.machinesSection}
        </button>
        <button className={adminTab === 'workers' ? 'active' : ''} onClick={() => setAdminTab('workers')}>
          👤 {lang === 'hr' ? 'Radnici' : 'Workers'}
        </button>
        <button className={adminTab === 'roles' ? 'active' : ''} onClick={() => setAdminTab('roles')}>
          📋 {lang === 'hr' ? 'Uloge radnika' : 'Worker Roles'}
        </button>
        <button className={adminTab === 'users' ? 'active' : ''} onClick={() => setAdminTab('users')}>
          🔑 {lang === 'hr' ? 'Korisnički računi' : 'Login Accounts'}
        </button>
        <button className={adminTab === 'system' ? 'active' : ''} onClick={() => setAdminTab('system')}>
          ⚙️ {lang === 'hr' ? 'Sustav' : 'System'}
        </button>
      </div>

      {adminTab === 'logo' && (
        <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', padding: 24 }}>
          <div className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 20 }}>
            {t.admin.logoSection}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="premium-upload">
                <input type="file" accept="image/*" onChange={handleLogoFile} />
                <span className="premium-upload-icon"><IconUpload /></span>
                <span><strong>{lang === 'hr' ? 'Odaberite logotip' : 'Choose company logo'}</strong><small>PNG, JPG, SVG · {lang === 'hr' ? 'preporučena prozirna pozadina' : 'transparent background recommended'}</small></span>
                <b>{lang === 'hr' ? 'Pregledaj' : 'Browse'}</b>
              </label>
              <p className="subtitle-text" style={{ fontSize: 12, marginTop: 8 }}>
                {lang === 'hr' ? 'Učitajte prilagođeni logotip tvrtke koji će se prikazivati na ispisima radnih naloga.' : 'Upload a custom company logo that will display on printed work orders.'}
              </p>
            </div>
            {pendingLogo && (
              <div style={{ textAlign: 'center', border: '1px solid var(--border-color)', padding: 12, borderRadius: 8, background: '#ffffff' }}>
                <div style={{ fontSize: 11, fontWeight: 'bold', color: '#64748b', marginBottom: 6 }}>{t.admin.currentLogo}</div>
                <img src={pendingLogo} alt="Logo" style={{ maxHeight: 60, width: 'auto', display: 'block', margin: '0 auto' }} />
              </div>
            )}
          </div>

          <div className="action-bar" style={{ justifyContent: 'flex-start', marginTop: 25, borderTop: '1px solid var(--border-color)', paddingTop: 20 }}>
            <button className="btn btn-green" onClick={saveLogo}>
              <IconUpload />
              {t.admin.save}
            </button>
            <button className="btn btn-red" onClick={clearLogo}>
              <IconTrash />
              {t.admin.clear}
            </button>
          </div>
          {savedMsg && <p style={{ color: '#10b981', fontSize: 13, fontWeight: 'bold', marginTop: 10 }}>✓ {t.admin.saved}</p>}
        </div>
      )}

      {adminTab === 'machines' && (
        <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', padding: 24 }}>
          <div className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 20 }}>
            {t.admin.machinesSection}
          </div>

          <div className="grid-inputs time-settings" style={{ marginBottom: 25 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{t.admin.machineName}</label>
              <input type="text" value={machineName} onChange={(e) => setMachineName(e.target.value)} />
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{t.admin.machineType}</label>
              <select value={machineType} onChange={(e) => setMachineType(e.target.value as MachineType)}>
                <option value="mill">{t.machines.typeMill}</option>
                <option value="lathe">{t.machines.typeLathe}</option>
              </select>
            </div>
            {machineType === 'mill' && (
              <div>
                <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{t.admin.machineAxis}</label>
                <select value={machineAxis} onChange={(e) => setMachineAxis(Number(e.target.value) as MillAxis)}>
                  <option value={3}>3 {t.machines.axisShort}</option>
                  <option value={5}>5 {t.machines.axisShort}</option>
                </select>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button className="btn btn-blue" onClick={submitMachine} style={{ flex: 1 }}>
                {editingMachineId ? <IconEdit /> : <IconPlus />}
                {editingMachineId ? t.admin.editMachine : t.admin.addMachine}
              </button>
              {editingMachineId && (
                <button className="btn btn-red" onClick={resetMachineForm}>
                  {t.admin.cancelEdit}
                </button>
              )}
            </div>
          </div>
          {machineError && <p style={{ color: 'var(--danger-color)', fontSize: 13, marginTop: 10, fontWeight: 'bold' }}>{machineError}</p>}

          <div style={{ overflowX: 'auto' }}>
            {machines.length === 0 ? (
              <p className="subtitle-text" style={{ fontSize: 13, textAlign: 'center', padding: '20px 0' }}>{t.admin.noMachines}</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t.admin.machineName}</th>
                    <th>{t.admin.machineType}</th>
                    <th>{t.admin.machineAxis}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {machines.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>{m.name}</td>
                      <td>{m.type === 'mill' ? t.machines.typeMill : t.machines.typeLathe}</td>
                      <td>{m.axis ? `${m.axis} ${t.machines.axisShort}` : '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="btn btn-blue btn-sm"
                            onClick={() => startEditMachine(m.id, m.name, m.type, m.axis)}
                          >
                            <IconEdit style={{ width: 12, height: 12 }} />
                            {t.admin.edit}
                          </button>
                          <button
                            className="btn btn-red btn-sm"
                            onClick={() => removeMachine(m.id)}
                          >
                            <IconTrash style={{ width: 12, height: 12 }} />
                            {t.admin.delete}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {adminTab === 'workers' && (
        <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', padding: 24 }}>
          <div className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 20 }}>
            👤 {lang === 'hr' ? 'Evidencija Radnika u Radionici' : 'Shop Floor Workers Directory'}
          </div>

          <div className="grid-inputs time-settings" style={{ marginBottom: 25 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{lang === 'hr' ? 'Ime radnika' : 'Worker Name'}</label>
              <input type="text" value={workerName} onChange={(e) => setWorkerName(e.target.value)} placeholder="npr. Ivan Horvat" />
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{t.roles.title}</label>
              <select value={workerRole} onChange={(e) => setWorkerRole(e.target.value)}>
                <option value="">{t.roles.noRole}</option>
                {roles.filter((r) => r.is_active).map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{lang === 'hr' ? 'Korisnički račun (opcionalno)' : 'Link Login Account (Optional)'}</label>
              <select value={workerAccount} onChange={(e) => setWorkerAccount(e.target.value)}>
                <option value="">{lang === 'hr' ? 'Nema računa' : 'No account linked'}</option>
                {users.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.username}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{lang === 'hr' ? 'Kvalifikacije' : 'Qualifications'}</label>
              <input value={workerQualifications} onChange={(e) => setWorkerQualifications(e.target.value)} placeholder="CNC-1, CNC-2, Kontrola kvalitete" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button className="btn btn-blue" onClick={handleAddWorker} style={{ flex: 1 }}>
                {editingWorkerId !== null ? <IconEdit /> : <IconPlus />}
                {editingWorkerId !== null ? (lang === 'hr' ? 'Uredi radnika' : 'Edit Worker') : (lang === 'hr' ? 'Dodaj radnika' : 'Add Worker')}
              </button>
              {editingWorkerId !== null && (
                <button className="btn btn-red" onClick={() => { setEditingWorkerId(null); setWorkerName(''); setWorkerRole(''); setWorkerAccount(''); setWorkerQualifications(''); }}>
                  {t.admin.cancelEdit}
                </button>
              )}
            </div>
          </div>
          {workerError && <p style={{ color: 'var(--danger-color)', fontSize: 13, marginTop: 10, fontWeight: 'bold' }}>{workerError}</p>}

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{lang === 'hr' ? 'Ime radnika' : 'Worker Name'}</th>
                  <th>{t.roles.title}</th>
                  <th>{lang === 'hr' ? 'Korisnički račun' : 'Linked Account'}</th>
                  <th>{lang === 'hr' ? 'Kvalifikacije' : 'Qualifications'}</th>
                  <th>{lang === 'hr' ? 'Status' : 'Status'}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {workersList.map((w) => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 600 }}>{displayName(w)}</td>
                    <td>
                      <span style={{ background: 'var(--primary-light)', color: 'var(--primary-color)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{w.roleName}</span>
                    </td>
                    <td>{w.email ? <span style={{ fontFamily: 'monospace' }}>{w.email}</span> : <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{lang === 'hr' ? 'Nema' : 'None'}</span>}</td>
                    <td style={{ fontSize: 11 }}>{w.qualifications.join(', ') || '—'}</td>
                    <td><select value={w.status} onChange={(e) => void updateWorker(w.id, { status: e.target.value as Worker['status'] })} style={{ width: 'auto', padding: '5px 7px', fontSize: 10 }}><option value="available">Available</option><option value="busy">Busy</option><option value="break">Break</option><option value="absent">Absent</option></select></td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-blue btn-sm" onClick={() => handleEditWorker(w)}>
                          <IconEdit style={{ width: 12, height: 12 }} />
                          {t.admin.edit}
                        </button>
                        <button className={w.isActive ? 'btn btn-red btn-sm' : 'btn btn-green btn-sm'} onClick={() => w.isActive ? handleDeleteWorker(w.id) : void updateWorker(w.id, { isActive: true })}>
                          <IconTrash style={{ width: 12, height: 12 }} />
                          {w.isActive ? (lang === 'hr' ? 'Arhiviraj' : 'Archive') : (lang === 'hr' ? 'Aktiviraj' : 'Activate')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adminTab === 'roles' && (
        <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', padding: 24 }}>
          <div className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 20 }}>
            📋 {lang === 'hr' ? 'Uloge Radnika' : 'Worker Roles Manager'}
          </div>

          <p className="subtitle-text" style={{ marginBottom: 20, fontSize: 12 }}>
            {lang === 'hr' ? 'Pregledajte i uredite uloge svih radnika u sustavu:' : 'View and edit roles of all workers in the system:'}
          </p>

          <div style={{ overflowX: 'auto', marginBottom: 30 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{lang === 'hr' ? 'Ime radnika' : 'Worker Name'}</th>
                  <th>{t.roles.title}</th>
                </tr>
              </thead>
              <tbody>
                {workersList.map((w) => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 600 }}>{displayName(w)}</td>
                    <td>
                      <select
                        value={w.roleName}
                        onChange={(e) => {
                          const role = roles.find((item) => item.name === e.target.value);
                          void updateWorker(w.id, { roleName: e.target.value, roleId: role?.id ?? null });
                        }}
                        style={{ width: 'auto', minWidth: 220, padding: '6px 12px', fontSize: 12 }}
                      >
                        {roles.filter((r) => r.is_active || r.name === w.roleName).map((r) => (
                          <option key={r.id} value={r.name}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 20 }}>
            <div className="step-title" style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 15 }}>
              🛠️ {lang === 'hr' ? 'Definirane Uloge' : 'Defined Roles Catalog'}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <input
                  type="text"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder={t.roles.roleName}
                />
              </div>
              <button className="btn btn-blue" onClick={submitRole} style={{ width: 'auto' }}>
                <IconPlus />
                {t.roles.addRole}
              </button>
            </div>
            {roleError && <p style={{ color: 'var(--danger-color)', fontSize: 13, marginTop: 10, fontWeight: 'bold' }}>{roleError}</p>}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {roles.length === 0 ? (
                <p className="subtitle-text" style={{ fontSize: 13 }}>{lang === 'hr' ? 'Nema definiranih uloga.' : 'No roles defined.'}</p>
              ) : (
                roles.map((r) => (
                  <span key={r.id} className="role-chip" style={{ padding: '6px 12px', background: 'var(--bg-step)', borderRadius: 20, border: '1px solid var(--border-color)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, opacity: r.is_active ? 1 : 0.55 }}>{r.name}</span>
                    <button onClick={() => setRoleActive(r.id, !r.is_active)} title={r.is_active ? 'Deactivate role' : 'Activate role'} style={{ background: 'none', border: 'none', color: r.is_active ? 'var(--success-color)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>
                      {r.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </button>
                    <button onClick={() => removeRole(r.id)} title={t.admin.delete} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 10, display: 'inline-flex', alignItems: 'center' }}>
                      ✕
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {adminTab === 'users' && (
        <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', padding: 24 }}>
          <div className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 20 }}>
            🔑 {lang === 'hr' ? 'Korisnički Računi za Prijavu' : 'App Login Accounts'}
          </div>

          <div className="grid-inputs time-settings" style={{ marginBottom: 25 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{t.admin.username}</label>
              <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="npr. jhorvat" />
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{t.admin.password}</label>
              <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button className="btn btn-blue" onClick={submitUser} style={{ flex: 1 }}>
                {editingUsername ? <IconEdit /> : <IconPlus />}
                {editingUsername ? t.admin.editUser : t.admin.addUser}
              </button>
              {editingUsername && (
                <button className="btn btn-red" onClick={resetUserForm}>
                  {t.admin.cancelEdit}
                </button>
              )}
            </div>
          </div>
          {userError && <p style={{ color: 'var(--danger-color)', fontSize: 13, marginTop: 10, fontWeight: 'bold' }}>{userError}</p>}

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.admin.username}</th>
                  <th>{t.admin.password}</th>
                  <th>{lang === 'hr' ? 'Zadnja prijava' : 'Last login'}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.username}>
                    <td style={{ fontWeight: 600 }}>{u.username}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{'•'.repeat(Math.min(8, u.password.length))}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{lastLogins[u.username] ? new Date(lastLogins[u.username]).toLocaleString() : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-blue btn-sm"
                          onClick={() => startEdit(u.username, u.password, u.role)}
                        >
                          <IconEdit style={{ width: 12, height: 12 }} />
                          {t.admin.edit}
                        </button>
                        <button
                          className="btn btn-red btn-sm"
                          onClick={() => handleDelete(u.username)}
                        >
                          <IconTrash style={{ width: 12, height: 12 }} />
                          {t.admin.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adminTab === 'system' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SyncDiagnostics language={lang} />
          {/* Key-Value Config Editor */}
          <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', padding: 24 }}>
            <div className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 20 }}>
              ⚙️ {lang === 'hr' ? 'Uređivanje Postavki Sustava' : 'System Configuration Editor'}
            </div>
            <div className="grid-inputs time-settings" style={{ marginBottom: 20 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{lang === 'hr' ? 'Trajanje smjene (sati)' : 'Shift Duration (Hours)'}</label>
                <input type="number" min={1} max={24} value={shiftHours} onChange={(e) => setShiftHours(e.target.value)} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{lang === 'hr' ? 'Maksimalni tjedni sati' : 'Max Weekly Hours'}</label>
                <input type="number" min={1} max={168} value={maxHours} onChange={(e) => setMaxHours(e.target.value)} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>{lang === 'hr' ? 'Limit uskog grla stroja' : 'Machine Bottleneck Limit (Hrs)'}</label>
                <input type="number" min={1} max={100} value={bottleneckHrs} onChange={(e) => setBottleneckHrs(e.target.value)} />
              </div>
            </div>
            <button className="btn btn-blue" onClick={saveSystemConfigs} style={{ width: 'auto', padding: '8px 16px' }}>
              💾 {lang === 'hr' ? 'Spremi Postavke' : 'Save Configurations'}
            </button>
            {cfgSaved && <span style={{ color: 'var(--success-color)', fontSize: 13, marginLeft: 15, fontWeight: 'bold' }}>✓ Saved!</span>}
          </div>

          {/* Backup Import/Export Utility */}
          <div className="step-box" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', padding: 24 }}>
            <div className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 20 }}>
              💾 {lang === 'hr' ? 'Izvoz i Uvoz Sigurnosne Kopije' : 'Database Import/Export Backup'}
            </div>
            <p className="subtitle-text" style={{ marginBottom: 20 }}>
              {lang === 'hr' ? 'Izvezite cijelu lokalnu bazu podataka u JSON datoteku ili učitajte postojeću.' : 'Export your entire local workspace database to a JSON file or import a saved backup.'}
            </p>
            <div style={{ display: 'flex', gap: 15, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-green" onClick={handleExportBackup} style={{ width: 'auto', padding: '10px 18px' }}>
                📤 {lang === 'hr' ? 'Izvezi sigurnosnu kopiju' : 'Export JSON Backup'}
              </button>
              <div style={{ borderLeft: '1px solid var(--border-color)', height: 35, display: 'inline-block' }} />
              <label className="premium-upload premium-upload-compact">
                <input type="file" accept=".json" onChange={handleImportBackup} />
                <span className="premium-upload-icon">↥</span>
                <span><strong>{lang === 'hr' ? 'Uvezi sigurnosnu kopiju' : 'Import JSON backup'}</strong><small>.json · {lang === 'hr' ? 'lokalna radna baza' : 'local workspace database'}</small></span>
                <b>{lang === 'hr' ? 'Odaberi' : 'Choose'}</b>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
