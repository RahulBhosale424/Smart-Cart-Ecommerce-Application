const test = require('node:test');
const assert = require('node:assert');
const { buildEmail } = require('../src/email');

test('confirmed order email contains the order id and total', () => {
  const email = buildEmail('ORDER_CONFIRMED', { orderId: 'abc-123', total: 1999 });
  assert.ok(email.subject.includes('1999.00'));
  assert.ok(email.text.includes('abc-123'));
});

test('cancelled order email explains the reason and says the customer was not charged', () => {
  const email = buildEmail('ORDER_CANCELLED', { orderId: 'abc-123', reason: 'Your card was declined.' });
  assert.ok(email.text.includes('Your card was declined.'));
  assert.ok(email.text.includes('not charged'));
});

test('unknown event types produce no email', () => {
  assert.equal(buildEmail('SOMETHING_ELSE', {}), null);
});
