import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';

export default function Login() {
  const { t, lang, setLang } = useLanguage();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = login(username.trim(), password);
    setError(!ok);
  }

  return (
    <div className="login-page">
      <div className="lang-switch login-lang-switch">
        <button className={`lang-btn${lang === 'hr' ? ' active' : ''}`} onClick={() => setLang('hr')}>
          HR
        </button>
        <button className={`lang-btn${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>
          EN
        </button>
      </div>

      <form className="wizard-container login-card" onSubmit={handleSubmit}>
        <h2 style={{ marginBottom: 5 }}>{t.login.title}</h2>
        <p style={{ margin: '0 0 20px 0', fontSize: 13, color: '#64748b' }}>{t.login.subtitle}</p>

        <div className="step-box">
          <label>{t.login.username}</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>

        <div className="step-box">
          <label>{t.login.password}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{t.login.error}</p>
        )}

        <div className="action-bar">
          <button className="btn btn-blue" type="submit">
            {t.login.submit}
          </button>
        </div>
      </form>
    </div>
  );
}
