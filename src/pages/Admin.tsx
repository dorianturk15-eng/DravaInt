import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { useLogo } from '../logo/LogoContext';
import { useAuth } from '../auth/AuthContext';
import { useMachines, type MachineType, type MillAxis } from '../machines/MachinesContext';
import { useRoles } from '../roles/RolesContext';
import { IconUpload, IconTrash, IconEdit, IconPlus } from '../components/Icons';

export default function Admin() {
  const { t } = useLanguage();
  const { logo, setLogo } = useLogo();
  const { users, username: currentUsername, addUser, updateUser, deleteUser } = useAuth();
  const { machines, addMachine, updateMachine, removeMachine } = useMachines();
  const { roles, addRole, removeRole } = useRoles();

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

  return (
    <div className="wizard-container">
      <h2 style={{ marginBottom: 5 }}>{t.admin.title}</h2>
      <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 13 }}>
        {t.admin.subtitle}
      </p>

      <div className="step-box">
        <div className="step-title">
          <span className="step-number">1</span>
          {t.admin.logoSection}
        </div>
        <input type="file" accept="image/*" onChange={handleLogoFile} />

        <div style={{ marginTop: 15 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>{t.admin.currentLogo}</label>
          {pendingLogo ? (
            <img src={pendingLogo} alt="Logo" style={{ maxHeight: 60, background: 'white', padding: 6, borderRadius: 6 }} />
          ) : (
            <span className="subtitle-text" style={{ fontSize: 13 }}>{t.admin.noLogo}</span>
          )}
        </div>

        <div className="action-bar" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-green" onClick={saveLogo}>
            <IconUpload style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.admin.save}
          </button>
          <button className="btn btn-red" onClick={clearLogo}>
            <IconTrash style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.admin.clear}
          </button>
        </div>
        {savedMsg && <p style={{ color: '#16a34a', fontSize: 13 }}>{t.admin.saved}</p>}
      </div>

      <div className="step-box">
        <div className="step-title">
          <span className="step-number">2</span>
          {t.admin.machinesSection}
        </div>

        <div className="grid-inputs time-settings">
          <div>
            <label>{t.admin.machineName}</label>
            <input type="text" value={machineName} onChange={(e) => setMachineName(e.target.value)} />
          </div>
          <div>
            <label>{t.admin.machineType}</label>
            <select value={machineType} onChange={(e) => setMachineType(e.target.value as MachineType)}>
              <option value="mill">{t.machines.typeMill}</option>
              <option value="lathe">{t.machines.typeLathe}</option>
            </select>
          </div>
          {machineType === 'mill' && (
            <div>
              <label>{t.admin.machineAxis}</label>
              <select value={machineAxis} onChange={(e) => setMachineAxis(Number(e.target.value) as MillAxis)}>
                <option value={3}>3 {t.machines.axisShort}</option>
                <option value={5}>5 {t.machines.axisShort}</option>
              </select>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button className="btn btn-blue" onClick={submitMachine}>
              {editingMachineId ? (
                <IconEdit style={{ marginRight: 6, verticalAlign: -3 }} />
              ) : (
                <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
              )}
              {editingMachineId ? t.admin.editMachine : t.admin.addMachine}
            </button>
            {editingMachineId && (
              <button className="btn btn-red" onClick={resetMachineForm}>
                {t.admin.cancelEdit}
              </button>
            )}
          </div>
        </div>
        {machineError && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{machineError}</p>}

        <div style={{ marginTop: 20, overflowX: 'auto' }}>
          {machines.length === 0 ? (
            <p className="subtitle-text" style={{ fontSize: 13 }}>{t.admin.noMachines}</p>
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
                    <td>{m.name}</td>
                    <td>{m.type === 'mill' ? t.machines.typeMill : t.machines.typeLathe}</td>
                    <td>{m.axis ? `${m.axis} ${t.machines.axisShort}` : '-'}</td>
                    <td style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-blue"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={() => startEditMachine(m.id, m.name, m.type, m.axis)}
                      >
                        <IconEdit style={{ marginRight: 4, verticalAlign: -2, width: 12, height: 12 }} />
                        {t.admin.edit}
                      </button>
                      <button
                        className="btn btn-red"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={() => removeMachine(m.id)}
                      >
                        <IconTrash style={{ marginRight: 4, verticalAlign: -2, width: 12, height: 12 }} />
                        {t.admin.delete}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="step-box">
        <div className="step-title">
          <span className="step-number">3</span>
          {t.roles.title}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder={t.roles.roleName}
            />
          </div>
          <button className="btn btn-blue" onClick={submitRole}>
            <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.roles.addRole}
          </button>
        </div>
        {roleError && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{roleError}</p>}

        <div style={{ marginTop: 15, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {roles.map((r) => (
            <span key={r.id} className="role-chip">
              {r.name}
              <button onClick={() => removeRole(r.id)} title={t.admin.delete}>
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="step-box">
        <div className="step-title">
          <span className="step-number">4</span>
          {t.admin.usersSection}
        </div>

        <div className="grid-inputs time-settings">
          <div>
            <label>{t.admin.username}</label>
            <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          </div>
          <div>
            <label>{t.admin.password}</label>
            <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div>
            <label>{t.roles.title}</label>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="">{t.roles.noRole}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button className="btn btn-blue" onClick={submitUser}>
              {editingUsername ? (
                <IconEdit style={{ marginRight: 6, verticalAlign: -3 }} />
              ) : (
                <IconPlus style={{ marginRight: 6, verticalAlign: -3 }} />
              )}
              {editingUsername ? t.admin.editUser : t.admin.addUser}
            </button>
            {editingUsername && (
              <button className="btn btn-red" onClick={resetUserForm}>
                {t.admin.cancelEdit}
              </button>
            )}
          </div>
        </div>
        {userError && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{userError}</p>}

        <div style={{ marginTop: 20, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.admin.username}</th>
                <th>{t.admin.password}</th>
                <th>{t.roles.title}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.username}>
                  <td>{u.username}</td>
                  <td>{'•'.repeat(u.password.length)}</td>
                  <td>{u.role || '-'}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-blue"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={() => startEdit(u.username, u.password, u.role)}
                    >
                      <IconEdit style={{ marginRight: 4, verticalAlign: -2, width: 12, height: 12 }} />
                      {t.admin.edit}
                    </button>
                    <button
                      className="btn btn-red"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={() => handleDelete(u.username)}
                    >
                      <IconTrash style={{ marginRight: 4, verticalAlign: -2, width: 12, height: 12 }} />
                      {t.admin.delete}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
