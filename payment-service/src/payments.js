// Payment logic with two safety features.
//
// 1) DUPLICATE PROTECTION ("idempotency"), two layers:
//      Layer 1: before calling Stripe we look in Redis: "did we already handle this order?"
//      Layer 2: Stripe also gets an idempotency key (see stripeClient.js)
//    Result: the same order can be processed many times but is charged once.
//
// 2) CIRCUIT BREAKER ("opossum"), like a fuse:
//      CLOSED    normal, payments go to Stripe
//      OPEN      Stripe keeps failing -> we stop calling it and answer instantly
//                ("fail fast") instead of making every customer wait for a timeout
//      HALF_OPEN after 30 seconds one test payment is allowed through
//    A declined card is NOT a Stripe problem, so it never trips the breaker.

const CircuitBreaker = require('opossum');
const { log } = require('./util');

const RESULT_TTL_SECONDS = 24 * 3600;

const isCardError = (err) => Boolean(err) && (err.type === 'StripeCardError' || err.code === 'card_declined');

function createPaymentProcessor({ redis, charge, breakerOptions = {} }) {
  const breaker = new CircuitBreaker(charge, {
    timeout: 10000, // give up on one call after 10 s
    errorThresholdPercentage: 50, // open when half of the calls fail...
    volumeThreshold: 5, // ...but only after at least 5 calls (avoid reacting to 1 bad call)
    resetTimeout: 30000, // try again after 30 s
    errorFilter: isCardError, // card declines are not counted as failures
    ...breakerOptions,
  });
  breaker.on('open', () => log('CIRCUIT OPEN: Stripe is failing, rejecting payments instantly'));
  breaker.on('halfOpen', () => log('CIRCUIT HALF-OPEN: letting one test payment through'));
  breaker.on('close', () => log('CIRCUIT CLOSED: Stripe is healthy again'));

  async function process({ orderId, amount, currency, paymentMethod }) {
    const resultKey = `payment:result:${orderId}`;

    // Layer 1: have we already handled this order?
    const cached = await redis.get(resultKey);
    if (cached) {
      log(`order ${orderId} was already processed, returning the saved result (no second charge)`);
      return { ...JSON.parse(cached), fromCache: true };
    }

    const started = Date.now();
    try {
      const intent = await breaker.fire({ orderId, amount, currency, paymentMethod });
      const result = { ok: true, paymentId: intent.id, amount };
      await redis.set(resultKey, JSON.stringify(result), 'EX', RESULT_TTL_SECONDS);
      log(`order ${orderId} PAID in ${Date.now() - started} ms`);
      return result;
    } catch (err) {
      if (isCardError(err)) {
        // A normal business answer ("card declined"), remember it too
        const result = { ok: false, reason: err.message };
        await redis.set(resultKey, JSON.stringify(result), 'EX', RESULT_TTL_SECONDS);
        log(`order ${orderId} payment declined in ${Date.now() - started} ms: ${err.message}`);
        return result;
      }
      if (err.code === 'EOPENBREAKER') {
        // Breaker is open: answered immediately, Stripe was not even contacted
        log(`order ${orderId} rejected in ${Date.now() - started} ms because the circuit is OPEN`);
        return { ok: false, unavailable: true, reason: 'Our payment provider is temporarily unavailable. Please try again in a minute.' };
      }
      // Timeout or network problem: we do NOT know if Stripe charged the card.
      // Throw so Kafka delivers the message again. That is safe because of the
      // idempotency key: a retry can never charge twice.
      log(`order ${orderId} payment error after ${Date.now() - started} ms: ${err.message} (will retry)`);
      throw err;
    }
  }

  const state = () => (breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED');

  return { process, state, breaker };
}

module.exports = { createPaymentProcessor, isCardError };
