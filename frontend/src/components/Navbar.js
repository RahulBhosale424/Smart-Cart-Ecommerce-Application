'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, clearSession } from '@/lib/session';
import { api } from '@/lib/api';

export default function Navbar() {
  const session = useSession();
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!session) {
      setCount(0);
      return undefined;
    }
    const load = () => api('/cart').then((c) => setCount(c.itemCount)).catch(() => {});
    load();
    window.addEventListener('cart-change', load);
    return () => window.removeEventListener('cart-change', load);
  }, [session]);

  const submit = (e) => {
    e.preventDefault();
    router.push(search.trim() ? `/?q=${encodeURIComponent(search.trim())}` : '/');
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="logo">SmartCart</Link>
        <form onSubmit={submit} className="search">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" aria-label="Search products" />
        </form>
        <nav className="nav">
          {session ? (
            <>
              <Link href="/orders">Orders</Link>
              <Link href="/cart">Cart{count > 0 ? ` (${count})` : ''}</Link>
              <button className="linklike" onClick={() => { clearSession(); router.push('/'); }}>
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/register" className="btn small">Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
