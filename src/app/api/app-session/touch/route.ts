import { NextResponse } from "next/server";
import { requireMdfSession } from "@/lib/auth/require";

// Middleware normally intercepts this route and issues a 204 with a bumped
// last-activity cookie. This handler is a defense-in-depth fallback that
// re-validates the session server-side if middleware ever misses.
export async function POST() {
  await requireMdfSession();
  return new NextResponse(null, { status: 204 });
}
