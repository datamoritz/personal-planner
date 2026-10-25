'use client';

import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** Recheck on return to the app, including browser back/forward restoration. */
export function PrivateSession({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    async function verify() {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!disposed && response.ok) setLocked(false);
        if (!disposed && response.status === 401) {
          setLocked(true);
          window.location.replace('/login');
        }
      } finally { busy = false; }
    }
    const check = () => { void verify().catch(() => { /* An active device can retain unsynced edits during a brief outage. */ }); };
    const hide = () => {
      if (document.visibilityState === 'hidden') flushSync(() => setLocked(true));
      else check();
    };
    const pageHide = () => flushSync(() => setLocked(true));
    const interval = setInterval(check, 60000);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', pageHide);
    check();
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', pageHide);
    };
  }, []);
  return <>
    {locked && <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-secondary)]">Checking private access…</div>}
    <div className="h-full" hidden={locked} inert={locked}>{children}</div>
  </>;
}
