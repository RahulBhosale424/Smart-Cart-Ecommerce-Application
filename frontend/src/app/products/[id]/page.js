'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, money, cartChanged } from '@/lib/api';
import { useSession } from '@/lib/session';
import ProductCard, { stockLabel } from '@/components/ProductCard';

export default function ProductPage() {
  const { id } = useParams();
  const router = useRouter();
  const session = useSession();

  const [product, setProduct] = useState(null);
  const [recs, setRecs] = useState(null);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProduct(null);
    setRecs(null);
    setError('');
    api(`/products/${id}`).then(setProduct).catch((e) => setError(e.message));
    api(`/products/${id}/recommendations`).then(setRecs).catch(() => setRecs({ recommendations: [] }));
  }, [id]);

  async function addToCart() {
    if (!session) return router.push('/login');
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await api('/cart/items', {
        method: 'POST',
        body: { productId: product.id, name: product.name, price: product.price, emoji: product.emoji, qty },
      });
      cartChanged();
      setMessage('Added to your cart.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !product) return <div className="alert bad">{error}</div>;
  if (!product) return <p className="muted">Loading...</p>;

  const label = stockLabel(product.stock);
  return (
    <>
      <div className="detail">
        <div className="detail-tile"><span className="emoji big">{product.emoji}</span></div>
        <div>
          <p className="muted">{product.brand} · {product.category}</p>
          <h1>{product.name}</h1>
          <div className="price large">{money(product.price)}</div>
          <p><span className={`pill ${label.tone}`}>{label.text}</span></p>
          <p>{product.description}</p>
          {product.specs && product.specs.length > 0 && (
            <ul className="specs">
              {product.specs.map((s) => <li key={s.key}><span className="muted">{s.key}</span> {s.value}</li>)}
            </ul>
          )}
          {product.stock > 0 && (
            <div className="buy">
              <select value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label="Quantity">
                {Array.from({ length: Math.min(10, product.stock) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
              </select>
              <button className="btn" onClick={addToCart} disabled={busy}>{busy ? 'Adding...' : 'Add to cart'}</button>
            </div>
          )}
          {message && <div className="alert ok">{message}</div>}
          {error && <div className="alert bad">{error}</div>}
        </div>
      </div>

      <section>
        <h2>You may also like</h2>
        {!recs && <p className="muted">Finding similar products...</p>}
        {recs && recs.recommendations.length === 0 && <p className="muted">No similar products yet.</p>}
        {recs && recs.recommendations.length > 0 && (
          <div className="grid">
            {recs.recommendations.map((p) => (
              <ProductCard key={p.id} product={p} note={p.similarity ? `${Math.round(p.similarity * 100)}% similar` : 'Same category'} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
