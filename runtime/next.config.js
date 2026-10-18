/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: { allowedOrigins: ['vat.law', 'localhost:3000'] },
  },
}
module.exports = nextConfig
