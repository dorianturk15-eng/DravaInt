import { useEffect, useRef, useState } from 'react';
import { IconGear, IconLock, IconLogout } from './Icons';

/**
 * The single home for account-level actions.
 *
 * Before this, Settings was reachable from three places (drawer footer, the
 * profile button, the command palette) and Logout from two (top nav, drawer
 * footer) — UI_MODERNIZATION_PLAN F5. The navigation model now says these live
 * in the profile menu only; the command palette keeps its entries because it
 * is an accelerator, not primary navigation.
 */

export interface ProfileMenuProps {
  operatorName: string;
  role: string;
  avatar?: string;
  /** Hidden when auto-lock is disabled, matching the old nav-lock-status button. */
  canLock: boolean;
  language: 'hr' | 'en';
  onOpenSettings: () => void;
  onLock: () => void;
  onLogout: () => void;
}

const T = {
  hr: { profile: 'Profil i postavke', settings: 'Postavke', lock: 'Zaključaj sada', logout: 'Odjava' },
  en: { profile: 'Profile and settings', settings: 'Settings', lock: 'Lock now', logout: 'Log out' },
} as const;

export function ProfileMenu({
  operatorName, role, avatar, canLock, language, onOpenSettings, onLock, onLogout,
}: ProfileMenuProps) {
  const t = T[language];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Return focus to the trigger, or the menu's closure strands the keyboard.
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="profile-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        className="nav-profile-button"
        onClick={() => setOpen((value) => !value)}
        title={t.profile}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {avatar ? <img src={avatar} alt="" /> : <span>{operatorName.slice(0, 2).toUpperCase()}</span>}
        <small>{operatorName}</small>
      </button>
      {open && (
        <div className="profile-menu-panel" role="menu" aria-label={t.profile}>
          <div className="profile-menu-identity">
            <strong>{operatorName}</strong>
            <small>{role}</small>
          </div>
          <button className="profile-menu-item" role="menuitem" onClick={run(onOpenSettings)}>
            <IconGear /> {t.settings}
          </button>
          {canLock && (
            <button className="profile-menu-item" role="menuitem" onClick={run(onLock)}>
              <IconLock /> {t.lock}
            </button>
          )}
          <button className="profile-menu-item is-danger" role="menuitem" onClick={run(onLogout)}>
            <IconLogout /> {t.logout}
          </button>
        </div>
      )}
    </div>
  );
}
