const isAppBuild = process.env.NEXT_PUBLIC_BUILD_TARGET === 'app';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isAppBuild ? { output: 'export', trailingSlash: true } : {}),
  images: {
    ...(isAppBuild ? { unoptimized: true } : {}),
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
  async headers() {
    return [
      {
        // allow API routes to be called from the Capacitor app origins
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" }, // Or allow specific origins like capacitor://localhost, https://localhost
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
        ]
      }
    ]
  }
};

export default nextConfig;
