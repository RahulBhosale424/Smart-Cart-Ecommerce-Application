// JWT check done ONCE here, so the other services never deal with tokens.
// After the token is verified, the gateway tells the services who the user is
// using headers: x-user-id, x-user-email, x-user-role.

const jwt = require('jsonwebtoken');

// Routes anyone can call without logging in
function isPublic(method, path) {
  if (method === 'POST' && (path === '/api/auth/register' || path === '/api/auth/login')) return true;
  // Browsing products is read-only, so it is public
  if (method === 'GET' && (path === '/api/products' || path.startsWith('/api/products/'))) return true;
  return false;
}

function createAuthMiddleware({ secret }) {
  return function auth(req, res, next) {
    // SECURITY: a user could send fake "x-user-id" headers themselves.
    // Always throw away identity headers that came from outside.
    delete req.headers['x-user-id'];
    delete req.headers['x-user-email'];
    delete req.headers['x-user-role'];

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (token) {
      try {
        const decoded = jwt.verify(token, secret);
        req.headers['x-user-id'] = String(decoded.userId);
        req.headers['x-user-email'] = String(decoded.email || '');
        req.headers['x-user-role'] = String(decoded.role || 'user');
        return next();
      } catch {
        // invalid or expired token: fine for public routes, blocked for the rest
        if (!isPublic(req.method, req.path)) {
          return res.status(401).json({ message: 'Session expired. Please log in again.' });
        }
        return next();
      }
    }

    if (isPublic(req.method, req.path)) return next();
    return res.status(401).json({ message: 'Please log in first.' });
  };
}

module.exports = { createAuthMiddleware, isPublic };
