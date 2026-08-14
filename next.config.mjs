/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    dirs: ['app', 'components', 'lib', 'hooks'],
  },
  experimental: {
    // Bật instrumentation.ts để chạy background poller khi server khởi động (Next 14.2).
    instrumentationHook: true,
  },
};

export default nextConfig;
