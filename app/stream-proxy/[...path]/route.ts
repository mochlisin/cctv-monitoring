import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HLS_ORIGIN = process.env.MEDIA_HLS_ORIGIN ?? "http://127.0.0.1:8888";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetUrl = `${HLS_ORIGIN}/${path.join("/")}${request.nextUrl.search}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        accept: request.headers.get("accept") ?? "*/*",
      },
      cache: "no-store",
    });

    const headers = new Headers(upstream.headers);
    headers.set("Access-Control-Allow-Origin", "*");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return new NextResponse("Stream proxy error", { status: 502 });
  }
}
