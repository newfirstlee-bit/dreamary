const isAppBuild = process.env.NEXT_PUBLIC_BUILD_TARGET === 'app';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isAppBuild ? { output: 'export', trailingSlash: true } : {}),
  images: {
    // Netlify의 /_next/image 프록시가 정상 ImgBB 원본에도 404를 반환할 수 있어
    // 웹과 앱 모두 원본/로컬 Blob URL을 직접 사용합니다.
    unoptimized: true,
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
          { key: "Access-Control-Allow-Headers", value: "Authorization, X-Guest-Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
        ]
      }
    ]
  }
};

export default nextConfig;
