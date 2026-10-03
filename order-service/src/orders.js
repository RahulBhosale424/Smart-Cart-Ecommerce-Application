// All database work for orders.
//
// Every status change uses  "UPDATE ... WHERE status = 'PENDING'".
// If the same Kafka message arrives twice, the second update matches
// no rows and nothing happens. That is how we make duplicates harmless.

const crypto = require('crypto');
const { addEvent } = require('./outbox');
const { computeTotal } = require('./logic');
const { TOPICS } = require('./kafka');

function createOrderStore(pool) {
  async function inTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Saves the order, its items AND the "order.placed" event together.
  async function createOrder({ userId, email, items, shipping, paymentMethod }) {
    const id = crypto.randomUUID();
    const total = computeTotal(items);

    await inTransaction(async (client) => {
      await client.query(
        'INSERT INTO orders (id, user_id, user_email, status, total, shipping) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, userId, email || null, 'PENDING', total, JSON.stringify(shipping)]
      );
      for (const item of items) {
        await client.query(
          'INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES ($1, $2, $3, $4, $5)',
          [id, item.productId, item.name, item.price, item.qty]
        );
      }
      await addEvent(client, TOPICS.ORDER_PLACED, id, 'ORDER_PLACED', {
        orderId: id,
        userId,
        email: email || null,
        total,
        currency: process.env.CURRENCY || 'inr',
        paymentMethod,
        items: items.map((i) => ({ productId: i.productId, name: i.name, price: i.price, qty: i.qty })),
      });
    });
    return { id, total };
  }

  // Payment worked: PENDING -> CONFIRMED (returns false if it was already handled)
  async function confirmOrder(orderId, paymentId) {
    return inTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE orders SET status = 'CONFIRMED', payment_id = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'PENDING' RETURNING *`,
        [orderId, paymentId || null]
      );
      if (rows.length === 0) return false;
      const order = rows[0];
      await addEvent(client, TOPICS.ORDER_CONFIRMED, orderId, 'ORDER_CONFIRMED', {
        orderId,
        userId: order.user_id,
        email: order.user_email,
        total: Number(order.total),
      });
      return true;
    });
  }

  // Payment failed: PENDING -> CANCELLED, and tell everyone (stock goes back, email is sent)
  async function cancelOrder(orderId, reason) {
    return inTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE orders SET status = 'CANCELLED', failure_reason = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'PENDING' RETURNING *`,
        [orderId, reason || 'Payment failed']
      );
      if (rows.length === 0) return false;
      const order = rows[0];
      const items = await client.query('SELECT product_id, qty FROM order_items WHERE order_id = $1', [orderId]);
      await addEvent(client, TOPICS.ORDER_CANCELLED, orderId, 'ORDER_CANCELLED', {
        orderId,
        userId: order.user_id,
        email: order.user_email,
        reason: order.failure_reason,
        items: items.rows.map((r) => ({ productId: r.product_id, qty: r.qty })),
      });
      return true;
    });
  }

  async function getOrder(orderId) {
    const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (!rows[0]) return null;
    const items = await pool.query('SELECT product_id, name, price, qty FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
    return { ...format(rows[0]), items: items.rows.map((i) => ({ productId: i.product_id, name: i.name, price: Number(i.price), qty: i.qty })) };
  }

  async function listOrders(userId) {
    const { rows } = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);
    return rows.map(format);
  }

  return { createOrder, confirmOrder, cancelOrder, getOrder, listOrders };
}

function format(row) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    total: Number(row.total),
    shipping: row.shipping,
    paymentId: row.payment_id,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { createOrderStore };
