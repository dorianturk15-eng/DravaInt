import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppTab } from '../settings/SettingsContext';

export interface OperationalAlert {
  id: string;
  title: string;
  detail: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
  action?: AppTab;
}

interface NotificationCenterProps {
  alerts: OperationalAlert[];
  online: boolean;
  pendingChanges: number;
  language: 'hr' | 'en';
  activeTab: AppTab;
  onNavigate: (tab: AppTab) => void;
}

const READ_KEY = 'dravaint-read-operational-alerts-v1';

function loadRead(): string[] {
  try { return JSON.parse(localStorage.getItem(READ_KEY) || '[]') as string[]; } catch { return []; }
}

export function NotificationCenter({ alerts, online, pendingChanges, language, activeTab, onNavigate }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(loadRead()));
  const rootRef = useRef<HTMLDivElement>(null);
  const unread = useMemo(() => alerts.filter((alert) => !readIds.has(alert.id)).length, [alerts, readIds]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);

  useEffect(() => setOpen(false), [activeTab]);

  function persistRead(next: Set<string>) {
    setReadIds(next);
    localStorage.setItem(READ_KEY, JSON.stringify([...next].slice(-100)));
  }

  function openAlert(alert: OperationalAlert) {
    persistRead(new Set(readIds).add(alert.id));
    if (alert.action) onNavigate(alert.action);
    setOpen(false);
  }

  return <div className="notification-center" ref={rootRef}>
    <button className="nav-icon-button notification-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={language === 'hr' ? `${unread} nepročitanih upozorenja` : `${unread} unread alerts`} title={language === 'hr' ? 'Operativna upozorenja' : 'Operational alerts'}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>
      {unread > 0 && <span className="notification-badge">{unread > 9 ? '9+' : unread}</span>}
    </button>
    {open && <section className="notification-panel" role="dialog" aria-label={language === 'hr' ? 'Operativna upozorenja' : 'Operational alerts'}>
      <header><div><span className="eyebrow">Live operations</span><h3>{language === 'hr' ? 'Centar upozorenja' : 'Alert center'}</h3></div>{unread > 0 && <button onClick={() => persistRead(new Set(alerts.map((alert) => alert.id)))}>{language === 'hr' ? 'Označi sve' : 'Mark all read'}</button>}</header>
      <div className={`connection-summary ${online ? 'online' : 'offline'}`}><span /><div><strong>{online ? (language === 'hr' ? 'Sustav je povezan' : 'System connected') : (language === 'hr' ? 'Izvanmrežni način rada' : 'Offline mode')}</strong><small>{pendingChanges ? (language === 'hr' ? `${pendingChanges} promjena čeka sinkronizaciju` : `${pendingChanges} changes waiting to sync`) : (language === 'hr' ? 'Sve promjene su sinkronizirane' : 'All changes are synchronized')}</small></div></div>
      <div className="notification-list">
        {alerts.length ? alerts.map((alert) => <button key={alert.id} className={`notification-item severity-${alert.severity}${readIds.has(alert.id) ? ' is-read' : ''}`} onClick={() => openAlert(alert)}>
          <i /><span><strong>{alert.title}</strong><small>{alert.detail}</small></span>{alert.action && <b>→</b>}
        </button>) : <div className="notification-empty"><span>✓</span><strong>{language === 'hr' ? 'Sve je pod kontrolom' : 'Everything is under control'}</strong><small>{language === 'hr' ? 'Nema aktivnih operativnih upozorenja.' : 'There are no active operational alerts.'}</small></div>}
      </div>
    </section>}
  </div>;
}
