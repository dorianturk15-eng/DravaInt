import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';

function ShieldMark() {
  return <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.7 3.2 7.9 7.5 9.5 4.3-1.6 7.5-4.8 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>;
}

export default function Login() {
  const { t, lang, setLang } = useLanguage();
  const { login, loginWithRfid, loginWithSso, loading, secureMode } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rfidMode, setRfidMode] = useState(false);
  const [rfid, setRfid] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const ok = rfidMode ? await loginWithRfid(rfid) : await login(identifier, password);
    setSubmitting(false);
    setError(ok ? '' : t.login.error);
  }

  return <main className="auth-screen">
    <div className="auth-ambient auth-ambient-a" /><div className="auth-ambient auth-ambient-b" />
    <section className="auth-card">
      <header className="auth-brand"><span><ShieldMark /></span><div><strong>DravaInt</strong><small>Production intelligence</small></div><div className="auth-lang"><button className={lang === 'hr' ? 'active' : ''} onClick={() => setLang('hr')}>HR</button><button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button></div></header>
      <div className="auth-heading"><span className="eyebrow">{secureMode ? 'Supabase · secure session' : 'Offline preview'}</span><h1>{t.login.title}</h1><p>{lang === 'hr' ? 'Pristupite radioničkom operativnom sustavu.' : 'Access the workshop operating system.'}</p></div>
      <div className="auth-mode-switch"><button className={!rfidMode ? 'active' : ''} onClick={() => { setRfidMode(false); setError(''); }}>{lang === 'hr' ? 'Račun' : 'Account'}</button><button className={rfidMode ? 'active' : ''} onClick={() => { setRfidMode(true); setError(''); }} disabled={secureMode}>RFID</button></div>
      <form onSubmit={submit}>
        {rfidMode ? <label>RFID<input value={rfid} onChange={(event) => setRfid(event.target.value)} autoFocus placeholder="Scan badge…" /></label> : <><label>{lang === 'hr' ? 'Korisničko ime ili e-mail' : 'Username or email'}<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" autoFocus /></label><label>{t.login.password}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label></>}
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="btn btn-blue auth-submit" type="submit" disabled={loading || submitting}>{submitting ? (lang === 'hr' ? 'Provjera…' : 'Checking…') : t.login.submit}</button>
      </form>
      {secureMode && <button className="sso-button" onClick={() => void loginWithSso()}>{lang === 'hr' ? 'Nastavi s Microsoft SSO' : 'Continue with Microsoft SSO'}</button>}
      {!secureMode && <div className="demo-credentials"><strong>{lang === 'hr' ? 'Lokalni demo' : 'Local demo'}</strong><code>admin</code><code>DravaInt!2026</code></div>}
      <footer><span className={`sync-dot ${secureMode ? '' : 'offline-dot'}`} />{secureMode ? (lang === 'hr' ? 'Sigurna veza je aktivna' : 'Secure connection active') : (lang === 'hr' ? 'Podaci ostaju na ovom uređaju' : 'Data stays on this device')}</footer>
    </section>
  </main>;
}
