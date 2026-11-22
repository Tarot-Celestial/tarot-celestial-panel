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
      "/api/admin/office/instagram": ["./node_modules/ffmpeg-static/**/*"],
      "/api/admin/office/instagram/preview": ["./node_modules/ffmpeg-static/**/*"],
      "/api/office/instagram-media": ["./node_modules/ffmpeg-static/**/*"],
      "/api/cron/office-instagram": ["./node_modules/ffmpeg-static/**/*"],
      "/api/admin/office/runs": ["./src/lib/server/office-art/*", "./node_modules/@resvg/resvg-wasm/index_bg.wasm", "./node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf"],
      "/api/cron/office-runs": ["./src/lib/server/office-art/*", "./node_modules/@resvg/resvg-wasm/index_bg.wasm", "./node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf"],
    },
  },
}

module.exports = nextConfig
