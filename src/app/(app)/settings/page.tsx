import { serverRepositories } from "@/lib/repositories/server";
import { createDefaultSettings } from "@/lib/workspace/defaults";
import { SettingsView } from "./SettingsView";
import {
  getGmailConnectionSummaryAction,
  listTestRecipientsAction,
} from "./gmailActions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: { tab?: string; gmail?: string };
}) {
  const { repos } = await serverRepositories();
  const [settings, assets, gmailSummary, testRecipients] = await Promise.all([
    repos.settings.get(),
    repos.assets.list(),
    getGmailConnectionSummaryAction(),
    listTestRecipientsAction().catch(() => []),
  ]);
  const effective = settings ?? { ...createDefaultSettings(), onboardingComplete: true };
  return (
    <SettingsView
      initialSettings={effective}
      initialAssets={assets}
      initialTab={searchParams?.tab === "email" ? "email" : undefined}
      gmailSummary={gmailSummary}
      testRecipients={testRecipients}
      gmailStatus={searchParams?.gmail ?? null}
    />
  );
}
