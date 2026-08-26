import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireMdfSession } from "@/lib/auth/require";
import {
  GMAIL_SEND_SCOPE,
  GMAIL_USERINFO_SCOPES,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  callbackUrlFor,
  requireGoogleClientId,
} from "@/lib/gmail/config";
import { signCookieValue } from "@/lib/auth/session";

/**
 * Begin Google OAuth. Protected by requireMdfSession(). We store a
 * signed, HttpOnly state cookie so the callback can prove the
 * redirect came from THIS user's session and hasn't been forged.
 */
export async function GET(request: NextRequest) {
  await requireMdfSession();

  const url = new URL(request.url);
  const origin = process.env.APP_BASE_URL || `${url.protocol}//${url.host}`;
  const callback = callbackUrlFor(origin);

  const stateRaw = randomBytes(16).toString("hex");
  const signed = signCookieValue(stateRaw);
  const secure = process.env.NODE_ENV === "production";

  cookies().set(OAUTH_STATE_COOKIE, signed, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });

  const scopes = [GMAIL_SEND_SCOPE, ...GMAIL_USERINFO_SCOPES].join(" ");
  const params = new URLSearchParams({
    client_id: requireGoogleClientId(),
    redirect_uri: callback,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent", // force refresh_token issuance even on re-consent
    include_granted_scopes: "true",
    state: stateRaw,
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
