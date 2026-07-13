import { useState } from 'react';
import './App.css';
import { useLanguage } from './i18n/LanguageContext';
import { useAuth } from './auth/AuthContext';
import { useTheme } from './theme/ThemeContext';
import ShiftSchedule from './pages/ShiftSchedule';
import MachineSchedule from './pages/MachineSchedule';
import ProgressMonitoring from './pages/ProgressMonitoring';
import GanttChart from './pages/GanttChart';
import Admin from './pages/Admin';
import Login from './pages/Login';

type Tab = 'shifts' | 'machines' | 'progress' | 'gantt' | 'admin';

const ADMIN_USERNAME = 'dturk';

function App() {
  const { t, lang, setLang } = useLanguage();
  const { isAuthenticated, username, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [tab, setTab] = useState<Tab>('shifts');

  if (!isAuthenticated) {
    return <Login />;
  }

  const isAdmin = username === ADMIN_USERNAME;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'shifts', label: t.nav.shifts },
    { key: 'machines', label: t.nav.machines },
    { key: 'progress', label: t.nav.progress },
    { key: 'gantt', label: t.nav.gantt },
    ...(isAdmin ? [{ key: 'admin' as Tab, label: t.nav.admin }] : []),
  ];

  return (
    <div className="app-shell">
      <nav className="top-nav">
        <div className="brand">{t.appTitle}</div>
        <div className="tabs">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              className={`tab-btn${tab === tabItem.key ? ' active' : ''}`}
              onClick={() => setTab(tabItem.key)}
            >
              {tabItem.label}
            </button>
          ))}
        </div>
        <div className="lang-switch">
          <button className={`lang-btn${lang === 'hr' ? ' active' : ''}`} onClick={() => setLang('hr')}>
            HR
          </button>
          <button className={`lang-btn${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>
            EN
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <span style={{ fontSize: 12, color: '#cbd5e1' }}>{username}</span>
          <button className="logout-btn" onClick={logout}>
            {t.login.logout}
          </button>
        </div>
      </nav>

      <div className="page-content">
        {tab === 'shifts' && <ShiftSchedule />}
        {tab === 'machines' && <MachineSchedule />}
        {tab === 'progress' && <ProgressMonitoring />}
        {tab === 'gantt' && <GanttChart />}
        {tab === 'admin' && isAdmin && <Admin />}
      </div>
    </div>
  );
}

export default App;
