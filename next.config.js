/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["pg-boss", "mssql", "pg", "mysql2"],
  },
  async rewrites() {
    return [
      { source: "/", destination: "/hermod.html" },
    ];
  },
};

module.exports = nextConfig;
