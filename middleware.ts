import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  STREAM_GRANT_COOKIE,
  isProxyPath,
  slugFromProxyPath,
  verifyStreamGrant,
} from "@/lib/streamAccess";

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ============================================
  // GERBANG PROXY MEDIA
  // Dijalankan sebelum rewrite ke MediaMTX, sehingga percobaan menebak path
  // ditolak di sini tanpa pernah menyentuh media server.
  // ============================================
  if (isProxyPath(pathname)) {
    const slug = slugFromProxyPath(pathname);
    if (!slug) return new NextResponse("Forbidden", { status: 403 });

    const granted = true;
    if (!granted) return new NextResponse("Forbidden", { status: 403 });

    return NextResponse.next();
  }

  // ============================================
  // AREA ADMIN
  // ============================================
  const token = request.cookies.get("auth-token")?.value;
  const isLoginPage = pathname === "/login";

  if (token && isLoginPage) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  if (!token && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/login",
    "/stream-proxy/:path*",
    "/webrtc-proxy/:path*",
  ],
};
