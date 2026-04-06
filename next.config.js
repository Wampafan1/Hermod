/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["pg-boss", "mssql", "pg", "mysql2", "@duckdb/node-api", "@duckdb/node-bindings-win32-x64"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "hermodforge.com",
        pathname: "/illustrations/**",
      },
    ],
  },
  async rewrites() {
    return [
      { source: "/", destination: "/hermod.html" },
    ];
  },
};

module.exports = nextConfig;
