import { NextResponse, type NextRequest } from 'next/server';

/**
 * CORS for the browser extension (the side panel is a chrome-extension://
 * origin, so its fetches to /api/* are cross-origin and need preflight).
 * Permissive in dev; tighten to allow-listed origins when the API deploys.
 */
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers });
    }
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };