import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireMdfSession } from "@/lib/auth/require";
import { createClient } from "@/utils/supabase/server";
import {
  OAUTH_STATE_COOKIE,
  callbackUrlFor,
  requireGoogleClientId,
  requireGoogleClientSecret,
} from "@/lib/gmail/config";
import { verifyCookieValue } from "@/lib/auth/session";
import { saveGmailConnection } from "@/lib/gmail/tokens";

function redirectToSettings(request: NextRequest, params: Record<string, string>) {
  const target = new URL("/settings?tab=email", request.url);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const session = await requireMdfSession();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  // Consume the state cookie exactly once.
  const stateCookie = cookies().get(OAUTH_STATE_COOKIE)?.value;
  cookies().delete(OAUTH_STATE_COOKIE);
  const verifiedState = verifyCookieValue(stateCookie ?? null);

  if (googleError) {
    return redirectToSettings(request, { gmail: "denied" });
  }
  if (!code || !state || !verifiedState || verifiedState !== state) {
    return redirectToSettings(request, { gmail: "state-mismatch" });
  }

  const origin = process.env.APP_BASE_URL || `${url.protocol}//${url.host}`;
  const callback = callbackUrlFor(origin);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireGoogleClientId(),
      client_secret: requireGoogleClientSecret(),
      redirect_uri: callback,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return redirectToSettings(request, { gmail: "token-exchange-failed" });
  }
  const token = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    id_token?: string;
    token_type?: string;
  };

  // Fetch the connected Google user's email so the UI + audit trail can
  // display who is actually sending.
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) {
    return redirectToSettings(request, { gmail: "userinfo-failed" });
  }
  const info = (await infoRes.json()) as { email?: string };
  if (!info.email) {
    return redirectToSettings(request, { gmail: "userinfo-empty" });
  }

  const supabase = createClient(cookies());
  await saveGmailConnection(supabase, {
    workspaceId: session.membership.workspaceId,
    googleUserEmail: info.email,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scope: token.scope ?? "",
    expiryAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    connectedBy: session.userId,
  });

  return redirectToSettings(request, { gmail: "connected" });
}
