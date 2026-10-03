const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { createAuthMiddleware, isPublic } = require('../src/auth');

const SECRET = 'test-secret';
const auth = createAuthMiddleware({ secret: SECRET });

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
}

function run(req) {
  const res = fakeRes();
  let nextCalled = false;
  auth({ headers: {}, ...req }, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('login and register are public', () => {
  assert.equal(isPublic('POST', '/api/auth/login'), true);
  assert.equal(isPublic('POST', '/api/auth/register'), true);
});

test('browsing products is public, but creating them is not', () => {
  assert.equal(isPublic('GET', '/api/products'), true);
  assert.equal(isPublic('GET', '/api/products/123'), true);
  assert.equal(isPublic('POST', '/api/products'), false);
});

test('cart and orders need a token', () => {
  const r1 = run({ method: 'GET', path: '/api/cart', headers: {} });
  assert.equal(r1.res.statusCode, 401);
  assert.equal(r1.nextCalled, false);
  const r2 = run({ method: 'POST', path: '/api/orders', headers: {} });
  assert.equal(r2.res.statusCode, 401);
});

test('valid token passes and identity headers are set', () => {
  const token = jwt.sign({ userId: 'u1', email: 'a@b.com', role: 'user' }, SECRET);
  const req = { method: 'GET', path: '/api/cart', headers: { authorization: `Bearer ${token}` } };
  const res = fakeRes();
  let nextCalled = false;
  auth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.headers['x-user-id'], 'u1');
  assert.equal(req.headers['x-user-email'], 'a@b.com');
  assert.equal(req.headers['x-user-role'], 'user');
});

test('token signed with the wrong secret is rejected', () => {
  const token = jwt.sign({ userId: 'u1' }, 'another-secret');
  const r = run({ method: 'GET', path: '/api/cart', headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.res.statusCode, 401);
  assert.equal(r.nextCalled, false);
});

test('fake identity headers sent by a client are removed', () => {
  const req = {
    method: 'GET',
    path: '/api/products',
    headers: { 'x-user-id': 'hacker', 'x-user-role': 'admin' },
  };
  let nextCalled = false;
  auth(req, fakeRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.headers['x-user-id'], undefined);
  assert.equal(req.headers['x-user-role'], undefined);
});
