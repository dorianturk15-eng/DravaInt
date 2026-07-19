import { lazy, Suspense, useEffect, useMemo, useState, type ReactElement } from 'react';
import './App.css';
import { useLanguage } from './i18n/LanguageContext';
import { useAuth } from './auth/AuthContext';
import { useTheme } from './theme/ThemeContext';
import { IconDashboard, IconCalendar, IconGear, IconChart, IconGantt, IconFlow, IconShield, IconSun, IconMoon, IconLogout } from './components/Icons';
import { SettingsModal } from './components/SettingsModal';
import { LockScreen } from './components/LockScreen';
import { useSettings, type AppTab } from './settings/SettingsContext';
import { useInactivityLock } from './hooks/useInactivityLock';
import { useWorkers } from './workers/WorkersContext';
import { useMachines } from './machines/MachinesContext';
import Login from './pages/Login';
import { useLocation, useNavigate } from 'react-router-dom';
import { useScheduling } from './scheduling/SchedulingContext';
import { useShifts } from './shifts/ShiftsContext';
import { hasChildren } from './scheduling/hierarchy';
import { useConnectivity } from './hooks/useConnectivity';
import { CommandPalette, type CommandItem } from './components/CommandPalette';
import { NotificationCenter, type OperationalAlert } from './components/NotificationCenter';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { calculateMachineLoads, getWeeklyCapacityHours, weekWindow, jobIntersectsWeek } from './scheduling/capacity';
import { computeEffectiveSchedule, jobsToScheduleInput, getJobConflicts } from './scheduling/cpm';
import { supabase } from './supabase/client';
import { canAccessTab as canAccess } from './auth/access';
import { FOCUS_REQUEST_EVENT, type FocusTarget } from './navigation/focusTarget';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const ShiftSchedule = lazy(() => import('./pages/ShiftSchedule'));
const MachineSchedule = lazy(() => import('./pages/MachineSchedule'));
const ProgressMonitoring = lazy(() => import('./pages/ProgressMonitoring'));
const GanttChart = lazy(() => import('./pages/GanttChartResponsive'));
const WorkOrderCreator = lazy(() => import('./pages/WorkOrderCreator'));
const Admin = lazy(() => import('./pages/Admin'));

function MenuIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

function LockStatusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
}

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

const ALL_TABS: AppTab[] = ['dashboard', 'shifts', 'machines', 'workOrders', 'progress', 'gantt', 'admin'];

function App() {
  const { t, lang, setLang } = useLanguage();
  const { isAuthenticated, username, users, roleResolving, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { settings } = useSettings();
  const { workers, displayName } = useWorkers();
  const { machines } = useMachines();
  const { jobs } = useScheduling();
  const { absences } = useShifts();
  const { online, pendingChanges } = useConnectivity();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const currentUser = users.find((user) => user.username.toLowerCase() === (username ?? '').toLowerCase());
  // Role comes only from the authenticated profile. No username-based admin fallback: a hardcoded
  // "this username is admin" default is a backdoor pattern (harmless server-side since RLS still
  // applies, but it hands out the full admin UI locally and would confuse a security audit).
  const role = currentUser?.role || 'workers';
  const isAdmin = role === 'admin' || role === 'boss';
  const routeValue = location.pathname.replace(/^\//, '') as AppTab;
  const tab = ALL_TABS.includes(routeValue) ? routeValue : settings.defaultView;
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const { isLocked, setIsLocked, secondsRemaining, isDimmed, resetTimer } = useInactivityLock({ authenticated: isAuthenticated, role, settings });

  const linkedWorker = useMemo(() => workers.find((worker) => {
    if (!username) return false;
    return worker.email.toLowerCase() === `${username}@dravaint.local`.toLowerCase() || worker.email.toLowerCase() === username.toLowerCase();
  }), [username, workers]);
  const operatorName = linkedWorker ? displayName(linkedWorker) : username ?? '';

  function navigate(next: AppTab) {
    if (!canAccess(role, next)) {
      setForbidden(true);
      window.setTimeout(() => setForbidden(false), 3500);
      return;
    }
    setForbidden(false);
    routerNavigate(`/${next}`);
  }

  useEffect(() => {
    if (!ALL_TABS.includes(routeValue)) {
      routerNavigate(`/${canAccess(role, settings.defaultView) ? settings.defaultView : 'dashboard'}`, { replace: true });
      return;
    }
    // Don't enforce role-based access while the signed-in user's role is still resolving: `role`
    // defaults to 'workers' until the authenticated profile loads, which would bounce an admin off
    // /admin on a direct load/refresh before their real role arrives.
    if (roleResolving) return;
    if (!canAccess(role, routeValue)) {
      setForbidden(true);
      routerNavigate('/dashboard', { replace: true });
    }
  }, [roleResolving, role, routeValue, routerNavigate, settings.defaultView]);

  // Cross-page focus bus: a requestFocus() from anywhere (alert, Gantt bar, Progress/Dashboard row)
  // navigates to the target tab; the destination page consumes the stored target on mount.
  useEffect(() => {
    const onFocusRequest = (event: Event) => {
      const target = (event as CustomEvent<FocusTarget>).detail;
      if (target?.tab && canAccess(role, target.tab)) routerNavigate(`/${target.tab}`);
    };
    window.addEventListener(FOCUS_REQUEST_EVENT, onFocusRequest);
    return () => window.removeEventListener(FOCUS_REQUEST_EVENT, onFocusRequest);
  }, [role, routerNavigate]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setIsSidebarOpen(false); setIsCommandOpen(false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && isAuthenticated && !isLocked) {
        event.preventDefault();
        setIsCommandOpen((value) => !value);
      }
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 's' && isAuthenticated && !isLocked) {
        event.preventDefault();
        setIsSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isAuthenticated, isLocked]);

  useEffect(() => {
    document.documentElement.classList.toggle('compact-layout', settings.compactMode);
    document.documentElement.classList.toggle('kiosk-layout', settings.kioskMode);
    return () => {
      document.documentElement.classList.remove('compact-layout');
      document.documentElement.classList.remove('kiosk-layout');
    };
  }, [settings.compactMode, settings.kioskMode]);

  if (!isAuthenticated) return <Login />;

  if (isLocked) {
    return <LockScreen
      username={username ?? ''}
      operatorName={operatorName}
      onUnlock={async (secret) => {
        // Never accept an empty secret — comparing against an empty stored value (Supabase profiles
        // carry no password) is what previously made a terminal with no PIN impossible to unlock.
        if (!secret) return false;
        const pin = settings.lockPin;
        if ((pin.length === 4 || pin.length === 6) && secret === pin) return true;
        if (supabase) {
          // Supabase mode: re-authenticate the current user so a terminal with no PIN configured is
          // never permanently locked out. A wrong password errors without changing the session.
          const email = currentUser?.email || `${username}@dravaint.local`;
          const { error } = await supabase.auth.signInWithPassword({ email, password: secret });
          return !error;
        }
        // Demo/offline mode: the account password is stored locally. Require a non-empty match.
        return Boolean(currentUser?.password) && secret === currentUser?.password;
      }}
      onUnlocked={() => setIsLocked(false)}
      onLogout={() => { setIsLocked(false); logout(); }}
    />;
  }

  const allTabEntries: Array<{ key: AppTab; label: string; icon: ReactElement }> = [
    { key: 'dashboard', label: t.nav.dashboard, icon: <IconDashboard /> },
    { key: 'shifts', label: t.nav.shifts, icon: <IconCalendar /> },
    { key: 'machines', label: t.nav.machines, icon: <IconGear /> },
    { key: 'workOrders', label: t.nav.workOrders, icon: <IconFlow /> },
    { key: 'progress', label: t.nav.progress, icon: <IconChart /> },
    { key: 'gantt', label: t.nav.gantt, icon: <IconGantt /> },
    { key: 'admin', label: t.nav.admin, icon: <IconShield /> },
  ];
  const tabs = allTabEntries.filter((item) => canAccess(role, item.key));
  const today = new Date().toISOString().slice(0, 10);
  const leafJobs = jobs.filter((job) => !hasChildren(jobs, job.id));
  const delayThreshold = Date.now() - settings.delayAlertMinutes * 60_000;
  const delayedJobs = settings.delayAlertsEnabled ? leafJobs.filter((job) => job.status === 'delayed' || (job.status !== 'done' && job.end && new Date(job.end).getTime() < delayThreshold)) : [];
  const materialRisks = settings.materialAlertsEnabled ? leafJobs.filter((job) => job.materialStatus === 'waiting' || job.materialStatus === 'delayed') : [];
  const absentWorkerIds = new Set(absences.filter((absence) => absence.startDate <= today && absence.endDate >= today).map((absence) => absence.workerId));
  workers.filter((worker) => worker.status === 'absent').forEach((worker) => absentWorkerIds.add(worker.id));
  // Use the same conflict engine the Gantt and board use (cpm.getJobConflicts), so the bell can't
  // report "operations are stable" while the board shows red. The old naive `job.machine === candidate.machine`
  // string compare missed routed orders ("Tokarilica-1 → CNC-2") and per-operation windows entirely.
  const overlapJob = settings.scheduleConflictAlertsEnabled ? leafJobs.find((job) => Boolean(getJobConflicts(job, jobs).machineOverlap)) : undefined;
  const machineConflicts = Boolean(overlapJob);
  // Capacity alert is scoped to the current week so it reflects this week's load, not an all-time sum.
  const capacityWindow = weekWindow();
  const weekLeafJobs = leafJobs.filter((job) => jobIntersectsWeek(job, capacityWindow));
  const effectiveSchedule = computeEffectiveSchedule(jobsToScheduleInput(weekLeafJobs), { workdayStart: settings.workdayStart, workdayEnd: settings.workdayEnd, holidays: settings.holidays, skipWeekends: true });
  const machineLoads = calculateMachineLoads(weekLeafJobs, effectiveSchedule, machines);
  const overloadedMachines = settings.capacityAlertsEnabled ? [...machineLoads].filter(([, hours]) => hours / getWeeklyCapacityHours() * 100 >= settings.capacityAlertPercent) : [];
  const alerts: OperationalAlert[] = [];
  if (!online) alerts.push({ id: 'connection-offline', severity: 'critical', title: lang === 'hr' ? 'Radna stanica je izvan mreže' : 'Workstation is offline', detail: lang === 'hr' ? 'Promjene se čuvaju lokalno i sinkronizirat će se nakon povratka veze.' : 'Changes are stored locally and will sync when the connection returns.' });
  if (pendingChanges > 0) alerts.push({ id: `queue-${pendingChanges}`, severity: 'info', title: lang === 'hr' ? 'Promjene čekaju sinkronizaciju' : 'Changes waiting to sync', detail: lang === 'hr' ? `${pendingChanges} lokalnih promjena nalazi se u sigurnom redu čekanja.` : `${pendingChanges} local changes are safely queued.` });
  if (delayedJobs.length) alerts.push({ id: `delayed-${delayedJobs.map((job) => job.id).join('-')}`, severity: 'critical', title: lang === 'hr' ? `${delayedJobs.length} naloga zahtijeva pažnju` : `${delayedJobs.length} work orders need attention`, detail: lang === 'hr' ? 'Rok je probijen ili je nalog označen kao kašnjenje.' : 'The due time has passed or the order is marked delayed.', action: 'progress' });
  if (materialRisks.length) alerts.push({ id: `materials-${materialRisks.map((job) => job.id).join('-')}`, severity: 'warning', title: lang === 'hr' ? 'Rizik dostupnosti materijala' : 'Material availability risk', detail: lang === 'hr' ? `${materialRisks.length} naloga čeka ili kasni s materijalom.` : `${materialRisks.length} work orders have waiting or delayed material.`, action: 'gantt' });
  if (machineConflicts) alerts.push({ id: 'machine-overlap', severity: 'warning', title: lang === 'hr' ? 'Preklapanje na stroju' : 'Machine schedule overlap', detail: lang === 'hr' ? 'Najmanje dva naloga koriste isti stroj u preklapajućem terminu.' : 'At least two orders use the same machine during overlapping time.', action: 'machines', focusJobId: overlapJob?.id });
  if (overloadedMachines.length) alerts.push({ id: `capacity-${settings.capacityAlertPercent}-${overloadedMachines.map(([machine]) => machine).join('-')}`, severity: 'warning', title: lang === 'hr' ? 'Prag kapaciteta je dosegnut' : 'Capacity threshold reached', detail: lang === 'hr' ? `${overloadedMachines.length} ${overloadedMachines.length === 1 ? 'stroj prelazi' : 'stroja prelaze'} ${settings.capacityAlertPercent}% tjednog kapaciteta.` : `${overloadedMachines.length} ${overloadedMachines.length === 1 ? 'machine exceeds' : 'machines exceed'} ${settings.capacityAlertPercent}% weekly capacity.`, action: 'machines' });
  if (settings.absenceAlertsEnabled && absentWorkerIds.size) alerts.push({ id: `absence-${[...absentWorkerIds].join('-')}`, severity: 'info', title: lang === 'hr' ? 'Današnja odsutnost' : 'Today’s absence', detail: lang === 'hr' ? `${absentWorkerIds.size} operatera nije dostupno za raspored.` : `${absentWorkerIds.size} operators are unavailable for scheduling.`, action: 'shifts' });
  if (!alerts.length) alerts.push({ id: `healthy-${today}`, severity: 'success', title: lang === 'hr' ? 'Operacije su stabilne' : 'Operations are stable', detail: lang === 'hr' ? 'Nema aktivnih kašnjenja, konflikata ili problema sa sinkronizacijom.' : 'No active delays, conflicts, or synchronization issues.' });

  const navigationGroup = lang === 'hr' ? 'Navigacija' : 'Navigation';
  const actionGroup = lang === 'hr' ? 'Brze radnje' : 'Quick actions';
  const commands: CommandItem[] = [
    ...tabs.map((item) => ({ id: `nav-${item.key}`, label: item.label, description: lang === 'hr' ? 'Otvori modul' : 'Open module', group: navigationGroup, icon: item.icon, keywords: item.key, run: () => navigate(item.key) })),
    ...(canAccess(role, 'workOrders') ? [{ id: 'new-work-order', label: lang === 'hr' ? 'Novi radni nalog' : 'New work order', description: lang === 'hr' ? 'Pokreni izradu i ispis naloga' : 'Start order creation and printing', group: actionGroup, icon: <IconFlow />, keywords: 'create order print', run: () => navigate('workOrders') }] : []),
    ...(canAccess(role, 'shifts') ? [{ id: 'plan-shifts', label: lang === 'hr' ? 'Planiraj smjene' : 'Plan shifts', description: lang === 'hr' ? 'Generiraj i objavi raspored' : 'Generate and publish a schedule', group: actionGroup, icon: <IconCalendar />, keywords: 'schedule workers', run: () => navigate('shifts') }] : []),
    { id: 'open-settings', label: lang === 'hr' ? 'Postavke radne stanice' : 'Workstation settings', description: lang === 'hr' ? 'Izgled, sigurnost i planiranje' : 'Appearance, security, and planning', group: actionGroup, icon: <IconGear />, shortcut: 'Ctrl Alt S', keywords: 'theme compact lock', run: () => setIsSettingsOpen(true) },
    { id: 'lock-now', label: lang === 'hr' ? 'Zaključaj sada' : 'Lock now', description: lang === 'hr' ? 'Zaštiti trenutnu radnu stanicu' : 'Secure the current workstation', group: actionGroup, icon: <LockStatusIcon />, keywords: 'security pin', run: () => setIsLocked(true) },
  ];

  return <div className={`app-shell${isDimmed ? ' is-dimmed' : ''}`}>
    {secondsRemaining !== null && secondsRemaining <= settings.warningSeconds && <div className="lock-countdown-banner" role="status"><LockStatusIcon /><span>{lang === 'hr' ? `Zaključavanje za ${secondsRemaining} s` : `Locking in ${secondsRemaining}s`}</span><button className="btn btn-blue" onClick={resetTimer}>{lang === 'hr' ? 'Ostani povezan' : 'Keep connected'}</button></div>}
    {forbidden && <div className="access-denied-toast" role="alert"><strong>403</strong><span>{lang === 'hr' ? 'Nemate ovlasti za ovaj modul.' : 'Your role cannot access this module.'}</span></div>}

    {isSidebarOpen && <div className="drawer-overlay" onClick={() => setIsSidebarOpen(false)} />}
    <aside className={`side-drawer${isSidebarOpen ? ' open' : ''}`} aria-hidden={!isSidebarOpen}>
      <div className="drawer-header"><div><span className="eyebrow">Workshop OS</span><div className="drawer-brand">{t.appTitle}</div></div><button className="drawer-close-btn" onClick={() => setIsSidebarOpen(false)} aria-label="Close">×</button></div>
      <div className="drawer-user-card">{settings.avatar ? <img src={settings.avatar} alt="" /> : <span>{operatorName.slice(0, 2).toUpperCase()}</span>}<div><strong>{operatorName}</strong><small>{role}</small></div></div>
      <nav className="drawer-menu" aria-label={lang === 'hr' ? 'Glavna navigacija' : 'Main navigation'}>{tabs.map((item) => <button key={item.key} className={`drawer-menu-btn${tab === item.key ? ' active' : ''}`} onClick={() => { navigate(item.key); setIsSidebarOpen(false); }}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="drawer-footer"><button className="drawer-menu-btn" onClick={() => { setIsSettingsOpen(true); setIsSidebarOpen(false); }}><IconGear />{lang === 'hr' ? 'Postavke' : 'Settings'}</button><button className="drawer-menu-btn danger-link" onClick={logout}><IconLogout />{t.login.logout}</button></div>
    </aside>

    <nav className="top-nav" aria-label={lang === 'hr' ? 'Glavna navigacija' : 'Main navigation'}>
      <div className="nav-brand-group"><button className="nav-icon-button" onClick={() => setIsSidebarOpen(true)} aria-label={lang === 'hr' ? 'Otvori izbornik' : 'Open menu'}><MenuIcon /></button><div><div className="brand">{t.appTitle}</div><small className="nav-active-module">{tabs.find((item) => item.key === tab)?.label}</small></div></div>
      <div className="tabs">{tabs.map((item) => <button key={item.key} className={`tab-btn${tab === item.key ? ' active' : ''}`} onClick={() => navigate(item.key)} title={item.label} aria-label={item.label}><span>{item.icon}</span><small>{item.label}</small></button>)}</div>
      <div className="nav-actions">
        <button className="nav-command-button" onClick={() => setIsCommandOpen(true)} title={lang === 'hr' ? 'Paleta naredbi (Ctrl+K)' : 'Command palette (Ctrl+K)'}><SearchIcon /><span>{lang === 'hr' ? 'Traži' : 'Search'}</span><kbd>⌘K</kbd></button>
        <span className={`connection-pill ${online ? 'online' : 'offline'}`} title={online ? (lang === 'hr' ? 'Povezano' : 'Online') : (lang === 'hr' ? 'Izvan mreže' : 'Offline')}><i />{pendingChanges > 0 && <b>{pendingChanges}</b>}</span>
        <NotificationCenter alerts={alerts} online={online} pendingChanges={pendingChanges} language={lang} activeTab={tab} onNavigate={navigate} />
        <div className="lang-switch"><button className={`lang-btn${lang === 'hr' ? ' active' : ''}`} onClick={() => setLang('hr')}>HR</button><button className={`lang-btn${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>EN</button></div>
        {settings.autoLockEnabled && <button className="nav-lock-status" onClick={() => setIsLocked(true)} title={lang === 'hr' ? 'Zaključaj sada' : 'Lock now'} aria-label={lang === 'hr' ? 'Zaključaj sada' : 'Lock now'}><LockStatusIcon /></button>}
        <button className="theme-toggle-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}>{theme === 'dark' ? <IconSun /> : <IconMoon />}</button>
        <button className="nav-profile-button" onClick={() => setIsSettingsOpen(true)} title={lang === 'hr' ? 'Profil i postavke' : 'Profile and settings'}>{settings.avatar ? <img src={settings.avatar} alt="" /> : <span>{operatorName.slice(0, 2).toUpperCase()}</span>}<small>{operatorName}</small></button>
        <button className="logout-btn" onClick={logout}><IconLogout />{t.login.logout}</button>
      </div>
    </nav>

    <main className="page-content" id="main-content"><AppErrorBoundary language={lang} resetKey={tab} onReset={() => navigate('dashboard')}><Suspense fallback={<div className="page-loading"><span /><span /><span /></div>}>
      {roleResolving ? <div className="page-loading"><span /><span /><span /></div> : <>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'shifts' && canAccess(role, tab) && <ShiftSchedule />}
        {tab === 'machines' && <MachineSchedule />}
        {tab === 'workOrders' && canAccess(role, tab) && <WorkOrderCreator />}
        {tab === 'progress' && <ProgressMonitoring />}
        {tab === 'gantt' && <GanttChart />}
        {tab === 'admin' && isAdmin && <Admin />}
      </>}
    </Suspense></AppErrorBoundary></main>

    <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} isAdmin={isAdmin} />
    <CommandPalette open={isCommandOpen} onClose={() => setIsCommandOpen(false)} commands={commands} language={lang} />
  </div>;
}

export default App;
