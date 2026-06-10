/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@virtual-sim/shared"],
  async rewrites() {
    const server = process.env.SERVER_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${server}/api/:path*` }];
  },
};

export default nextConfig;
