'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import ProductCard from '@/components/ProductCard';

function Shop() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q') || '';
  const category = params.get('category') || '';

  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [trending, setTrending] = useState([]);
  const [error, setError] = useState('');

  // Filters and the trending shelf
  useEffect(() => {
    api('/products/categories').then((d) => setCategories(d.categories)).catch(() => {});
    api('/products/trending').then((d) => setTrending(d.products)).catch(() => {});
  }, []);

  // The product list
  useEffect(() => {
    setData(null);
    setError('');
    const qs = new URLSearchParams({ limit: '24' });
    if (q) qs.set('q', q);
    if (category) qs.set('category', category);
    api(`/products?${qs}`).then(setData).catch((e) => setError(e.message));
  }, [q, category]);

  return (
    <>
      {!q && !category && trending.length > 0 && (
        <section>
          <h2>Trending now</h2>
          <p className="muted small">Ranked live from product views (Redis sorted set).</p>
          <div className="grid">
            {trending.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} note={`${p.views} view${p.views === 1 ? '' : 's'}`} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>{q ? `Results for "${q}"` : category ? category : 'All products'}</h2>
        <div className="chips">
          <button className={`chip ${!category && !q ? 'on' : ''}`} onClick={() => router.push('/')}>All</button>
          {categories.map((c) => (
            <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => router.push(`/?category=${encodeURIComponent(c)}`)}>
              {c}
            </button>
          ))}
        </div>

        {error && <div className="alert bad">{error}</div>}
        {!data && !error && <p className="muted">Loading products...</p>}
        {data && data.products.length === 0 && (
          <p className="muted">No products found. If the shop is empty, run the seed command from the setup guide.</p>
        )}
        {data && data.products.length > 0 && (
          <div className="grid">
            {data.products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<p className="muted">Loading...</p>}>
      <Shop />
    </Suspense>
  );
}
