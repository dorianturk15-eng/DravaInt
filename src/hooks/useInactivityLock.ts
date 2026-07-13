import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../settings/SettingsContext';

const LOCK_KEY = 'dravaint-session-locked';

function timeInRange(start: string, end: string) {
  const now = new Date();
  const value = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const from = startHour * 60 + startMinute;
  const to = endHour * 60 + endMinute;
  return from <= to ? value >= from && value <= to : value >= from || value <= to;
}

function chime() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.22);
  } catch {
    // Audio feedback is optional and may be blocked until the first interaction.
  }
}

export function useInactivityLock({ authenticated, role, settings }: { authenticated: boolean; role: string; settings: AppSettings }) {
  const [isLocked, setLockedState] = useState(() => sessionStorage.getItem(LOCK_KEY) === 'true');
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [isDimmed, setIsDimmed] = useState(false);
  const lastActivity = useRef(Date.now());
  const chimed = useRef(false);

  const setIsLocked = useCallback((locked: boolean) => {
    sessionStorage.setItem(LOCK_KEY, String(locked));
    setLockedState(locked);
    if (!locked) {
      lastActivity.current = Date.now();
      setIsDimmed(false);
      chimed.current = false;
    }
  }, []);

  const resetTimer = useCallback(() => {
    lastActivity.current = Date.now();
    setIsDimmed(false);
    chimed.current = false;
  }, []);

  useEffect(() => {
    if (!authenticated || isLocked || !settings.autoLockEnabled || !timeInRange(settings.lockWindowStart, settings.lockWindowEnd)) {
      setSecondsRemaining(null);
      setIsDimmed(false);
      return;
    }
    const timeoutSeconds = settings.roleTimeouts[role] ?? 900;
    resetTimer();
    setSecondsRemaining(timeoutSeconds);

    const activity = () => resetTimer();
    const blur = () => { if (settings.lockOnBlur) setIsLocked(true); };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    window.addEventListener('blur', blur);

    const interval = window.setInterval(() => {
      if (document.documentElement.dataset.ganttDragging === 'true') {
        resetTimer();
        return;
      }
      const elapsed = Math.floor((Date.now() - lastActivity.current) / 1000);
      const remaining = timeoutSeconds - elapsed;
      setSecondsRemaining(Math.max(0, remaining));
      setIsDimmed(elapsed >= 30 && remaining > 0);
      if (remaining <= 10 && !chimed.current) {
        chimed.current = true;
        chime();
      }
      if (remaining <= 0) setIsLocked(true);
    }, 1000);

    return () => {
      window.clearInterval(interval);
      events.forEach((event) => window.removeEventListener(event, activity));
      window.removeEventListener('blur', blur);
    };
  }, [authenticated, isLocked, resetTimer, role, setIsLocked, settings]);

  return { isLocked, setIsLocked, secondsRemaining, isDimmed, resetTimer };
}
