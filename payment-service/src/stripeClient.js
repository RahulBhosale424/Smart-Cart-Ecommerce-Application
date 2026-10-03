// Creates the function that actually charges a card.
//
//  - With STRIPE_SECRET_KEY set  -> real Stripe, in TEST mode (no real money).
//  - Without a key               -> MOCK mode that behaves like Stripe, so the
//                                   whole project runs without a Stripe account.
//
// Test payment methods (sent by the frontend instead of card numbers):
//   pm_card_visa            -> payment succeeds
//   pm_card_chargeDeclined  -> card is declined
//   pm_simulate_outage      -> (mock mode only) pretends Stripe is down

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cardError(message, code) {
  const err = new Error(message);
  err.type = 'StripeCardError';
  err.code = code;
  return err;
}

async function mockCharge({ orderId, paymentMethod }) {
  await sleep(150); // pretend the network call takes a moment
  if (paymentMethod === 'pm_card_chargeDeclined') throw cardError('Your card was declined.', 'card_declined');
  if (paymentMethod === 'pm_simulate_outage') throw new Error('Simulated Stripe outage');
  return { id: `pi_mock_${String(orderId).slice(0, 8)}`, status: 'succeeded' };
}

function createCharge({ secretKey }) {
  if (!secretKey) return { mode: 'mock', charge: mockCharge };

  const Stripe = require('stripe');
  const stripe = new Stripe(secretKey, { timeout: 8000 });

  async function charge({ orderId, amount, currency, paymentMethod }) {
    const intent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amount * 100), // Stripe wants the smallest unit (paise), always a whole number
        currency: String(currency || 'inr').toLowerCase(),
        payment_method: paymentMethod,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        description: `SmartCart order ${orderId}`,
        metadata: { orderId },
      },
      // Layer 2 of duplicate protection: Stripe itself remembers this key.
      // Same key twice = Stripe returns the first result instead of charging again.
      { idempotencyKey: `smartcart-order-${orderId}` }
    );
    if (intent.status !== 'succeeded') {
      throw cardError(`Payment needs extra steps (status: ${intent.status}).`, 'requires_action');
    }
    return intent;
  }
  return { mode: 'stripe', charge };
}

module.exports = { createCharge, mockCharge, cardError };
