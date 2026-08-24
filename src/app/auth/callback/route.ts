import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Handles the Supabase password-recovery redirect (PKCE code exchange).
// Never issues an MDF application session — that happens only via /login.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") ?? "/auth/reset-password";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/auth/reset-password";

  if (!code) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?reason=unauth", request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
