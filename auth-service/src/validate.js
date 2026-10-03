// Input checks for register / login. Returns a list of error messages
// (empty list = everything is fine).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegister(body = {}) {
  const errors = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 60) errors.push('Name must be 2 to 60 characters.');
  if (typeof body.email !== 'string' || !EMAIL.test(body.email.trim())) errors.push('Enter a valid email address.');
  const pw = typeof body.password === 'string' ? body.password : '';
  if (pw.length < 8) errors.push('Password must be at least 8 characters.');
  else if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) errors.push('Password must contain a letter and a number.');
  return errors;
}

function validateLogin(body = {}) {
  const errors = [];
  if (typeof body.email !== 'string' || !body.email.trim()) errors.push('Email is required.');
  if (typeof body.password !== 'string' || !body.password) errors.push('Password is required.');
  return errors;
}

module.exports = { validateRegister, validateLogin };
