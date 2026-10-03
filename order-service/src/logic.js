// Small pure functions: input checks and the order total.

function computeTotal(items) {
  const total = items.reduce((sum, i) => sum + Number(i.price) * Number(i.qty), 0);
  return Math.round(total * 100) / 100;
}

// Checks the body of POST /orders. Returns { errors, value }.
function validateOrderInput(body = {}) {
  const errors = [];
  const s = body.shipping || {};
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');

  const shipping = {
    name: clean(s.name),
    address: clean(s.address),
    city: clean(s.city),
    pincode: clean(s.pincode),
  };
  if (shipping.name.length < 2 || shipping.name.length > 80) errors.push('Enter the name for delivery.');
  if (shipping.address.length < 5 || shipping.address.length > 200) errors.push('Enter a full delivery address.');
  if (shipping.city.length < 2 || shipping.city.length > 60) errors.push('Enter the city.');
  if (!/^[0-9]{6}$/.test(shipping.pincode)) errors.push('Pincode must be 6 digits.');

  // This is a Stripe TEST payment method id, for example pm_card_visa.
  // Real card numbers are never sent to our servers.
  const paymentMethod = body.paymentMethod === undefined ? 'pm_card_visa' : body.paymentMethod;
  if (typeof paymentMethod !== 'string' || !/^pm_[A-Za-z0-9_]{3,60}$/.test(paymentMethod)) {
    errors.push('Choose a payment method.');
  }

  return { errors, value: { shipping, paymentMethod } };
}

module.exports = { computeTotal, validateOrderInput };
