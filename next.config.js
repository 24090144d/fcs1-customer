/** @type {import('next').NextConfig} */
const isExport = process.env.GITHUB_ACTIONS === 'true';

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  ...(isExport ? { output: 'export', basePath: '/fcs1-im', images: { unoptimized: true } } : {}),
  experimental: {
    serverComponentsExternalPackages: ["papaparse"],
  },
};

module.exports = nextConfig;
