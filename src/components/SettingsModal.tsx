import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { useLogo } from '../logo/LogoContext';
import { useSettings, type AppTab } from '../settings/SettingsContext';
import { useTheme, type ThemePreference } from '../theme/ThemeContext';

type SettingsTab = 'general' | 'alerts' | 'timeouts' | 'data' | 'account';

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function SettingsModal({ open, onClose, isAdmin }: { open: boolean; onClose: () => void; isAdmin: boolean }) {
  const { t, lang, setLang } = useLanguage();
  const { logo, setLogo } = useLogo();
  const { theme, preference, setPreference } = useTheme();
  const { settings, updateSettings, setRoleTimeout, resetSettings, exportBackup, importBackup } = useSettings();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  const matches = (...terms: string[]) => !search || terms.join(' ').toLowerCase().includes(search.toLowerCase());
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200); };

  async function upload(event: React.ChangeEvent<HTMLInputElement>, target: 'wallpaper' | 'avatar' | 'logo') {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2_500_000) { flash(lang === 'hr' ? 'Slika mora biti manja od 2,5 MB.' : 'Image must be smaller than 2.5 MB.'); return; }
    const value = await dataUrl(file);
    if (target === 'logo') setLogo(value);
    else updateSettings({ [target]: value });
    flash(lang === 'hr' ? 'Slika je spremljena.' : 'Image saved.');
  }

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'general', label: lang === 'hr' ? 'Općenito' : 'General' },
    { id: 'alerts', label: lang === 'hr' ? 'Upozorenja' : 'Alerts' },
    { id: 'timeouts', label: lang === 'hr' ? 'Zaključavanje' : 'Locking' },
    { id: 'data', label: lang === 'hr' ? 'Podaci' : 'Data' },
    { id: 'account', label: lang === 'hr' ? 'Profil' : 'Profile' },
  ];

  return <div className="modal-backdrop settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-content settings-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-header">
        <div><span className="eyebrow">DravaInt OS</span><h3 id="settings-title">{lang === 'hr' ? 'Postavke sustava' : 'System settings'}</h3></div>
        <button className="drawer-close-btn" onClick={onClose} aria-label={lang === 'hr' ? 'Zatvori postavke' : 'Close settings'}>×</button>
      </div>

      <div className="settings-search-wrap"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={lang === 'hr' ? 'Pretraži postavke…' : 'Search settings…'} aria-label={lang === 'hr' ? 'Pretraži postavke' : 'Search settings'} /></div>
      <div className="settings-tab-bar" role="tablist">{tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={`settings-tab-btn${tab === item.id ? ' active' : ''}`} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>

      <div className="modal-body settings-body">
        {notice && <div className="inline-success" role="status">✓ {notice}</div>}

        {tab === 'general' && <div className="settings-section-grid">
          {matches('language jezik hr en') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Jezik sučelja' : 'Interface language'}</strong><small>HR / EN</small></div><div className="segmented-setting"><button className={lang === 'hr' ? 'active' : ''} onClick={() => setLang('hr')}>HR</button><button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button></div></section>}
          {matches('theme dark light system tema') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Tema' : 'Theme'}</strong><small>{theme}</small></div><select value={preference} onChange={(event) => setPreference(event.target.value as ThemePreference)}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></section>}
          {matches('default landing početni ekran') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Početni ekran' : 'Landing page'}</strong><small>{lang === 'hr' ? 'Nakon prijave' : 'After sign-in'}</small></div><select value={settings.defaultView} onChange={(event) => updateSettings({ defaultView: event.target.value as AppTab })}><option value="dashboard">{t.nav.dashboard}</option><option value="shifts">{t.nav.shifts}</option><option value="machines">{t.nav.machines}</option><option value="workOrders">{t.nav.workOrders}</option><option value="progress">{t.nav.progress}</option><option value="gantt">{t.nav.gantt}</option>{isAdmin && <option value="admin">{t.nav.admin}</option>}</select></section>}
          {matches('compact layout terminal kompaktno') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Kompaktni prikaz' : 'Compact layout'}</strong><small>{lang === 'hr' ? 'Za manje terminale' : 'For smaller terminals'}</small></div><label className="switch"><input type="checkbox" checked={settings.compactMode} onChange={(event) => updateSettings({ compactMode: event.target.checked })} /><span /></label></section>}
          {matches('gantt row height bar size') && <section className="setting-card setting-card-stack"><div><strong>Gantt · {lang === 'hr' ? 'veličina redaka' : 'row sizing'}</strong><small>{settings.ganttRowHeight}px / {settings.ganttBarFill}%</small></div><label>{lang === 'hr' ? 'Visina retka' : 'Row height'}<input type="range" min={38} max={76} value={settings.ganttRowHeight} onChange={(event) => updateSettings({ ganttRowHeight: Number(event.target.value) })} /></label><label>{lang === 'hr' ? 'Debljina trake' : 'Bar fill'}<input type="range" min={45} max={95} value={settings.ganttBarFill} onChange={(event) => updateSettings({ ganttBarFill: Number(event.target.value) })} /></label></section>}
        </div>}

        {tab === 'alerts' && <div className="settings-section-grid">
          {matches('delay overdue late minutes kašnjenje prag') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Tolerancija kašnjenja' : 'Delay grace period'}</strong><small>{lang === 'hr' ? 'Minute nakon planiranog roka' : 'Minutes after the planned due time'}</small></div><input className="compact-input" type="number" min={0} max={1440} value={settings.delayAlertMinutes} onChange={(event) => updateSettings({ delayAlertMinutes: Math.max(0, Math.min(1440, Number(event.target.value))) })} /></section>}
          {matches('capacity load machine percent kapacitet opterećenje') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Prag kapaciteta stroja' : 'Machine capacity threshold'}</strong><small>{lang === 'hr' ? 'Tjedno opterećenje' : 'Weekly workload'} · {settings.capacityAlertPercent}%</small></div><input className="compact-input" type="number" min={50} max={150} value={settings.capacityAlertPercent} onChange={(event) => updateSettings({ capacityAlertPercent: Math.max(50, Math.min(150, Number(event.target.value))) })} /></section>}
          {matches('material risk shortage materijal') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Upozorenja materijala' : 'Material risk alerts'}</strong><small>{lang === 'hr' ? 'Čekanje i kašnjenje' : 'Waiting and delayed states'}</small></div><label className="switch"><input type="checkbox" checked={settings.materialAlertsEnabled} onChange={(event) => updateSettings({ materialAlertsEnabled: event.target.checked })} /><span /></label></section>}
          {matches('overlap conflict machine preklapanje stroj') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Konflikti rasporeda' : 'Schedule conflicts'}</strong><small>{lang === 'hr' ? 'Preklapanje na istom stroju' : 'Same-machine overlap'}</small></div><label className="switch"><input type="checkbox" checked={settings.scheduleConflictAlertsEnabled} onChange={(event) => updateSettings({ scheduleConflictAlertsEnabled: event.target.checked })} /><span /></label></section>}
          {matches('absence staffing worker odsutnost radnik') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Odsutnosti operatera' : 'Operator absence alerts'}</strong><small>{lang === 'hr' ? 'Današnja dostupnost tima' : 'Today’s team availability'}</small></div><label className="switch"><input type="checkbox" checked={settings.absenceAlertsEnabled} onChange={(event) => updateSettings({ absenceAlertsEnabled: event.target.checked })} /><span /></label></section>}
          <section className="alert-settings-preview"><span className="eyebrow">Live rules</span><strong>{lang === 'hr' ? 'Upozorenja se primjenjuju odmah' : 'Alert rules apply immediately'}</strong><small>{lang === 'hr' ? 'Postavke se spremaju na ovoj radnoj stanici i sinkroniziraju sa zajedničkim postavkama kada je Supabase povezan.' : 'Settings persist on this workstation and synchronize with shared settings when Supabase is connected.'}</small></section>
        </div>}

        {tab === 'timeouts' && <div className="settings-section-grid">
          {matches('auto lock enable master') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Automatsko zaključavanje' : 'Automatic lock'}</strong><small>{lang === 'hr' ? 'Glavni prekidač' : 'Master toggle'}</small></div><label className="switch"><input type="checkbox" checked={settings.autoLockEnabled} onChange={(event) => updateSettings({ autoLockEnabled: event.target.checked })} /><span /></label></section>}
          {matches('window blur focus security') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Zaključaj pri gubitku fokusa' : 'Lock on window blur'}</strong><small>{lang === 'hr' ? 'Sigurnost terminala' : 'Terminal security'}</small></div><label className="switch"><input type="checkbox" checked={settings.lockOnBlur} onChange={(event) => updateSettings({ lockOnBlur: event.target.checked })} /><span /></label></section>}
          {matches('schedule range vrijeme aktivno') && <section className="setting-card setting-card-stack"><div><strong>{lang === 'hr' ? 'Aktivni vremenski raspon' : 'Active schedule range'}</strong><small>{settings.lockWindowStart}–{settings.lockWindowEnd}</small></div><div className="two-field-row"><input type="time" value={settings.lockWindowStart} onChange={(event) => updateSettings({ lockWindowStart: event.target.value })} /><input type="time" value={settings.lockWindowEnd} onChange={(event) => updateSettings({ lockWindowEnd: event.target.value })} /></div></section>}
          {matches('pin unlock keypad') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Brzi PIN' : 'Quick PIN'}</strong><small>{lang === 'hr' ? '4 ili 6 znamenki' : '4 or 6 digits'}</small></div><input className="compact-input" inputMode="numeric" maxLength={6} value={settings.lockPin} onChange={(event) => { const value = event.target.value.replace(/\D/g, '').slice(0, 6); updateSettings({ lockPin: value }); }} placeholder="••••" /></section>}
          {Object.entries(settings.roleTimeouts).filter(([role]) => matches(role, 'timeout sekunde')).map(([role, seconds]) => <section className="setting-card" key={role}><div><strong>{role}</strong><small>{lang === 'hr' ? '5 s – 24 h' : '5 sec – 24 hr'}</small></div><input className="compact-input" type="number" min={5} max={86400} value={seconds} onChange={(event) => setRoleTimeout(role, Number(event.target.value))} /></section>)}
        </div>}

        {tab === 'data' && <div className="settings-section-grid">
          {matches('backup export izvoz') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Izvoz sigurnosne kopije' : 'Export backup'}</strong><small>JSON · local workspace</small></div><button className="btn btn-ghost" onClick={exportBackup}>{lang === 'hr' ? 'Izvezi' : 'Export'}</button></section>}
          {matches('backup import uvoz') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Uvoz sigurnosne kopije' : 'Import backup'}</strong><small>JSON</small></div><label className="file-button">{lang === 'hr' ? 'Odaberi' : 'Choose'}<input type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { await importBackup(file); flash(lang === 'hr' ? 'Sigurnosna kopija je uvezena.' : 'Backup imported.'); } catch { flash(lang === 'hr' ? 'Datoteka nije valjana.' : 'Invalid backup file.'); } }} /></label></section>}
          {matches('workday start end boundaries') && <section className="setting-card setting-card-stack"><div><strong>{lang === 'hr' ? 'Granice radnog dana' : 'Workday boundaries'}</strong><small>{settings.workdayStart}:00–{settings.workdayEnd}:00</small></div><div className="two-field-row"><input type="number" min={0} max={23} value={settings.workdayStart} onChange={(event) => updateSettings({ workdayStart: Number(event.target.value) })} /><input type="number" min={1} max={24} value={settings.workdayEnd} onChange={(event) => updateSettings({ workdayEnd: Number(event.target.value) })} /></div></section>}
          {matches('holidays praznici cpm') && <section className="setting-card setting-card-stack"><div><strong>{lang === 'hr' ? 'Praznici i neradni dani' : 'Holidays'}</strong><small>YYYY-MM-DD</small></div><textarea rows={3} value={settings.holidays.join('\n')} onChange={(event) => updateSettings({ holidays: event.target.value.split(/[,\n]/).map((value) => value.trim()).filter(Boolean) })} /></section>}
          {matches('critical tolerance cpm') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'CPM tolerancija' : 'CPM tolerance'}</strong><small>ms</small></div><input className="compact-input" type="number" min={0} value={settings.criticalToleranceMs} onChange={(event) => updateSettings({ criticalToleranceMs: Number(event.target.value) })} /></section>}
          {matches('reset defaults vrati') && <section className="setting-card danger-setting"><div><strong>{lang === 'hr' ? 'Vrati zadane postavke' : 'Restore defaults'}</strong><small>{lang === 'hr' ? 'Ne briše naloge ni rasporede' : 'Keeps orders and schedules'}</small></div><button className="btn btn-red" onClick={() => { resetSettings(); setPreference('system'); flash(lang === 'hr' ? 'Postavke su vraćene.' : 'Defaults restored.'); }}>{lang === 'hr' ? 'Vrati' : 'Restore'}</button></section>}
        </div>}

        {tab === 'account' && <div className="settings-section-grid">
          {matches('avatar profile slika') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Profilna slika' : 'Profile picture'}</strong><small>PNG / JPG</small></div><div className="upload-preview">{settings.avatar && <img src={settings.avatar} alt="" />}<label className="file-button">{lang === 'hr' ? 'Učitaj' : 'Upload'}<input type="file" accept="image/*" onChange={(event) => void upload(event, 'avatar')} /></label></div></section>}
          {isAdmin && matches('wallpaper lock screen pozadina') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Pozadina zaključanog zaslona' : 'Lock wallpaper'}</strong><small>PNG / JPG</small></div><div className="upload-preview">{settings.wallpaper && <img src={settings.wallpaper} alt="" />}<label className="file-button">{lang === 'hr' ? 'Učitaj' : 'Upload'}<input type="file" accept="image/*" onChange={(event) => void upload(event, 'wallpaper')} /></label></div></section>}
          {isAdmin && matches('greeting message poruka') && <section className="setting-card setting-card-stack"><div><strong>{lang === 'hr' ? 'Poruka smjene' : 'Shift greeting'}</strong><small>{lang === 'hr' ? 'Prikazuje se na zaključanom zaslonu' : 'Shown on lock screen'}</small></div><input value={settings.greeting} maxLength={120} onChange={(event) => updateSettings({ greeting: event.target.value })} placeholder={lang === 'hr' ? 'Obavezne zaštitne naočale.' : 'Safety glasses required.'} /></section>}
          {isAdmin && matches('logo brand upload') && <section className="setting-card"><div><strong>{lang === 'hr' ? 'Logotip tvrtke' : 'Company logo'}</strong><small>{logo ? (lang === 'hr' ? 'Prilagođen' : 'Custom') : 'DravaInt'}</small></div><div className="upload-preview">{logo && <img src={logo} alt="Logo" />}<label className="file-button">{lang === 'hr' ? 'Učitaj' : 'Upload'}<input type="file" accept="image/*" onChange={(event) => void upload(event, 'logo')} /></label></div></section>}
        </div>}
      </div>

      <div className="modal-footer"><span className="settings-hint">Ctrl + Alt + S</span><button className="btn btn-blue" onClick={() => { flash(lang === 'hr' ? 'Sve promjene su spremljene.' : 'All changes saved.'); }}>{lang === 'hr' ? 'Spremljeno' : 'Saved'}</button><button className="btn btn-ghost" onClick={onClose}>{lang === 'hr' ? 'Zatvori' : 'Close'}</button></div>
    </div>
  </div>;
}
