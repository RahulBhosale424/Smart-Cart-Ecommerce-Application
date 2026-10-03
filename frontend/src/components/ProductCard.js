import Link from 'next/link';
import { money } from '@/lib/api';

const TILE = {
  electronics: '#E1E8FF',
  footwear: '#FBE6D2',
  accessories: '#E1EFE6',
  sports: '#DDF0EE',
  clothing: '#F6E1EA',
  books: '#EFE8D2',
  home: '#E9E4F5',
};

export function stockLabel(stock) {
  if (stock <= 0) return { text: 'Out of stock', tone: 'bad' };
  if (stock <= 5) return { text: `Only ${stock} left`, tone: 'warn' };
  return { text: 'In stock', tone: 'ok' };
}

export default function ProductCard({ product, note }) {
  const label = stockLabel(product.stock);
  return (
    <Link href={`/products/${product.id}`} className="card">
      <div className="tile" style={{ background: TILE[product.category] || '#E8ECEA' }}>
        <span className="emoji">{product.emoji}</span>
      </div>
      <div className="card-body">
        <div className="card-name">{product.name}</div>
        <div className="muted small">{product.brand}</div>
        <div className="card-row">
          <span className="price">{money(product.price)}</span>
          <span className={`pill ${label.tone}`}>{label.text}</span>
        </div>
        {note ? <div className="muted small note">{note}</div> : null}
      </div>
    </Link>
  );
}
