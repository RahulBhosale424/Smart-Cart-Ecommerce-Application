// The browser only talks to THIS server. Every request to /api/... is
// passed on to the API gateway. Benefits: no CORS problems, and the only
// public address you need is the frontend's.
//
// GATEWAY_URL is the gateway address as seen from inside Docker.
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';

module.exports = {
  output: 'standalone', // small production build for Docker
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${GATEWAY_URL}/api/:path*` }];
  },
};
