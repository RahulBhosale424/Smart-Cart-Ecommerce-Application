'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, money } from '@/lib/api';
import { useSession } from '@/lib/session';

// The order page shows the saga as it happens:
//   1. order saved  2. payment (Kafka -> payment service -> Stripe)  3. confirmed OR cancelled + stock restored
// While the status is PENDING the page asks the server again every 1.5 seconds.

function Step({ state, title, text }) {
  return (
    <li className={`step ${state}`}>
      <span className="dot" aria-hidden="true">{state === 'done' ? '✓' : state === 'failed' ? '✕' : ''}</span>
      <div>
        <strong>{title}</strong>
        <div className="muted small">{text}</div>
      </div>
    </li>
  );
}

export default function OrderPage() {
  const { id } = useParams();
  const router = useRouter();
  const session = useSession();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session === null) router.push('/login');
    if (!session) return undefined;

    let stopped = false;
    let attempts = 0;
    async function poll() {
      try {
        const data = await api(`/orders/${id}`);
        if (stopped) return;
        setOrder(data);
        attempts += 1;
        if (data.status === 'PENDING' && attempts < 40) setTimeout(poll, 1500);
      } catch (e) {
        if (!stopped) setError(e.message);
      }
    }
    poll();
    return () => { stopped = true; };
  }, [id, session, router]);

  if (error) return <div className="alert bad">{error}</div>;
  if (!order) return <p className="muted">Loading your order...</p>;

  const pending = order.status === 'PENDING';
  const confirmed = order.status === 'CONFIRMED';
  const cancelled = order.status === 'CANCELLED';

  return (
    <>
      <h1>{confirmed ? 'Order confirmed' : cancelled ? 'Order cancelled' : 'Processing your order'}</h1>
      <p className="mono small muted">{order.id}</p>

      <div className="cart">
        <div>
          <ol className="timeline">
            <Step state="done" title="Order placed" text="Stock reserved and the order saved." />
            <Step
              state={pending ? 'active' : confirmed ? 'done' : 'failed'}
              title="Payment"
              text={pending ? 'Waiting for the payment service...' : confirmed ? `Paid. Reference ${order.paymentId}` : order.failureReason}
            />
            <Step
              state={pending ? 'wait' : confirmed ? 'done' : 'failed'}
              title={cancelled ? 'Cancelled' : 'Confirmed'}
              text={pending ? 'We will update this page automatically.' : confirmed ? 'A confirmation email was sent.' : 'The items went back to the shelf and you were not charged.'}
            />
          </ol>
        </div>

        <aside className="summary">
          <h2>Items</h2>
          {order.items.map((i) => (
            <div className="row" key={i.productId}><span>{i.name} × {i.qty}</span><span>{money(i.price * i.qty)}</span></div>
          ))}
          <div className="row total"><span>Total</span><span>{money(order.total)}</span></div>
          {order.shipping && <p className="muted small">Deliver to {order.shipping.name}, {order.shipping.address}, {order.shipping.city} {order.shipping.pincode}</p>}
        </aside>
      </div>
    </>
  );
}
