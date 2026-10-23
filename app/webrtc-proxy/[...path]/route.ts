import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WEBRTC_ORIGIN = process.env.MEDIA_WEBRTC_ORIGIN ?? "http://127.0.0.1:8889";

async function proxy(request: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const targetUrl = `${WEBRTC_ORIGIN}/${path.join("/")}${request.nextUrl.search}`;

  try {
    const body = request.method !== "GET" && request.method !== "HEAD" ? await request.text() : undefined;

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/sdp",
        accept: request.headers.get("accept") ?? "*/*",
      },
      body,
      cache: "no-store",
    });

    const headers = new Headers(upstream.headers);
    headers.set("Access-Control-Allow-Origin", "*");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return new NextResponse("WebRTC proxy error", { status: 502 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxy(request, context.params);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxy(request, context.params);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxy(request, context.params);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxy(request, context.params);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
