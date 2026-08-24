import { AppShell } from "@/components/AppShell";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { AppSessionMonitor } from "@/components/auth/AppSessionMonitor";
import { serverRepositories } from "@/lib/repositories/server";
import { createDefaultSettings } from "@/lib/workspace/defaults";
import { ensureSettingsAction } from "./actions";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { session, repos } = await serverRepositories();

  let settings = await repos.settings.get();
  if (!settings) {
    settings = await ensureSettingsAction();
  }

  return (
    <WorkspaceProvider initialSettings={settings ?? { ...createDefaultSettings(), onboardingComplete: true }}>
      <AppSessionMonitor />
      <AppShell userEmail={session.email}>{children}</AppShell>
    </WorkspaceProvider>
  );
}
