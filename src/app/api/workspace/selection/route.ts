import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  APP_SESSION_LAST_ACTIVITY_COOKIE,
  APP_SESSION_START_COOKIE,
} from "@/lib/auth/config";
import { checkAppSession } from "@/lib/auth/session";
import { setCurrentWorkspace } from "@/lib/auth/membership";
import { isEntityUuid } from "@/lib/buyerFinder/ids";

export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  const session = checkAppSession(
    cookieStore.get(APP_SESSION_START_COOKIE)?.value,
    cookieStore.get(APP_SESSION_LAST_ACTIVITY_COOKIE)?.value,
  );
  if (!session.ok) {
    return NextResponse.json({ outcome: "session_expired" }, { status: 401 });
  }

  let workspaceId = "";
  try {
    const body = await request.json() as { workspaceId?: unknown };
    workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  } catch {
    return NextResponse.json({ outcome: "invalid_input" }, { status: 400 });
  }
  if (!isEntityUuid(workspaceId)) {
    return NextResponse.json({ outcome: "invalid_input" }, { status: 400 });
  }

  try {
    const membership = await setCurrentWorkspace(supabase, user.id, workspaceId);
    if (!membership || membership.workspaceId !== workspaceId) {
      return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({
      outcome: "selected",
      workspaceId: membership.workspaceId,
      role: membership.role,
    });
  } catch {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
}
