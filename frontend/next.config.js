module.exports = { async rewrites() { return [{ source: '/api/:path*', destination: (process.env.BACKEND_URL || 'http://localhost:4000') + '/api/:path*' }]; } };
