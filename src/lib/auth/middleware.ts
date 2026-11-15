import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isUnauthenticatedServerRoute } from "@/lib/auth/public-routes";

function redirectWithSessionCookies(url: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}

/** Applies session refresh and route-access rules in the Next.js Proxy. */
export async function updateAuthSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isUnauthenticatedServerRoute(pathname)) return NextResponse.next({ request });

  const { response, claims } = await updateSession(request);

  if (!claims && pathname !== "/login") {
    if (pathname === "/api/ai-assistant" || pathname === "/api/ai-assistant/actions") {
      const unauthorized = NextResponse.json({ error: "יש להתחבר מחדש" }, { status: 401, headers: { "Cache-Control": "no-store" } });
      response.cookies.getAll().forEach(cookie => unauthorized.cookies.set(cookie));
      return unauthorized;
    }
    return redirectWithSessionCookies(new URL("/login", request.url), response);
  }

  if (claims && pathname === "/login") {
    return redirectWithSessionCookies(new URL("/dashboard", request.url), response);
  }

  return response;
}
