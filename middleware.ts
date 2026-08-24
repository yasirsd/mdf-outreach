import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@/utils/supabase/middleware";
import {
  APP_SESSION_LAST_ACTIVITY_COOKIE,
  APP_SESSION_START_COOKIE,
  isPublicRoute,
  isTouchRoute,
  loginRedirect,
} from "@/lib/auth/config";
import {
  buildLastActivityCookie,
  checkAppSession,
  clearedAppSessionCookies,
} from "@/lib/auth/session";
import { getActiveMembership } from "@/lib/auth/membership";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|images|assets|public|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|woff|woff2|ttf|otf)$).*)",
  ],
};

function redirectResponse(request: NextRequest, target: string, clearAppSession = false) {
  const url = request.nextUrl.clone();
  const [pathname, search] = target.split("?");
  url.pathname = pathname;
  url.search = search ? `?${search}` : "";
  const res = NextResponse.redirect(url);
  if (clearAppSession) {
    for (const c of clearedAppSessionCookies()) res.cookies.set(c);
  }
  return res;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const { supabase, getResponse, setResponse } = createMiddlewareClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public routes: still refresh Supabase cookies, but do not enforce membership.
  if (isPublicRoute(pathname)) {
    // If already fully authorized, don't let them dwell on /login.
    if (pathname === "/login" && user) {
      const check = checkAppSession(
        request.cookies.get(APP_SESSION_START_COOKIE)?.value,
        request.cookies.get(APP_SESSION_LAST_ACTIVITY_COOKIE)?.value,
      );
      if (check.ok) {
        const membership = await getActiveMembership(supabase, user.id);
        if (membership) {
          return redirectResponse(request, "/");
        }
      }
    }
    return getResponse();
  }

  // Everything below requires full authorization.
  if (!user) {
    return redirectResponse(request, loginRedirect("unauth", pathname), true);
  }

  const startedCookie = request.cookies.get(APP_SESSION_START_COOKIE)?.value;
  const lastCookie = request.cookies.get(APP_SESSION_LAST_ACTIVITY_COOKIE)?.value;
  const check = checkAppSession(startedCookie, lastCookie);
  if (!check.ok) {
    return redirectResponse(request, loginRedirect("expired", pathname), true);
  }

  const membership = await getActiveMembership(supabase, user.id);
  if (!membership) {
    return redirectResponse(request, "/access-denied");
  }

  // Touch route (POST): bump last activity, respond 204, do NOT redirect.
  if (isTouchRoute(pathname)) {
    if (request.method !== "POST") {
      return new NextResponse("Method Not Allowed", { status: 405 });
    }
    const now = Date.now();
    const secure = process.env.NODE_ENV === "production";
    const res = new NextResponse(null, { status: 204 });
    res.cookies.set(buildLastActivityCookie(now, secure));
    return res;
  }

  // Normal protected navigation: bump activity cookie on the outgoing response.
  const res = getResponse();
  const now = Date.now();
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(buildLastActivityCookie(now, secure));
  setResponse(res);
  return res;
}
