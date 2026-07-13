import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { useSettings } from '../settings/SettingsContext';
import { useShifts } from '../shifts/ShiftsContext';

function LockIcon() {
  return <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="4.5" y="10" width="15" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15.5" r="1.25" fill="currentColor" stroke="none" /><path d="M12 16.5V18" /></svg>;
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" />{hidden && <path d="M4 4l16 16" />}</svg>;
}

export function LockScreen({ username, operatorName, onUnlock, onUnlocked, onLogout }: { username: string; operatorName: string; onUnlock: (secret: string) => Promise<boolean> | boolean; onUnlocked: () => void; onLogout: () => void }) {
  const { lang } = useLanguage();
  const { settings } = useSettings();
  const { definitions } = useShifts();
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(new Date());
  const [attempts, setAttempts] = useState(() => Number(sessionStorage.getItem('dravaint-unlock-attempts')) || 0);
  const [lockoutUntil, setLockoutUntil] = useState(() => Number(sessionStorage.getItem('dravaint-lockout-until')) || 0);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9' && document.activeElement?.tagName !== 'INPUT') setSecret((value) => `${value}${event.key}`.slice(0, 64));
      if (event.key === 'Backspace' && document.activeElement?.tagName !== 'INPUT') setSecret((value) => value.slice(0, -1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const activeShift = useMemo(() => {
    const minutes = now.getHours() * 60 + now.getMinutes();
    return definitions.find((definition) => {
      const [startHour, startMinute] = definition.startTime.split(':').map(Number);
      const [endHour, endMinute] = definition.endTime.split(':').map(Number);
      const start = startHour * 60 + startMinute;
      const end = endHour * 60 + endMinute;
      return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
    }) ?? definitions[0];
  }, [definitions, now]);

  const shiftProgress = useMemo(() => {
    if (!activeShift) return 0;
    const [startHour, startMinute] = activeShift.startTime.split(':').map(Number);
    const [endHour, endMinute] = activeShift.endTime.split(':').map(Number);
    const start = startHour * 60 + startMinute;
    let end = endHour * 60 + endMinute;
    let current = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    if (end <= start) end += 1440;
    if (current < start) current += 1440;
    return Math.max(0, Math.min(1, (current - start) / (end - start)));
  }, [activeShift, now]);

  const lockoutSeconds = Math.max(0, Math.ceil((lockoutUntil - now.getTime()) / 1000));
  const circumference = 2 * Math.PI * 52;

  function keypad(value: string) {
    navigator.vibrate?.(12);
    if (value === 'clear') setSecret('');
    else if (value === 'backspace') setSecret((current) => current.slice(0, -1));
    else setSecret((current) => `${current}${value}`.slice(0, 64));
    setError('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lockoutSeconds > 0) return;
    const valid = await onUnlock(secret);
    if (valid) {
      sessionStorage.removeItem('dravaint-unlock-attempts');
      sessionStorage.removeItem('dravaint-lockout-until');
      setUnlocking(true);
      window.setTimeout(() => { setSecret(''); onUnlocked(); }, 320);
      return;
    }
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    sessionStorage.setItem('dravaint-unlock-attempts', String(nextAttempts));
    setSecret('');
    if (nextAttempts >= 3) {
      const until = Date.now() + 60_000;
      setLockoutUntil(until);
      sessionStorage.setItem('dravaint-lockout-until', String(until));
      setAttempts(0);
      sessionStorage.setItem('dravaint-unlock-attempts', '0');
      setError(lang === 'hr' ? 'Previše pokušaja. Pričekajte 60 sekundi.' : 'Too many attempts. Wait 60 seconds.');
    } else {
      setError(lang === 'hr' ? `Pogrešan PIN ili lozinka. Preostalo pokušaja: ${3 - nextAttempts}.` : `Incorrect PIN or password. ${3 - nextAttempts} attempts remaining.`);
    }
  }

  return <div className={`lock-screen${unlocking ? ' is-unlocking' : ''}`} style={settings.wallpaper ? { backgroundImage: `linear-gradient(rgba(4,10,24,.72),rgba(4,10,24,.9)),url(${settings.wallpaper})` } : undefined}>
    <div className="lock-ambient lock-ambient-a" /><div className="lock-ambient lock-ambient-b" />
    <form className="lock-card" onSubmit={submit}>
      <header className="lock-brand-row"><span className="lock-brand-mark"><LockIcon /></span><span><strong>DravaInt</strong><small>{lang === 'hr' ? 'Sigurni radionički terminal' : 'Secure workshop terminal'}</small></span></header>
      <div className="shift-ring-wrap">
        <svg className="shift-progress-ring" viewBox="0 0 120 120"><circle className="ring-track" cx="60" cy="60" r="52" /><circle className="ring-value" cx="60" cy="60" r="52" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - shiftProgress)} /></svg>
        <div className="shift-clock"><strong>{now.toLocaleTimeString(lang === 'hr' ? 'hr-HR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</strong><small>{activeShift ? (lang === 'hr' ? activeShift.nameHr : activeShift.nameEn) : '—'}</small></div>
      </div>
      <div className="lock-date">{now.toLocaleDateString(lang === 'hr' ? 'hr-HR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      {settings.greeting && <div className="lock-greeting">{settings.greeting}</div>}
      <div className="operator-banner">{settings.avatar ? <img src={settings.avatar} alt="" /> : <span>{operatorName.slice(0, 2).toUpperCase()}</span>}<div><small>{lang === 'hr' ? 'Aktivni operater' : 'Active operator'}</small><strong>{operatorName || username}</strong></div></div>
      <label className="lock-input-label">{lang === 'hr' ? 'PIN ili lozinka' : 'PIN or password'}<span className="lock-input-wrap"><input type={showSecret ? 'text' : 'password'} inputMode="numeric" value={secret} onChange={(event) => { setSecret(event.target.value); setError(''); }} autoFocus disabled={lockoutSeconds > 0} placeholder="••••" aria-describedby={error ? 'lock-error' : undefined} /><button type="button" onClick={() => setShowSecret((value) => !value)} aria-label={showSecret ? 'Hide password' : 'Show password'}><EyeIcon hidden={!showSecret} /></button></span></label>
      <div className="pin-keypad">{['1','2','3','4','5','6','7','8','9','clear','0','backspace'].map((key) => <button key={key} type="button" className="pin-keypad-btn" onClick={() => keypad(key)} disabled={lockoutSeconds > 0}>{key === 'clear' ? 'C' : key === 'backspace' ? '⌫' : key}</button>)}</div>
      {error && <p className="lock-error" id="lock-error" role="alert">{error}</p>}
      {lockoutSeconds > 0 && <div className="lockout-counter">{lang === 'hr' ? 'Pokušajte ponovno za' : 'Try again in'} <strong>{lockoutSeconds}s</strong></div>}
      <div className="lock-actions"><button className="btn btn-blue" type="submit" disabled={!secret || lockoutSeconds > 0}>{lang === 'hr' ? 'Otključaj terminal' : 'Unlock terminal'}</button><button className="btn btn-red" type="button" onClick={onLogout}>{lang === 'hr' ? 'Hitna odjava' : 'Emergency logout'}</button></div>
    </form>
  </div>;
}
