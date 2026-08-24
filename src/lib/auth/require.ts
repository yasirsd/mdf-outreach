import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { APP_SESSION_LAST_ACTIVITY_COOKIE, APP_SESSION_START_COOKIE } from "./config";
import { checkAppSession } from "./session";
import { getActiveMembership, type MdfMembership } from "./membership";

export interface MdfSession {
  userId: string;
  email: string;
  membership: MdfMembership;
}

/**
 * Server-side gate. Fails closed by redirecting.
 * Belt-and-suspenders with middleware.ts — must remain even if middleware runs.
 */
export async function requireMdfSession(): Promise<MdfSession> {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login?reason=unauth");

  const sessionCheck = checkAppSession(
    cookieStore.get(APP_SESSION_START_COOKIE)?.value,
    cookieStore.get(APP_SESSION_LAST_ACTIVITY_COOKIE)?.value,
  );
  if (!sessionCheck.ok) redirect("/login?reason=expired");

  const membership = await getActiveMembership(supabase, user.id);
  if (!membership) redirect("/access-denied");

  return {
    userId: user.id,
    email: user.email ?? "",
    membership,
  };
}
