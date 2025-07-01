import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `http://0.0.0.0:8080/:path*`, // 代理到后端 API 服务器
      },
    ];
  },

};

export default nextConfig;