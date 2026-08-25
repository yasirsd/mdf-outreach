import { AppShell } from "@/components/AppShell";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { AppSessionMonitor } from "@/components/auth/AppSessionMonitor";
import { serverRepositories } from "@/lib/repositories/server";
import { ensureWorkspaceReady } from "@/lib/workspace/ensure";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { session, repos } = await serverRepositories();
  const { settings } = await ensureWorkspaceReady(repos);

  return (
    <WorkspaceProvider initialSettings={settings}>
      <AppSessionMonitor />
      <AppShell userEmail={session.email}>{children}</AppShell>
    </WorkspaceProvider>
  );
}
