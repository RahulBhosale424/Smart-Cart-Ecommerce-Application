'use client';
import { getSession, clearSession } from './session';

// Calls our backend through the gateway. Adds the login token automatically.
export async function api(path, { method = 'GET', body } = {}) {
  const session = getSession();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session && session.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // some responses have no body
  }

  // Token expired: log the user out so they can sign in again
  if (res.status === 401 && session) clearSession();
  if (!res.ok) throw new Error((data && data.message) || 'Something went wrong. Please try again.');
  return data;
}

export const money = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Tell the navbar the cart changed so the count updates
export const cartChanged = () => window.dispatchEvent(new Event('cart-change'));
