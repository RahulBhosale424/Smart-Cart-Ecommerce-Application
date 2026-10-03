// Auth service: register, login, "who am I".
// Passwords are hashed with bcrypt. Login returns a JWT that the
// API gateway verifies on every later request.

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, init } = require('./db');
const { validateRegister, validateLogin } = require('./validate');
const { log } = require('./util');

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
if (!JWT_SECRET) {
  log('JWT_SECRET is missing. Set it in the .env file.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '10kb' }));

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const signToken = (u) =>
  jwt.sign({ userId: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '1d' });

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'auth-service' }));

app.post('/auth/register', async (req, res) => {
  const errors = validateRegister(req.body);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });

  const email = req.body.email.trim().toLowerCase();
  try {
    // bcrypt adds a random salt and is deliberately slow, so stolen hashes are hard to crack
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const role = ADMIN_EMAIL && email === ADMIN_EMAIL ? 'admin' : 'user';
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [id, req.body.name.trim(), email, passwordHash, role]
    );
    const user = { id, name: req.body.name.trim(), email, role };
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'An account with this email already exists.' });
    log('register error:', err.message);
    res.status(500).json({ message: 'Could not create the account. Please try again.' });
  }
});

app.post('/auth/login', async (req, res) => {
  const errors = validateLogin(req.body);
  if (errors.length) return res.status(400).json({ message: errors[0] });

  try {
    const email = req.body.email.trim().toLowerCase();
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    const ok = user && (await bcrypt.compare(req.body.password, user.password_hash));
    // Same message for "no such email" and "wrong password", so attackers
    // cannot find out which emails are registered.
    if (!ok) return res.status(401).json({ message: 'Invalid email or password.' });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    log('login error:', err.message);
    res.status(500).json({ message: 'Could not log in. Please try again.' });
  }
});

// The gateway already verified the token and passes the user id in a header
app.get('/auth/me', async (req, res) => {
  const id = req.headers['x-user-id'];
  if (!id) return res.status(401).json({ message: 'Please log in first.' });
  try {
    const { rows } = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'User not found.' });
    res.json({ user: rows[0] });
  } catch (err) {
    log('me error:', err.message);
    res.status(500).json({ message: 'Something went wrong.' });
  }
});

async function main() {
  await init();
  app.listen(PORT, () => log(`auth-service listening on port ${PORT}`));
}
if (require.main === module) {
  main().catch((err) => {
    log('startup failed:', err.message);
    process.exit(1);
  });
}
module.exports = app;
