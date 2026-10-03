const test = require('node:test');
const assert = require('node:assert');
const { validateRegister, validateLogin } = require('../src/validate');

test('accepts a valid registration', () => {
  assert.deepEqual(validateRegister({ name: 'Rahul', email: 'rahul@example.com', password: 'Passw0rd1' }), []);
});

test('rejects bad email', () => {
  const errors = validateRegister({ name: 'Rahul', email: 'not-an-email', password: 'Passw0rd1' });
  assert.ok(errors.some((e) => e.includes('email')));
});

test('rejects short passwords and passwords without a number', () => {
  assert.ok(validateRegister({ name: 'Rahul', email: 'a@b.co', password: 'short1' }).length > 0);
  assert.ok(validateRegister({ name: 'Rahul', email: 'a@b.co', password: 'onlyletters' }).length > 0);
});

test('login needs email and password', () => {
  assert.equal(validateLogin({}).length, 2);
  assert.equal(validateLogin({ email: 'a@b.co', password: 'x' }).length, 0);
});
