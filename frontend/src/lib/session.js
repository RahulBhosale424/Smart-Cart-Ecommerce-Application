'use client';
// The logged-in user (and token) is kept in the browser's localStorage.
import { useEffect, useState } from 'react';

const KEY = 'smartcart_session';

export function getSession() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(KEY, JSON.stringify(session));
  window.dispatchEvent(new Event('session-change'));
}

export function clearSession() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('session-change'));
}

// undefined = still checking, null = logged out, object = logged in
export function useSession() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    const update = () => setSession(getSession());
    update();
    window.addEventListener('session-change', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('session-change', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return session;
}
