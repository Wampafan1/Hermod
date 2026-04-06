import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Edge runtime: NO database access, NO auth() calls.
// Cookie-based redirect only. Real auth enforcement happens via
// requireAuth() in Server Components and withAuth() in API routes.

export function middleware(request: NextRequest) {
  const sessionToken =
    request.cookies.get("next-auth.session-token")?.value ||
    request.cookies.get("__Secure-next-auth.session-token")?.value;

  if (!sessionToken) {
    const loginUrl = new URL("/login", request.url);
    const callback = request.nextUrl.pathname + request.nextUrl.search;
    loginUrl.searchParams.set("callbackUrl", callback);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/reports/:path*",
    "/connections/:path*",
    "/schedules/:path*",
    "/history/:path*",
    "/routes/:path*",
    "/mjolnir/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
  ],
  // Public (no matcher): /login, /invite/[token], /privacy, /terms, /forge, /data-agent, /connectors, /api/auth/*
};
