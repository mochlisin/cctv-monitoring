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

    const resHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
    };
    const contentType = upstream.headers.get("content-type");
    if (contentType) resHeaders["Content-Type"] = contentType;

    const data = await upstream.arrayBuffer();
    return new NextResponse(data, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch (e) {
    return new NextResponse(`Stream proxy error: ${String(e)}`, { status: 502 });
  }
}
