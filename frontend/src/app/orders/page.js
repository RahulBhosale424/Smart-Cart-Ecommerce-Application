'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, money } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function OrdersPage() {
  const router = useRouter();
  const session = useSession();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session === null) router.push('/login');
    if (session) api('/orders').then((d) => setOrders(d.orders)).catch((e) => setError(e.message));
  }, [session, router]);

  if (!session) return <p className="muted">Loading...</p>;
  return (
    <>
      <h1>Your orders</h1>
      {error && <div className="alert bad">{error}</div>}
      {!orders && !error && <p className="muted">Loading...</p>}
      {orders && orders.length === 0 && <p className="muted">No orders yet.</p>}
      {orders && orders.map((o) => (
        <Link key={o.id} href={`/orders/${o.id}`} className="order-row">
          <div>
            <div className="mono small">{o.id}</div>
            <div className="muted small">{new Date(o.createdAt).toLocaleString('en-IN')}</div>
          </div>
          <div className="price">{money(o.total)}</div>
          <span className={`pill ${o.status === 'CONFIRMED' ? 'ok' : o.status === 'CANCELLED' ? 'bad' : 'warn'}`}>{o.status}</span>
        </Link>
      ))}
    </>
  );
}
