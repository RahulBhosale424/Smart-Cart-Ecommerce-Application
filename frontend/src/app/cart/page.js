'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, money, cartChanged } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function CartPage() {
  const router = useRouter();
  const session = useSession();
  const [cart, setCart] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api('/cart').then(setCart).catch((e) => setError(e.message)), []);

  useEffect(() => {
    if (session === null) router.push('/login');
    if (session) load();
  }, [session, router, load]);

  async function change(request) {
    setError('');
    try {
      setCart(await request());
      cartChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!session) return <p className="muted">Loading...</p>;
  if (!cart) return <p className="muted">Loading your cart...</p>;

  if (cart.items.length === 0) {
    return (
      <div className="narrow">
        <h1>Your cart is empty</h1>
        <p><Link href="/" className="btn">Browse products</Link></p>
      </div>
    );
  }

  return (
    <>
      <h1>Your cart</h1>
      {error && <div className="alert bad">{error}</div>}
      <div className="cart">
        <div>
          {cart.items.map((item) => (
            <div className="line" key={item.productId}>
              <span className="emoji">{item.emoji}</span>
              <div className="grow">
                <Link href={`/products/${item.productId}`}>{item.name}</Link>
                <div className="muted small">{money(item.price)} each</div>
              </div>
              <div className="stepper">
                <button onClick={() => change(() => api(`/cart/items/${item.productId}`, { method: 'PATCH', body: { qty: item.qty - 1 } }))} aria-label="One less">−</button>
                <span>{item.qty}</span>
                <button onClick={() => change(() => api(`/cart/items/${item.productId}`, { method: 'PATCH', body: { qty: item.qty + 1 } }))} aria-label="One more">+</button>
              </div>
              <div className="line-total">{money(item.price * item.qty)}</div>
              <button className="linklike" onClick={() => change(() => api(`/cart/items/${item.productId}`, { method: 'DELETE' }))}>Remove</button>
            </div>
          ))}
        </div>
        <aside className="summary">
          <h2>Summary</h2>
          <div className="row"><span>{cart.itemCount} item{cart.itemCount === 1 ? '' : 's'}</span><span>{money(cart.total)}</span></div>
          <div className="row total"><span>Total</span><span>{money(cart.total)}</span></div>
          <p className="muted small">Final prices are confirmed by the product database when you place the order.</p>
          <Link href="/checkout" className="btn block">Checkout</Link>
        </aside>
      </div>
    </>
  );
}
