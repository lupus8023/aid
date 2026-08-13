/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the always-on local SSH companion isolated from the normal Netlify build.
  distDir: process.env.AID_LOCAL_COMPANION === '1' ? '.next-companion' : '.next',
  // The desktop Companion ships a traced, self-contained Next.js server.
  output: process.env.AID_LOCAL_COMPANION === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: __dirname,
  // Multi-reference ComfyUI requests contain base64 images. Next.js clones only
  // the first 10 MiB by default, which truncates the JSON before the route can
  // parse it. Raise the limit only for the localhost companion process.
  experimental: process.env.AID_LOCAL_COMPANION === '1'
    ? { middlewareClientMaxBodySize: '512mb' }
    : undefined,
  // ssh2 is a server-only Node package with an optional native accelerator.
  // Keep it external so Next does not try to parse the .node binary.
  serverExternalPackages: ['ssh2'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
    unoptimized: true, // 允许blob URLs和data URLs
  },
}

module.exports = nextConfig
