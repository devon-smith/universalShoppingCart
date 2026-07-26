import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source and are compiled by the app bundler.
  transpilePackages: [
    '@universal-cart/contracts',
    '@universal-cart/extractors',
    '@universal-cart/ui',
  ],
  typedRoutes: true,
};

export default nextConfig;
