/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      '/api/admin/social-ai': ['./node_modules/ffmpeg-static/ffmpeg'],
    },
  },
}

module.exports = nextConfig
