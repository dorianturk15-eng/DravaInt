import { useState } from 'react';
import './App.css';
import { useLanguage } from './i18n/LanguageContext';
import ShiftSchedule from './pages/ShiftSchedule';
import MachineSchedule from './pages/MachineSchedule';
import ProgressMonitoring from './pages/ProgressMonitoring';
import GanttChart from './pages/GanttChart';

type Tab = 'shifts' | 'machines' | 'progress' | 'gantt';

function App() {
  const { t, lang, setLang } = useLanguage();
  const [tab, setTab] = useState<Tab>('shifts');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'shifts', label: t.nav.shifts },
    { key: 'machines', label: t.nav.machines },
    { key: 'progress', label: t.nav.progress },
    { key: 'gantt', label: t.nav.gantt },
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
      </nav>

      <div className="page-content">
        {tab === 'shifts' && <ShiftSchedule />}
        {tab === 'machines' && <MachineSchedule />}
        {tab === 'progress' && <ProgressMonitoring />}
        {tab === 'gantt' && <GanttChart />}
      </div>
    </div>
  );
}

export default App;
