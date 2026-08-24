import { NextResponse, type NextRequest } from "next/server";
import { performSignOut } from "@/lib/auth/signOut";
import { clearedAppSessionCookies } from "@/lib/auth/session";

async function handle(request: NextRequest) {
  await performSignOut();
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason");
  const target = new URL(reason ? `/login?reason=${encodeURIComponent(reason)}` : "/login", request.url);
  const res = NextResponse.redirect(target, { status: 303 });
  for (const c of clearedAppSessionCookies()) res.cookies.set(c);
  return res;
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
