import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { APP_SESSION_LAST_ACTIVITY_COOKIE, APP_SESSION_START_COOKIE } from "./config";

/**
 * Real sign-out: invalidates the Supabase session on the server and
 * clears MDF application-session cookies. Never a mere state-clear.
 */
export async function performSignOut(): Promise<void> {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  try {
    await supabase.auth.signOut();
  } catch {
    // If already signed out or refresh token is stale, we still clear cookies.
  }
  try {
    cookieStore.delete(APP_SESSION_START_COOKIE);
    cookieStore.delete(APP_SESSION_LAST_ACTIVITY_COOKIE);
  } catch {
    // Server components have a readonly cookie store — the caller (route
    // handler or server action) must wrap in a mutating context.
  }
}
