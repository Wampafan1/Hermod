/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["pg-boss", "mssql", "pg", "mysql2"],
  },
};

module.exports = nextConfig;
