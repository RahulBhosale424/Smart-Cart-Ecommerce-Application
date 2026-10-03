const test = require('node:test');
const assert = require('node:assert');
const { computeTotal, validateOrderInput } = require('../src/logic');

const goodShipping = { name: 'Rahul Patil', address: '12 MG Road, Shivajinagar', city: 'Pune', pincode: '411005' };

test('computeTotal multiplies price by quantity and rounds to 2 decimals', () => {
  assert.equal(computeTotal([{ price: 99.99, qty: 3 }, { price: '10.5', qty: 2 }]), 320.97);
});

test('a complete order input is accepted, payment method defaults to the success test card', () => {
  const { errors, value } = validateOrderInput({ shipping: goodShipping });
  assert.deepEqual(errors, []);
  assert.equal(value.paymentMethod, 'pm_card_visa');
});

test('bad pincode and missing address are rejected', () => {
  const { errors } = validateOrderInput({ shipping: { ...goodShipping, pincode: '12', address: '' } });
  assert.ok(errors.length >= 2);
});

test('a payment method that is not a Stripe id is rejected', () => {
  const { errors } = validateOrderInput({ shipping: goodShipping, paymentMethod: '4242 4242 4242 4242' });
  assert.ok(errors.some((e) => e.includes('payment')));
});
