/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next 14 bundles Route Handler dependencies by default. ffmpeg-static
    // resolves its binary from __dirname, so it must remain a native Node
    // dependency instead of being rewritten into .next/server/.../ffmpeg.
    serverComponentsExternalPackages: ["ffmpeg-static"],
    // Vercel builds each function from Next.js' file trace. The ffmpeg binary
    // is not JavaScript, so include the whole package explicitly in the trace.
    outputFileTracingIncludes: {
      "/api/admin/social-ai": ["./node_modules/ffmpeg-static/**/*"],
    },
  },
}

module.exports = nextConfig
