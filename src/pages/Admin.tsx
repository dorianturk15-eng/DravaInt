import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { useLogo } from '../logo/LogoContext';
import { useAuth } from '../auth/AuthContext';
import { IconUpload, IconTrash, IconEdit, IconPlus } from '../components/Icons';

export default function Admin() {
  const { t } = useLanguage();
  const { logo, setLogo } = useLogo();
  const { users, username: currentUsername, addUser, updateUser, deleteUser } = useAuth();

  const [pendingLogo, setPendingLogo] = useState<string | null>(logo);
  const [savedMsg, setSavedMsg] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [userError, setUserError] = useState('');

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
    setEditingUsername(null);
    setUserError('');
  }

  async function submitUser() {
    setUserError('');
    const ok = editingUsername
      ? await updateUser(editingUsername, newUsername, newPassword)
      : await addUser(newUsername, newPassword);
    if (!ok) {
      setUserError(t.admin.userExists);
      return;
    }
    resetUserForm();
  }

  function startEdit(username: string, password: string) {
    setEditingUsername(username);
    setNewUsername(username);
    setNewPassword(password);
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.username}>
                  <td>{u.username}</td>
                  <td>{'•'.repeat(u.password.length)}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-blue"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={() => startEdit(u.username, u.password)}
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
