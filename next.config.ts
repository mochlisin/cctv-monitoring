import type { NextConfig } from "next";

// MediaMTX hanya mendengarkan di localhost untuk signaling & HLS; browser
// mengaksesnya lewat proxy di bawah ini supaya tetap satu origin dengan app.
const HLS_ORIGIN = process.env.MEDIA_HLS_ORIGIN ?? "http://127.0.0.1:8888";
const WEBRTC_ORIGIN = process.env.MEDIA_WEBRTC_ORIGIN ?? "http://127.0.0.1:8889";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/webrtc-proxy/:path*",
        destination: `${WEBRTC_ORIGIN}/:path*`,
      },
      {
        source: "/stream-proxy/:path*",
        destination: `${HLS_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
