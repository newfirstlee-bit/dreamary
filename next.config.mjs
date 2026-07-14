/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["i.ibb.co", "firebasestorage.googleapis.com"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
    allowedDevOrigins: ["http://172.30.1.32:3000", "http://localhost:3000", "http://127.0.0.1:3000"],
  },
};

export default nextConfig;
