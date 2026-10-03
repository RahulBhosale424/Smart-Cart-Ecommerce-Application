'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, money, cartChanged } from '@/lib/api';
import { useSession } from '@/lib/session';

const CARDS = [
  { id: 'pm_card_visa', title: 'Test card: payment succeeds', text: 'Stripe test card. The order will be confirmed.' },
  { id: 'pm_card_chargeDeclined', title: 'Test card: card is declined', text: 'Watch the order get cancelled and the stock go back to the shelf.' },
];

export default function CheckoutPage() {
  const router = useRouter();
  const session = useSession();
  const [cart, setCart] = useState(null);
  const [shipping, setShipping] = useState({ name: '', address: '', city: '', pincode: '' });
  const [paymentMethod, setPaymentMethod] = useState(CARDS[0].id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session === null) router.push('/login');
    if (session) {
      setShipping((s) => ({ ...s, name: s.name || session.user.name }));
      api('/cart').then(setCart).catch((e) => setError(e.message));
    }
  }, [session, router]);

  const set = (field) => (e) => setShipping({ ...shipping, [field]: e.target.value });

  async function placeOrder(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const order = await api('/orders', { method: 'POST', body: { shipping, paymentMethod } });
      cartChanged();
      router.push(`/orders/${order.orderId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!session || !cart) return <p className="muted">Loading...</p>;
  if (cart.items.length === 0) return <div className="narrow"><h1>Your cart is empty</h1></div>;

  return (
    <>
      <h1>Checkout</h1>
      <form className="cart" onSubmit={placeOrder}>
        <div className="form">
          <h2>Delivery address</h2>
          <label>Name<input value={shipping.name} onChange={set('name')} required minLength={2} /></label>
          <label>Address<input value={shipping.address} onChange={set('address')} required minLength={5} /></label>
          <div className="two">
            <label>City<input value={shipping.city} onChange={set('city')} required /></label>
            <label>Pincode<input value={shipping.pincode} onChange={set('pincode')} required pattern="[0-9]{6}" inputMode="numeric" title="6 digits" /></label>
          </div>

          <h2>Payment</h2>
          <p className="muted small">Demo mode: you choose a Stripe test card. Real card numbers are never entered or stored.</p>
          {CARDS.map((card) => (
            <label key={card.id} className={`choice ${paymentMethod === card.id ? 'on' : ''}`}>
              <input type="radio" name="card" checked={paymentMethod === card.id} onChange={() => setPaymentMethod(card.id)} />
              <span><strong>{card.title}</strong><br /><span className="muted small">{card.text}</span></span>
            </label>
          ))}
          {error && <div className="alert bad" role="alert">{error}</div>}
        </div>

        <aside className="summary">
          <h2>Your order</h2>
          {cart.items.map((i) => (
            <div className="row" key={i.productId}><span>{i.name} × {i.qty}</span><span>{money(i.price * i.qty)}</span></div>
          ))}
          <div className="row total"><span>Total</span><span>{money(cart.total)}</span></div>
          <button className="btn block" disabled={busy}>{busy ? 'Placing order...' : 'Place order'}</button>
        </aside>
      </form>
    </>
  );
}
